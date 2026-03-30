/**
 * One-shot script: parse, embed, and load ONLY the api_drupal_org_docs source.
 *
 * Usage:
 *   npx tsx etl/run-api-drupal-org-only.ts
 *
 * Before running, delete the stale table:
 *   rm -rf data/lancedb/api_drupal_org_docs.lance
 *
 * To also fetch fresh topic pages first (both HTML via Playwright and Markdown via Jina):
 *   bash scripts/fetch-api-drupal-org.sh
 *   npx tsx scripts/fetch-api-drupal-org-topics.ts
 */
import { parseApiDrupalOrgDocs } from './parse-api-drupal-org.js';
import { chunkPages } from './chunker.js';
import { embedChunks } from './embedder.js';
import { loadChunks } from './loader.js';
import { validateConfig } from '../src/config.js';

async function main(): Promise<void> {
  const config = validateConfig();

  console.error('═══════════════════════════════════════');
  console.error('  api.drupal.org-docs-only ETL');
  console.error('═══════════════════════════════════════\n');

  // ── Parse ──────────────────────────────────────────────────────
  console.error('━━━ [1/3] Parsing api.drupal.org docs ━━━');
  const pages = await parseApiDrupalOrgDocs(config.etlSourcesDir);
  console.error(`  ${pages.length} pages parsed\n`);

  if (pages.length === 0) {
    console.error('❌ No api.drupal.org pages found. Nothing to embed.');
    console.error('   Run bash scripts/fetch-api-drupal-org.sh first.');
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

  process.env.LANCEDB_TABLE_NAME = 'api_drupal_org_docs';
  await loadChunks(embedded, config.lancedbPath);

  console.error('\n✅ api.drupal.org docs ETL complete.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
