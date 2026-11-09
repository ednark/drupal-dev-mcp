/**
 * Side-by-side comparison: current index (lexical-only serving build) vs a
 * locally-embedded comparison build (transformers.js, fully offline).
 *
 * What it does:
 * 1. Builds a COMPARISON index with the local embedder into its own indexRoot
 *    (data/index-compare/<slug>/) — the active build and its manifests are
 *    never touched. The comparison build self-calibrates: its manifest carries
 *    anchors measured with its own embedding model (index/calibration.ts).
 * 2. Runs the retrieval benchmark three ways:
 *      - active build, lexical   (today's serving behavior)
 *      - active build, hybrid    (degrades to lexical — sanity check)
 *      - comparison build, hybrid (lexical + local semantic)
 *    plus the comparison build in pure lexical mode, to isolate whether the
 *    semantic path adds anything on top of BM25 or merely perturbs it.
 * 3. Reports pass rate, MRR, best rank, chrome violations, calibration
 *    anchors, build embed cost, and query latency.
 *
 * Nothing is written to the serving index. Verdicts stay human — this script
 * only produces the numbers.
 *
 * Usage:
 *   npx tsx scripts/embed-compare.ts [--model=bge-small-en-v1.5] [--version=11.4]
 *                                    [--fixture-limit=N] [--skip-build]
 */

import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../packages/knowledge/src/index/builder.js';
import { runBenchmark } from '../packages/knowledge/src/index/benchmark.js';
import { createLocalEmbedder, type LocalEmbedder } from '../packages/knowledge/src/index/local-embed.js';
import { findRepoRoot, getDefaultIndexRoot } from '../packages/knowledge/src/index/manifest.js';
import { SqliteKnowledgeProvider } from '../packages/knowledge/src/query/provider.js';
import type { BenchmarkResult } from '../packages/knowledge/src/index/benchmark.js';

interface Args {
  model?: string;
  version: string;
  fixtureLimit?: number;
  skipBuild: boolean;
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = { version: '11.4', skipBuild: false };
  for (const arg of argv) {
    if (arg.startsWith('--model=')) parsed.model = arg.slice('--model='.length);
    else if (arg.startsWith('--version=')) parsed.version = arg.slice('--version='.length);
    else if (arg.startsWith('--fixture-limit=')) parsed.fixtureLimit = Number(arg.slice('--fixture-limit='.length));
    else if (arg === '--skip-build') parsed.skipBuild = true;
  }
  return parsed;
}

function slug(name: string): string {
  return name.replace(/[^a-zA-Z0-9.-]+/g, '-');
}

async function timedBenchmark(provider: SqliteKnowledgeProvider, version: string, mode: 'lexical' | 'hybrid', label: string): Promise<{ label: string; ms: number; result: BenchmarkResult }> {
  const startedAt = Date.now();
  const result = await runBenchmark(provider, version, { mode });
  return { label, ms: Date.now() - startedAt, result };
}

