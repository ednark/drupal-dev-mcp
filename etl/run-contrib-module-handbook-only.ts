/**
 * One-shot script: parse, embed, and load ONLY the contrib_module_handbook source.
 *
 * Usage:
 *   npx tsx etl/run-contrib-module-handbook-only.ts
 *
 * Before running, delete the stale table:
 *   rm -rf data/lancedb/contrib_module_handbook.lance
 */
import { parseContribModuleHandbook } from './parse-contrib-module-handbook.js';
import { chunkPages } from './chunker.js';
import { embedChunks } from './embedder.js';
import { loadChunks } from './loader.js';
import { validateConfig } from '../src/config.js';

async function main(): Promise<void> {
  const config = validateConfig();

  console.error('═══════════════════════════════════════════════════');
  console.error('  Contrib-module-handbook-only ETL');
  console.error('═══════════════════════════════════════════════════\n');

  // ── Parse ──────────────────────────────────────────────────────
  console.error('━━━ [1/3] Parsing contrib module handbook pages ━━━');
  const pages = await parseContribModuleHandbook();
  console.error(`  ${pages.length} pages parsed\n`);

  if (pages.length === 0) {
    console.error('❌ No contrib module handbook pages found. Nothing to embed.');
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

  process.env.LANCEDB_TABLE_NAME = 'contrib_module_handbook';
  await loadChunks(embedded, config.lancedbPath);

  console.error('\n✅ Contrib module handbook ETL complete.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
