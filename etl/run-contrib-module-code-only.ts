/**
 * One-shot script: parse, embed, and load ONLY the contrib_module_code source.
 *
 * Usage:
 *   npx tsx etl/run-contrib-module-code-only.ts
 *
 * Before running, delete the stale table:
 *   rm -rf data/lancedb/contrib_module_code.lance
 *
 * To also fetch .api.php and .services.yml files first:
 *   npx tsx scripts/fetch-contrib-api-php.ts
 */
import { parseContribModuleCode } from './parse-contrib-module-code.js';
import { chunkPages } from './chunker.js';
import { embedChunks } from './embedder.js';
import { loadChunks } from './loader.js';
import { validateConfig } from '../src/config.js';

async function main(): Promise<void> {
  const config = validateConfig();

  console.error('═══════════════════════════════════════');
  console.error('  Contrib-module-code-only ETL');
  console.error('═══════════════════════════════════════\n');

  // ── Parse ──────────────────────────────────────────────────────
  console.error('━━━ [1/3] Parsing contrib module code ━━━');
  const pages = await parseContribModuleCode();
  console.error(`  ${pages.length} pages parsed\n`);

  if (pages.length === 0) {
    console.error('❌ No contrib module code pages found. Nothing to embed.');
    console.error('   Run bash scripts/fetch-contrib-module-code.sh first.');
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

  process.env.LANCEDB_TABLE_NAME = 'contrib_module_code';
  await loadChunks(embedded, config.lancedbPath);

  console.error('\n✅ Contrib module code ETL complete.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
