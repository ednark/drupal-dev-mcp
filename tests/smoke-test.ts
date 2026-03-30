import * as lancedb from '@lancedb/lancedb';
import { embed } from '../src/lib/openai.js';
import { validateConfig } from '../src/config.js';

const SMOKE_TABLE = 'smoke_test';

async function main() {
  console.error('🔥 Smoke Test: LanceDB + OpenAI Integration\n');

  // Step 0: Validate config
  const config = validateConfig();
  console.error('✓ Config validated');

  // Step 1: Open LanceDB (fully embedded, in-process)
  const db = await lancedb.connect(config.lancedbPath);
  console.error('✓ LanceDB connection opened at:', config.lancedbPath);

  // Step 2: Generate embedding
  const testText = 'How do I implement a custom access checker in Drupal?';
  console.error(`\nEmbedding: "${testText}"`);
  const queryEmbedding = await embed(testText);
  console.error(`✓ Embedding generated: ${queryEmbedding.length} dimensions`);

  // Step 3: Create test table with sample records
  const records = [
    {
      id: 'smoke-001',
      text: 'AccessCheckInterface defines access() and applies() methods for custom access checking in Drupal routing.',
      vector: queryEmbedding,
      source: 'drupal_phpdoc',
      symbol_name: 'AccessCheckInterface',
      fqcn: 'Drupal\\Core\\Routing\\Access\\AccessCheckInterface',
      file_path: 'core/lib/Drupal/Core/Routing/Access/AccessCheckInterface.php',
      drupal_version: '11.x',
      section: '',
      chunk_index: 0,
      ingested_at: new Date().toISOString(),
    },
    {
      id: 'smoke-002',
      text: 'The Form API allows creating complex forms with validation and submission handlers.',
      vector: await embed('Drupal Form API form building validation submission'),
      source: 'drupal_phpdoc',
      symbol_name: 'FormInterface',
      fqcn: 'Drupal\\Core\\Form\\FormInterface',
      file_path: 'core/lib/Drupal/Core/Form/FormInterface.php',
      drupal_version: '11.x',
      section: '',
      chunk_index: 0,
      ingested_at: new Date().toISOString(),
    },
  ];

  // Drop table if exists from previous run
  try {
    await db.dropTable(SMOKE_TABLE);
  } catch {
    // Table doesn't exist yet — that's fine
  }

  const table = await db.createTable(SMOKE_TABLE, records);
  console.error(`✓ Test table '${SMOKE_TABLE}' created with ${records.length} records`);

  // Step 4: Vector similarity search
  const results = await table.vectorSearch(queryEmbedding).limit(1).toArray();

  if (results.length === 0) {
    console.error('❌ No results returned from vector search');
    process.exit(1);
  }

  const top = results[0] as Record<string, unknown>;
  console.error(`✓ Query result: id: ${top.id}, symbol_name: ${top.symbol_name}, _distance: ${top._distance}`);

  // Step 5: Cleanup
  await db.dropTable(SMOKE_TABLE);
  console.error(`✓ Test table '${SMOKE_TABLE}' cleaned up`);

  console.error('\n✅ Smoke test PASSED — LanceDB and OpenAI are working correctly.');
}

main().catch((err) => {
  console.error('❌ Smoke test FAILED:', err);
  process.exit(1);
});
