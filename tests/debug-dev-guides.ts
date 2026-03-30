import dotenv from 'dotenv';
dotenv.config();

// Diagnostic script to inspect LanceDB tables for developer guides vs core docs.
// Run with: npx tsx tests/debug-dev-guides.ts

import * as lancedb from '@lancedb/lancedb';
import fs from 'fs';

async function inspectTable(db: any, name: string) {
  console.log('\n--- Inspecting table:', name, '---');
  const table = await db.openTable(name);
  // Raw scan
  const arrow = await table.query().toArrow();
  console.log('Row count:', arrow.numRows);
  try {
    console.log('Schema:', arrow.schema.toString());
  } catch (e) {
    console.log('Schema: (could not toString)');
  }

  const rowsToShow = Math.min(3, arrow.numRows);
  if (rowsToShow === 0) return { table, arrow };

  const arr = arrow.slice(0, rowsToShow).toArray();
  for (let i = 0; i < arr.length; i++) {
    console.log(`\nRow ${i + 1}:`);
    const row = arr[i];
    for (const [k, v] of Object.entries(row)) {
      let out = v as any;
      if (typeof out === 'string') {
        out = out.length > 100 ? out.substring(0, 100) + '... (truncated)' : out;
      }
      console.log(`  ${k}:`, out);
    }
  }

  return { table, arrow };
}

async function tryVectorSearch(table: any, name: string, embedding: number[] | null) {
  console.log(`\n--- Vector search tests on ${name} ---`);
  if (!embedding) {
    console.log('No embedding provided; skipping vector search tests.');
    return;
  }

  try {
    console.log('Searching using column "vector" explicitly...');
    const r1 = await table.vectorSearch(embedding).column('vector').limit(5).toArrow();
    console.log('Results (column vector) count:', r1.numRows);
  } catch (e) {
    console.log('Error when searching with column("vector"):', e?.message ?? e);
  }

  try {
    console.log('Searching using default column (no column specified)...');
    const r2 = await table.vectorSearch(embedding).limit(5).toArrow();
    console.log('Results (default) count:', r2.numRows);
  } catch (e) {
    console.log('Error when searching with default column:', e?.message ?? e);
  }
}

async function main() {
  const dbPath = './data/lancedb';
  if (!fs.existsSync(dbPath)) {
    console.error('LanceDB path not found:', dbPath);
    process.exit(2);
  }

  const db = await lancedb.connect(dbPath);

  const dev = await inspectTable(db, 'drupal_developer_guides');
  const core = await inspectTable(db, 'drupal_core_docs');

  // Optionally compute an embedding for a test query using OpenAI if available
  let embedding: number[] | null = null;
  try {
    // Dynamically import the project's embedding helper if present
    // Note: import path uses .js to match ESM resolution in this project
    const embModule = await import('../src/lib/openai.js');
    if (typeof embModule.embedText === 'function') {
      console.log('\nComputing embedding for test query using src/lib/openai.embedText()');
      embedding = await embModule.embedText('ContentEntityType custom module baseFieldDefinitions');
    } else if (typeof embModule.getEmbedding === 'function') {
      embedding = await embModule.getEmbedding('ContentEntityType custom module baseFieldDefinitions');
    } else {
      console.log('No embedding helper found in src/lib/openai. Skipping embedding-based vector search.');
    }
  } catch (e) {
    const err: any = e;
    console.log('Could not compute embedding (openai helper missing or failed):', err?.message ?? err);
  }

  if (dev?.table) await tryVectorSearch(dev.table, 'drupal_developer_guides', embedding);
  if (core?.table) await tryVectorSearch(core.table, 'drupal_core_docs', embedding);

  console.log('\nDiagnostic script finished.');
}

main().catch((e) => {
  console.error('Fatal error in diagnostic script:', e);
  process.exit(1);
});
