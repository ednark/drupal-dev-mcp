/**
 * One-shot script: parse, embed, and load ONLY the drupal_best_practices source.
 *
 * Usage:
 *   npm run fetch:best-practices   # clone/pull the repo first
 *   npm run etl:best-practices     # run this script
 *
 * To rebuild from scratch, delete the stale table first:
 *   rm -rf data/lancedb/drupal_best_practices.lance
 */
import { parseBestPractices } from './parse-best-practices.js';
import { chunkPages } from './chunker.js';
import { embedChunks } from './embedder.js';
import { loadChunks } from './loader.js';
import { validateConfig } from '../src/config.js';

async function main(): Promise<void> {
  const config = validateConfig();

  console.error('═══════════════════════════════════════');
  console.error('  Best Practices-only ETL');
  console.error('═══════════════════════════════════════\n');

  // ── Parse ──────────────────────────────────────────────────────
  console.error('━━━ [1/3] Parsing drupal-best-practices ━━━');
  const pages = await parseBestPractices(config.etlSourcesDir);
  console.error(`  ${pages.length} pages parsed\n`);

  if (pages.length === 0) {
    console.error('❌ No best-practices pages found. Nothing to embed.');
    console.error('   Run `npm run fetch:best-practices` first.');
    process.exit(1);
  }

  // ── Chunk ──────────────────────────────────────────────────────
  console.error('━━━ [2/3] Chunking ━━━');
  const chunks = await chunkPages(pages);
  console.error(`  ${chunks.length} chunks produced\n`);

  const avgLen = Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length);
  console.error(`  Avg chunk length: ${avgLen} chars`);
  console.error(`  Est. cost: $${((chunks.length * avgLen / 4 / 1_000_000) * 0.02).toFixed(4)}\n`);

  // ── Embed & Load ──────────────────────────────────────────────
  console.error('━━━ [3/3] Embedding & loading into LanceDB ━━━');
  const embedded = await embedChunks(chunks);

  process.env.LANCEDB_TABLE_NAME = 'drupal_best_practices';
  await loadChunks(embedded, config.lancedbPath);

  console.error('\n✅ Best practices ETL complete.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
