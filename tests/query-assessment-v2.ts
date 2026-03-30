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
  'How to create a custom content type called AlertMessage in a Drupal module',
  'ContentEntityType annotation base field definitions module',
  'Drupal custom entity baseFieldDefinitions title message severity fields',
  'hook_entity_type_build add entity type to Drupal module',
  'Drupal module file structure info.yml routing.yml services.yml',
  'ContentEntityBase extends implements AlertMessage entity',
  'Drupal custom content type bundle field definition required fields',
];

async function run() {
  for (const q of QUERIES) {
    console.log(`=== QUERY: "${q}" ===`);
    const vec = await embed(q);

    // Search the core docs table
    const coreResults = await vectorSearch(vec, 8);
    printResults(TABLE_NAMES.core, coreResults as any as Result[]);

    // Search the developer guides table explicitly
    const devResults = await vectorSearch(vec, 8, TABLE_NAMES.developerGuides);
    printResults(TABLE_NAMES.developerGuides, devResults as any as Result[]);

    console.log('\n');
  }

  console.log('=== DONE ===');
}

function printResults(table: string, results: Result[]) {
  console.log(`Table: ${table}`);
  if (!results || results.length === 0) {
    console.log('  (no results)');
    return;
  }

  results.forEach((r, idx) => {
    const snippet = (r.text ?? '').replace(/\s+/g, ' ').slice(0, 250);
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

