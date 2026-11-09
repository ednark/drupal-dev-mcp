#!/usr/bin/env node
import 'dotenv/config';
import { buildIndex } from './index/builder.js';
import { fetchCoreSnapshots, fetchGitSources } from './index/fetch.js';
import { findRepoRoot, getDefaultIndexRoot, resolveActiveBuild, statusFromManifest } from './index/manifest.js';
import { verifyActiveIndex } from './index/verify.js';
import { runBenchmark } from './index/benchmark.js';
import { runVersionSmoke } from './index/version-smoke.js';
import { runCorpusHealth } from './index/health.js';
import { checkFreshness } from './index/freshness.js';
import { measureSemanticCalibration } from './index/calibration.js';
import * as path from 'node:path';
import { SqliteKnowledgeProvider } from './query/provider.js';

async function main(): Promise<void> {
  const [command = 'status', ...args] = process.argv.slice(2);
  const repoRoot = findRepoRoot(process.cwd());
  const indexRoot = getDefaultIndexRoot(repoRoot);
  const withEmbeddings = args.includes('--with-embeddings');
  const fixtureArg = args.find(argument => argument.startsWith('--fixture-limit='));
  const fixtureLimit = fixtureArg ? Number(fixtureArg.split('=')[1]) : undefined;
  if (command === 'fetch') {
    if (args.includes('--core-only')) {
      await fetchCoreSnapshots(repoRoot);
      process.stdout.write(`${JSON.stringify({ succeeded: ['drupal-core'], failed: [] }, null, 2)}\n`);
    } else {
      const summary = await fetchGitSources(repoRoot);
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
    return;
  }
  if (command === 'build' || command === 'rebuild') {
    if (command === 'rebuild' && args.includes('--fetch')) {
      if (args.includes('--core-only')) await fetchCoreSnapshots(repoRoot);
      else await fetchGitSources(repoRoot);
    }
    const result = await buildIndex({ repoRoot, indexRoot, fixtureLimit, withEmbeddings, activate: !args.includes('--no-activate') });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.verification.passed) process.exitCode = 1;
    return;
  }
  if (command === 'verify') {
    const result = await verifyActiveIndex(indexRoot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
    return;
  }
  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(statusFromManifest(await resolveActiveBuild(indexRoot)), null, 2)}\n`);
    return;
  }
  if (command === 'freshness') {
    const report = await checkFreshness(repoRoot, indexRoot, { checkUpstream: args.includes('--check-upstream') });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    for (const source of report.sources.filter(item => item.status !== 'fresh' && item.status !== 'unfetched')) {
      process.stderr.write(`${source.status}: ${source.sourceKey} — ${source.details.join('; ')}\n`);
    }
    if (report.needsProcessing.length) process.exitCode = 1;
    return;
  }
  if (command === 'benchmark') {
    const provider = await SqliteKnowledgeProvider.open(indexRoot);
    try {
      const result = await runBenchmark(provider, args.find(argument => argument.startsWith('--version='))?.split('=')[1] ?? '11.4', {
        baselinePath: path.join(repoRoot, 'docs', 'eval', 'benchmark-baseline.json'),
        saveBaseline: args.includes('--save-baseline'),
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.releaseGate) process.exitCode = 1;
    } finally { provider.close(); }
    return;
  }
  if (command === 'health') {
    const report = await runCorpusHealth(repoRoot);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.releaseGate) process.exitCode = 1;
    return;
  }
  if (command === 'version-smoke') {
    const provider = await SqliteKnowledgeProvider.open(indexRoot);
    try {
      const versionArg = args.find(argument => argument.startsWith('--version='))?.split('=')[1];
      const result = await runVersionSmoke(provider, { versions: versionArg?.split(',') });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.releaseGate) process.exitCode = 1;
    } finally { provider.close(); }
    return;
  }
  if (command === 'calibrate') {
    // Re-measure semantic anchors for the ACTIVE build against its own vector
    // table, using the SAME embedding model the build recorded (that is the
    // guard — calibrating with a different model than the vectors would
    // produce exactly the silent corruption this exists to prevent).
    const manifest = await resolveActiveBuild(indexRoot);
    if (!manifest) throw new Error('No active index build to calibrate.');
    if (!manifest.embeddingModel || !manifest.counts.vectors) {
      throw new Error(`Build ${manifest.runId} has no vector index (vectors=${manifest.counts.vectors ?? 0}) — run 'rebuild --with-embeddings' first.`);
    }
    const { default: OpenAI } = await import('openai');
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required to embed calibration probes with the build\'s model.');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const embed = async (texts: string[]) => {
      const response = await client.embeddings.create({ model: manifest.embeddingModel!, input: texts });
      return response.data.map(item => item.embedding);
    };
    const measured = await measureSemanticCalibration({ buildPath: manifest.buildPath, embeddingModel: manifest.embeddingModel, embed });
    const report = {
      runId: manifest.runId,
      embeddingModel: manifest.embeddingModel,
      current: manifest.semanticCalibration ?? null,
      proposed: measured,
      changed: !manifest.semanticCalibration
        || manifest.semanticCalibration.excellent !== measured.excellent
        || manifest.semanticCalibration.irrelevant !== measured.irrelevant,
    };
    if (args.includes('--write')) {
      const updated = { ...manifest, semanticCalibration: measured };
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path.join(manifest.buildPath, 'manifest.json'), JSON.stringify(updated, null, 2));
      const active = path.join(indexRoot, 'active.json');
      const { readFile } = await import('node:fs/promises');
      if (JSON.parse(await readFile(active, 'utf8')).runId === manifest.runId) {
        await writeFile(active, JSON.stringify(updated, null, 2));
      }
      process.stdout.write(`${JSON.stringify({ ...report, written: true }, null, 2)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify({ ...report, note: 'dry run — pass --write to persist into the build manifest' }, null, 2)}\n`);
    }
    return;
  }
  throw new Error(`Unknown command: ${command}. Use fetch, build, rebuild, verify, status, freshness, benchmark, health, version-smoke, or calibrate.`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