function row(label: string, timing: { ms: number; result: BenchmarkResult }): string[] {
  return [
    label,
    `${timing.result.passed}/${timing.result.total}`,
    `${((timing.result.passed / timing.result.total) * 100).toFixed(0)}%`,
    timing.result.mrr === null ? 'n/a' : timing.result.mrr.toFixed(3),
    timing.result.chromeViolations === 0 ? 'clean' : String(timing.result.chromeViolations),
    `${(timing.ms / 1000).toFixed(1)}s`,
  ];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = findRepoRoot(process.cwd());
  const activeIndexRoot = getDefaultIndexRoot(repoRoot);

  // ---- 1. Local embedder + comparison build -------------------------------
  const embedder: LocalEmbedder = createLocalEmbedder({ model: args.model });
  const comparisonRoot = path.join(repoRoot, 'data', 'index-compare', slug(embedder.preset.name));
  const comparisonBuildPath = path.join(comparisonRoot, 'builds');

  let embedSeconds: number | null = null;
  let embedCounts: Record<string, number> | null = null;
  if (args.skipBuild) {
    process.stdout.write(`Reusing existing comparison build under ${comparisonRoot}\n`);
  } else {
    process.stdout.write(`Building comparison index with ${embedder.preset.modelId} (one-time model download ~35MB on first run)...\n`);
    const buildStartedAt = Date.now();
    const build = await buildIndex({
      repoRoot,
      indexRoot: comparisonRoot,
      fixtureLimit: args.fixtureLimit,
      withEmbeddings: true,
      embeddingModel: `transformers:${embedder.preset.name}`,
      embed: embedder.embed,
      activate: true, // activates within comparisonRoot only — the serving index is untouched
    });
    embedSeconds = (Date.now() - buildStartedAt) / 1000;
    embedCounts = build.counts;
    if (!build.verification.passed) {
      process.stdout.write(`Comparison build failed verification: ${build.verification.errors.join('; ')}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`Built ${build.runId}: ${build.counts.vectors} vectors, calibration ` +
      `${build.semanticCalibration ? `excellent=${build.semanticCalibration.excellent} irrelevant=${build.semanticCalibration.irrelevant}` : 'NOT MEASURED'}\n`);
  }

  // ---- 2. Open both providers ---------------------------------------------
  const activeProvider = await SqliteKnowledgeProvider.open(activeIndexRoot);
  // The local query embedder is wired through the existing pluggable hook —
  // no OpenAI key involved anywhere in the comparison path.
  const comparisonProvider = await SqliteKnowledgeProvider.open(comparisonRoot, { queryEmbedder: embedder.embedQuery });

  try {
    // ---- 3. Benchmarks -----------------------------------------------------
    const activeLexical = await timedBenchmark(activeProvider, args.version, 'lexical', 'active · lexical (serving behavior)');
    const activeHybrid = await timedBenchmark(activeProvider, args.version, 'hybrid', 'active · hybrid (degrades → lexical)');
    const compareLexical = await timedBenchmark(comparisonProvider, args.version, 'lexical', `compare · lexical (${embedder.preset.name})`);
    const compareHybrid = await timedBenchmark(comparisonProvider, args.version, 'hybrid', `compare · hybrid (${embedder.preset.name} + BM25)`);

    // Query latency sample: 10 hybrid searches against the comparison build.
    const latencyStart = Date.now();
    for (let index = 0; index < 10; index += 1) {
      await comparisonProvider.search({ query: 'cache tags vs contexts block', drupalVersion: args.version, mode: 'hybrid', limit: 8 });
    }
    const avgLatencyMs = (Date.now() - latencyStart) / 10;

    // ---- 4. Report -----------------------------------------------------------
    const manifest = JSON.parse(await readFile(path.join(comparisonRoot, 'active.json'), 'utf8'));
    const lines: string[] = [];
    lines.push('# Local-embedder comparison');
    lines.push('');
    lines.push(`- Model: \`${embedder.preset.modelId}\` (query prefix: \`${JSON.stringify(embedder.preset.queryPrefix)}\`)`);
    lines.push(`- Calibration: ${manifest.semanticCalibration ? `excellent=${manifest.semanticCalibration.excellent}, irrelevant=${manifest.semanticCalibration.irrelevant} (measured ${manifest.semanticCalibration.measuredAt})` : '**missing — comparison build serves lexical-only**'}`);
    if (embedCounts) lines.push(`- Build cost: ${embedCounts.vectors} vectors embedded in ${embedSeconds?.toFixed(0)}s`);
    lines.push(`- Hybrid query latency (comparison build, avg of 10): ${avgLatencyMs.toFixed(0)}ms`);
    lines.push(`- Drupal version scope: ${args.version}${args.fixtureLimit ? ` (fixture limit ${args.fixtureLimit} — NOT representative)` : ''}`);
    lines.push('');
    lines.push('| Run | Pass | Rate | MRR | Chrome | Bench time |');
    lines.push('|---|---|---|---|---|---|');
    for (const timing of [activeLexical, activeHybrid, compareLexical, compareHybrid]) {
      lines.push(`| ${row('', timing).map((cell, index) => index === 0 ? timing.label : cell).join(' | ')} |`);
    }
    lines.push('');
    lines.push('Reading: hybrid is only worth adopting if `compare · hybrid` beats `active · lexical` on pass/MRR WITHOUT regressing identifier-style cases (see per-case results in the JSON report).');
    lines.push('');

    const report = {
      generatedAt: new Date().toISOString(),
      model: embedder.preset,
      version: args.version,
      fixtureLimit: args.fixtureLimit ?? null,
      calibration: manifest.semanticCalibration ?? null,
      build: embedCounts ? { seconds: embedSeconds, counts: embedCounts } : null,
      avgHybridLatencyMs: avgLatencyMs,
      runs: {
        activeLexical: activeLexical.result,
        activeHybrid: activeHybrid.result,
        compareLexical: compareLexical.result,
        compareHybrid: compareHybrid.result,
      },
    };
    const reportPath = path.join(comparisonRoot, 'compare-report.json');
    await mkdir(comparisonRoot, { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    process.stdout.write(`${lines.join('\n')}\n`);
    process.stdout.write(`JSON report (per-case results): ${reportPath}\n`);
  } finally {
    activeProvider.close();
    comparisonProvider.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
