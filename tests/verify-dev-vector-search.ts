import dotenv from 'dotenv';
dotenv.config();

import * as lancedb from '@lancedb/lancedb';
import fs from 'fs';

async function main() {
  const dbPath = './data/lancedb';
  if (!fs.existsSync(dbPath)) {
    console.error('LanceDB path not found:', dbPath);
    process.exit(2);
  }

  const db = await lancedb.connect(dbPath);
  const table = await db.openTable('drupal_developer_guides');

  const rows = await table.query().toArray();
  console.log('Rows returned from toArray():', rows.length);
  if (rows.length === 0) process.exit(0);

  const firstVec = rows[0].vector as Float32Array | number[];
  console.log('Type of firstVec:', Object.prototype.toString.call(firstVec));

  // Use first row vector as probe
  const probe = firstVec instanceof Float32Array ? firstVec : new Float32Array(firstVec as number[]);

  try {
    const r1 = await table.vectorSearch(probe).column('vector').limit(5).toArray();
    console.log("Results (explicit 'vector' column):", r1.length);
    if (r1.length > 0) console.log('Top result id:', r1[0].id, 'source:', r1[0].source, 'drupal_version:', r1[0].drupal_version);
  } catch (e) {
    console.error('Error searching with explicit column:', e);
  }

  try {
    const r2 = await table.vectorSearch(probe).limit(5).toArray();
    console.log('Results (default column):', r2.length);
    if (r2.length > 0) console.log('Top result id:', r2[0].id, 'source:', r2[0].source, 'drupal_version:', r2[0].drupal_version);
  } catch (e) {
    console.error('Error searching with default column:', e);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});

