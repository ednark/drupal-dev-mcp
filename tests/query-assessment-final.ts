import dotenv from 'dotenv';
dotenv.config();

import * as lancedb from '@lancedb/lancedb';
import { embed } from '../src/lib/openai.js';

const QUERIES = [
  'Create a custom Drupal content entity type called AlertMessage with title, message body, and severity fields',
  'ContentEntityType baseFieldDefinitions Drupal 10 module annotation',
  'Drupal module info.yml routing.yml step by step guide create module',
  'hook_entity_type_build Drupal entity type definition hooks',
  'Drupal services dependency injection ContainerInjectionInterface',
  'Drupal custom field type BaseFieldDefinition list_string integer string',
];

const TABLES = ['drupal_core_docs', 'drupal_developer_guides'];

function preview(text: string | undefined, n = 300) {
  return (String(text || '')).replace(/\s+/g, ' ').slice(0, n);
}

function scoreToRating(distance: number | null): number {
  if (distance === null) return 1;
  if (distance < 0.5) return 5;
  if (distance < 0.7) return 4;
  if (distance < 0.85) return 3;
  if (distance < 1.0) return 2;
  return 1;
}

async function run() {
  // Connect directly to LanceDB local store
  const db = await lancedb.connect('./data/lancedb');

  // Open tables up-front
  const openTables: Record<string, any> = {};
  for (const t of TABLES) {
    try {
      openTables[t] = await db.openTable(t);
    } catch (e) {
      console.error(`Table not found: ${t}`);
      openTables[t] = null;
    }
  }

  // Collect best distances and best matching file for final verdict
  const verdicts: Array<{
    query: string;
    dev_best_distance: number | null;
    dev_best_file: string | null;
    core_best_distance: number | null;
    rating: number;
  }> = [];

  for (const q of QUERIES) {
    console.log('\n=== QUERY: "' + q + '" ===');
    const emb = await embed(q);
    const probe = new Float32Array(emb);

    let devBest: { distance: number; file: string | null } | null = null;
    let coreBest: { distance: number } | null = null;

    for (const t of TABLES) {
      console.log('\n-- Table: ' + t + ' --');
      const table = openTables[t];
      if (!table) {
        console.log('  (table not available)');
        continue;
      }

      try {
        const results = await table.vectorSearch(probe).limit(5).toArray();
        if (!results || results.length === 0) {
          console.log('  (no results)');
          continue;
        }

        for (let i = 0; i < results.length; i++) {
          const r = results[i] as any;
          const distance = typeof r._distance !== 'undefined' ? Number(r._distance) : null;
          console.log(
            `  #${i + 1} [distance: ${distance !== null ? distance.toFixed(6) : 'NA'}] symbol_name=${r.symbol_name}, section=${r.section}, file_path=${r.file_path}`,
          );
          console.log(`      "${preview(r.text, 300).replace(/\"/g, '\\"')}"`);

          if (t === 'drupal_developer_guides') {
            if (distance !== null && (devBest === null || distance < devBest.distance)) {
              devBest = { distance, file: r.file_path ?? r.source ?? null };
            }
          } else if (t === 'drupal_core_docs') {
            if (distance !== null && (coreBest === null || distance < coreBest.distance)) {
              coreBest = { distance };
            }
          }
        }
      } catch (err) {
        console.error('  Error during vectorSearch:', err);
      }
    }

    const dev_dist = devBest ? devBest.distance : null;
    const core_dist = coreBest ? coreBest.distance : null;
    const rating = scoreToRating(dev_dist ?? core_dist ?? null);

    verdicts.push({
      query: q,
      dev_best_distance: dev_dist,
      dev_best_file: devBest ? devBest.file : null,
      core_best_distance: core_dist,
      rating,
    });

    console.log('\n---------------------------------------------');
  }

  // Print final verdict table
  console.log('\n=== FINAL VERDICT TABLE ===');
  console.log('| Query | drupal_developer_guides best distance | Content matched | drupal_core_docs best distance | Rating |');
  console.log('|-------|---------------------------------------|----------------|-------------------------------|--------|');
  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i];
    const qIndex = i + 1;
    const devD = v.dev_best_distance !== null ? v.dev_best_distance.toFixed(6) : 'NA';
    const coreD = v.core_best_distance !== null ? v.core_best_distance.toFixed(6) : 'NA';
    const file = v.dev_best_file ?? '';
    console.log(`| ${qIndex} | ${devD} | ${file} | ${coreD} | ${v.rating} |`);
  }

  console.log('\n=== DONE ===');
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
