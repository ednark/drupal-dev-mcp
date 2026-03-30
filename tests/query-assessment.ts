import dotenv from 'dotenv';
dotenv.config();

import { embed } from '../src/lib/openai.js';
import { vectorSearch, TABLE_NAMES } from '../src/lib/lancedb.js';

type Result = {
  symbol_name: string;
  section: string;
  file_path: string;
  _distance: number;
  text: string;
};

const QUERIES = [
  'How to create a custom content type in Drupal with a module',
  'Drupal module development hook_entity_type_build content type definition',
  'AlertMessage content type custom field schema',
  'Drupal entity API custom node type bundle definition',
  'content type plugin annotation ContentEntityType',
];

async function run() {
  for (const q of QUERIES) {
    console.log(`=== QUERY: "${q}" ===\n`);

    const vec = await embed(q);

    // Search the core docs table
    const coreResults = await vectorSearch(vec, 8);
    printResults(TABLE_NAMES.core, q, coreResults as any as Result[]);

    // Search the developer guides table explicitly
    const devResults = await vectorSearch(vec, 8, TABLE_NAMES.developerGuides);
    printResults(TABLE_NAMES.developerGuides, q, devResults as any as Result[]);

    console.log('\n');
  }

  console.log('=== DONE ===');
}

function printResults(table: string, query: string, results: Result[]) {
  console.log(`Table: ${table}`);
  if (!results || results.length === 0) {
    console.log('  (no results)');
    return;
  }

  results.forEach((r, idx) => {
    const snippet = (r.text ?? '').replace(/\s+/g, ' ').slice(0, 300);
    console.log(
      `  #${idx + 1} [distance: ${r._distance?.toFixed(6) ?? 'NA'}] symbol_name=${r.symbol_name}, section=${r.section}, file_path=${r.file_path}`,
    );
    console.log(`      "${snippet.replace(/\"/g, '\\"')}"`);
  });
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});

