#!/usr/bin/env node
import 'dotenv/config';
import { buildIndex } from './index/builder.js';
import { fetchCoreSnapshots, fetchGitSources } from './index/fetch.js';
import { findRepoRoot, getDefaultIndexRoot, resolveActiveBuild, statusFromManifest } from './index/manifest.js';
import { verifyActiveIndex } from './index/verify.js';
import { runBenchmark } from './index/benchmark.js';
import { checkFreshness } from './index/freshness.js';
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
    const report = await checkFreshness(repoRoot, indexRoot);
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
      const result = await runBenchmark(provider, args.find(argument => argument.startsWith('--version='))?.split('=')[1] ?? '11.4');
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.releaseGate) process.exitCode = 1;
    } finally { provider.close(); }
    return;
  }
  throw new Error(`Unknown command: ${command}. Use fetch, build, rebuild, verify, status, freshness, or benchmark.`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
