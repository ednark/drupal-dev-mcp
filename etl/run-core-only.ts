/**
 * One-shot script: parse, embed, and load ONLY the drupal_core_docs sources.
 *
 * Sources included:
 *   - parsePHPDocFiles  (drupal-core PHPDoc annotations)
 *   - parseUserGuideMarkdown  (drupal-user-guide.md)
 *
 * Sources intentionally excluded:
 *   - parseDocset  (drupal_docset HTML overlaps with phpdoc; phpdoc is higher-quality)
 *
 * Usage:
 *   npx tsx etl/run-core-only.ts
 *
 * Before running, delete the stale table:
 *   rm -rf data/lancedb/drupal_core_docs.lance
 */
import { parsePHPDocFiles, parseUserGuideMarkdown } from './parser.js';
import { chunkPages } from './chunker.js';
import { embedChunks } from './embedder.js';
import { loadChunks } from './loader.js';
import { validateConfig } from '../src/config.js';

async function main(): Promise<void> {
  const config = validateConfig();

  console.error('═══════════════════════════════════════');
  console.error('  Core-docs-only ETL (drupal_core_docs)');
  console.error('═══════════════════════════════════════\n');

  // ── Parse ──────────────────────────────────────────────────────
  console.error('━━━ [1/3] Parsing core doc sources ━━━');

  const coreDir = `${config.etlSourcesDir}/drupal-core`;
  const userGuideMd = `${config.etlSourcesDir}/drupal-user-guide.md`;

  const [phpdocPages, guidePages] = await Promise.all([
    parsePHPDocFiles(coreDir, config.drupalCoreBranch).catch((err) => {
      console.error(`  ⚠ PHPDoc parser failed: ${err.message}`);
      return [];
    }),
    parseUserGuideMarkdown(userGuideMd).catch((err) => {
      console.error(`  ⚠ User Guide parser failed: ${err.message}`);
      return [];
    }),
  ]);

  console.error(`  PHPDoc pages:     ${phpdocPages.length.toLocaleString()}`);
  console.error(`  User Guide pages: ${guidePages.length.toLocaleString()}`);

  const pages = [...phpdocPages, ...guidePages];
  console.error(`  Total pages:      ${pages.length.toLocaleString()}\n`);

  if (pages.length === 0) {
    console.error('❌ No core doc pages found. Check data/sources/ directory.');
    process.exit(1);
  }

  // ── Chunk ──────────────────────────────────────────────────────
  console.error('━━━ [2/3] Chunking ━━━');
  const chunks = await chunkPages(pages);
  console.error(`  ${chunks.length.toLocaleString()} chunks produced\n`);

  const avgLen = Math.round(chunks.reduce((s, c) => s + c.text.length, 0) / chunks.length);
  console.error(`  Avg chunk length: ${avgLen} chars`);
  console.error(`  Est. cost: $${((chunks.length * avgLen / 4 / 1_000_000) * 0.02).toFixed(4)}\n`);

  // ── Embed & Load ──────────────────────────────────────────────
  console.error('━━━ [3/3] Embedding & loading into LanceDB ━━━');
  const embedded = await embedChunks(chunks);

  process.env.LANCEDB_TABLE_NAME = 'drupal_core_docs';
  await loadChunks(embedded, config.lancedbPath);

  console.error('\n✅ Core docs ETL complete.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
