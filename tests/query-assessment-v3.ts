import dotenv from 'dotenv';
dotenv.config();

import { embed } from '../src/lib/openai.js';
import { vectorSearch, getDb, TABLE_NAMES } from '../src/lib/lancedb.js';

type Result = {
  symbol_name: string;
  section: string;
  file_path: string;
  _distance: number;
  text: string;
};

const QUERIES = [
  'Create a custom Drupal content entity type called AlertMessage with title, message body, and severity fields',
  'ContentEntityType annotation module structure baseFieldDefinitions',
  'Drupal custom module info.yml routing.yml step by step guide',
  'hook_entity_type_build entity type definition hooks',
  'ContentEntityBase extends custom entity class',
];

async function run() {
  // Ensure DB opens at the requested path explicitly.
  await getDb('./data/lancedb');

  for (const q of QUERIES) {
    console.log(`=== QUERY: "${q}" ===\n`);

    const vec = await embed(q);

    // Search drupal_core_docs (default table)
    const coreResults = (await vectorSearch(vec, 5)) as any as Result[];

    console.log('[drupal_core_docs]');
    if (!coreResults || coreResults.length === 0) {
      console.log('  (no results)');
    } else {
      coreResults.forEach((r, idx) => {
        const snippet = (r.text ?? '').replace(/\s+/g, ' ').slice(0, 300);
        console.log(
          `  #${idx + 1} dist=${r._distance?.toFixed(3) ?? 'NA'} | ${r.symbol_name} | ${r.section} | ${r.file_path}`,
        );
        console.log(`     "${snippet.replace(/\"/g, '\\"')}"`);
      });
    }

    console.log('\n[drupal_developer_guides]');
    const devResults = (await vectorSearch(vec, 5, 'drupal_developer_guides')) as any as Result[];
    if (!devResults || devResults.length === 0) {
      console.log('  (no results)');
    } else {
      devResults.forEach((r, idx) => {
        const snippet = (r.text ?? '').replace(/\s+/g, ' ').slice(0, 300);
        // Developer guides may not have symbol_name; print section first per spec
        console.log(
          `  #${idx + 1} dist=${r._distance?.toFixed(3) ?? 'NA'} | ${r.section} | ${r.file_path}`,
        );
        console.log(`     "${snippet.replace(/\"/g, '\\"')}"`);
      });
    }

    console.log('\n');
  }

  console.log('=== DONE ===');
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});

