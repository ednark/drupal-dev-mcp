import dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import * as lancedb from '@lancedb/lancedb';
import { embed } from '../src/lib/openai.js';

const DB_PATH = './data/lancedb';

async function run() {
  console.log('Connecting to LanceDB at', DB_PATH);
  const db = await lancedb.connect(DB_PATH);

  // Discover .lance directories
  const entries = fs.readdirSync(DB_PATH, { withFileTypes: true });
  const tables = entries
    .filter((e) => e.isDirectory() && e.name.endsWith('.lance'))
    .map((e) => e.name.replace(/\.lance$/, ''));

  if (tables.length === 0) {
    console.log('No .lance tables found in', DB_PATH);
    return;
  }

  for (const tableName of tables) {
    console.log(`\nTable discovered: ${tableName}`);
    let table: any;
    try {
      table = await db.openTable(tableName);
    } catch (err) {
      console.error('  Failed to open table', tableName, err);
      continue;
    }

    // Try to get a row count using known APIs; fallback to counting data files.
    let rowCount: number | null = null;
    try {
      if (typeof table.count === 'function') {
        rowCount = await table.count();
      }
    } catch (err) {
      rowCount = null;
    }

    if (rowCount === null) {
      // Fallback: count records by scanning a small sample via vectorSearch with a short embedding
      try {
        const sampleVec = await embed('sample');
        const sample = await table.vectorSearch(sampleVec).limit(1).toArray();
        // If we got results, we can't know total rows; indicate unknown but show sample exists.
        rowCount = sample.length > 0 ? -1 : 0; // -1 means unknown but table has data
      } catch (err) {
        rowCount = 0;
      }
    }

    if (rowCount === -1) {
      console.log('  Row count: unknown (table appears populated)');
    } else {
      console.log('  Row count:', rowCount);
    }

    // Print a small sample excerpt: search for the token 'AlertMessage' and also run a generic API query
    const probes = ['AlertMessage', 'content type', 'ContentEntityType'];
    for (const probe of probes) {
      try {
        const vec = await embed(probe);
        const results = await table.vectorSearch(vec).limit(3).toArray();
        console.log(`  Probe: "${probe}" -> ${results.length} results`);
        results.forEach((r: any, i: number) => {
          const txt = (r.text ?? '').replace(/\s+/g, ' ').slice(0, 300);
          console.log(`    #${i + 1} [distance: ${r._distance?.toFixed(6) ?? 'NA'}] file=${r.file_path} symbol=${r.symbol_name}`);
          console.log(`      "${txt.replace(/\"/g, '\\"')}"`);
        });
      } catch (err) {
        console.error('    Probe failed for', probe, err);
      }
    }
  }

  console.log('\nDiagnostics complete.');
}

run().catch((err) => {
  console.error('Diagnostics script failed:', err);
  process.exit(1);
});

