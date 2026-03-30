import * as lancedb from '@lancedb/lancedb';
import { chunkPages } from './chunker.js';
import { embedChunks } from './embedder.js';
import { loadChunks } from './loader.js';
import { parseUserGuideMarkdown } from './parser.js';
import { validateConfig } from '../src/config.js';
import { embed } from '../src/lib/openai.js';

const TEST_PAGE_LIMIT = 5;
const TABLE_NAME = 'drupal_core_docs';
const EXPECTED_DIMS = 1536;
const DISTANCE_THRESHOLD = 2.0;

async function main() {
  console.error('🔬 Mini ETL Verification: Parse → Chunk → Embed → Load → Query\n');

  // Step 1: Parse
  const allPages = await parseUserGuideMarkdown('data/sources/drupal-user-guide.md');
  const pages = allPages.slice(0, TEST_PAGE_LIMIT);
  console.error(`✓ Parsed ${pages.length} pages (from ${allPages.length} available)`);

  // Step 2: Chunk
  const chunks = await chunkPages(pages);
  console.error(`✓ Chunked into ${chunks.length} chunks`);

  // Step 3: Embed
  const embedded = await embedChunks(chunks);
  console.error(`✓ Embedded ${embedded.length} chunks`);
  console.error(`  First embedding dimensions: ${embedded[0]?.embedding.length}`);

  // Step 4: Load
  const config = validateConfig();
  const rowCount = await loadChunks(embedded, config.lancedbPath);
  console.error(`✓ Loaded ${rowCount} rows into LanceDB`);

  // Step 5: Query
  const queryText = 'How do I install Drupal modules?';
  console.error(`\nQuerying: "${queryText}"`);
  const queryVector = await embed(queryText);

  const db = await lancedb.connect(config.lancedbPath);
  const table = await db.openTable(TABLE_NAME);
  const results = await table.vectorSearch(queryVector).limit(3).toArray();

  console.error(`\nTop ${results.length} results:`);
  for (const row of results) {
    const r = row as Record<string, unknown>;
    console.error(`  - symbol_name: ${r.symbol_name}, section: ${r.section}, _distance: ${r._distance}`);
    console.error(`    text: ${(r.text as string)?.slice(0, 100)}...`);
  }

  // Step 6: Verify
  const embeddingDims = embedded[0]?.embedding.length;
  const distanceValues = results
    .map((row) => (row as Record<string, unknown>)._distance)
    .filter((d): d is number => typeof d === 'number');

  const allPass = [
    embeddingDims === EXPECTED_DIMS,
    rowCount === chunks.length,
    results.length > 0,
    distanceValues.length > 0,
    distanceValues.every((d) => d < DISTANCE_THRESHOLD),
  ];

  if (allPass.every(Boolean)) {
    console.error('\n✅ Mini ETL verification PASSED');
    console.error(`  Embedding dims: ${embeddingDims}`);
    console.error(`  Row count match: ${rowCount} === ${chunks.length}`);
    console.error(`  Distances < ${DISTANCE_THRESHOLD}: ${distanceValues.join(', ')}`);
  }
  else {
    console.error('\n❌ Mini ETL verification FAILED');
    console.error('  Embedding dims:', embeddingDims);
    console.error('  Row count match:', rowCount, '===', chunks.length);
    console.error('  Results found:', results.length);
    console.error(`  Distances < ${DISTANCE_THRESHOLD}:`, distanceValues);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});

