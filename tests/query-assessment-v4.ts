/**
 * query-assessment-v4.ts
 *
 * Extends query-assessment-v3 with a new `top_k_from_each` mode that queries
 * every LanceDB table independently and shows results grouped by source.
 *
 * Usage:
 *   # Default: top_k_from_each mode, all questions, 5 results per table
 *   npx ts-node --project tsconfig.json tests/query-assessment-v4.ts
 *
 *   # Explicitly select mode
 *   npx ts-node --project tsconfig.json tests/query-assessment-v4.ts --mode top_k_from_each
 *   npx ts-node --project tsconfig.json tests/query-assessment-v4.ts --mode v3_compat
 *
 *   # Tune top-K per source (top_k_from_each mode only)
 *   npx ts-node --project tsconfig.json tests/query-assessment-v4.ts --topk 3
 *
 *   # Run a single ad-hoc query instead of the built-in list
 *   npx ts-node --project tsconfig.json tests/query-assessment-v4.ts --query "How do I implement a service in Drupal?"
 */

import dotenv from 'dotenv';
dotenv.config();

import * as lancedb from '@lancedb/lancedb';
import { embed } from '../src/lib/openai.js';
import { getDb, vectorSearch } from '../src/lib/lancedb.js';

// ─── CLI argument parsing ────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const MODE: string = getArg('--mode') ?? 'top_k_from_each';
const TOP_K_PER_SOURCE: number = parseInt(getArg('--topk') ?? '5', 10);
const SINGLE_QUERY: string | undefined = getArg('--query');

// ─── Tables ──────────────────────────────────────────────────────────────────

/**
 * All LanceDB tables present in data/lancedb/.
 * Listed in rough priority order (most Drupal-specific first).
 */
const ALL_TABLES: string[] = [
  'drupal_core_docs',
  'drupal_developer_guides',
  'drupal_tutorials',
  'api_drupal_org_docs',
  'certification_docs',
  'contrib_module_docs',
  'contrib_module_code',
  'php_docs',
  'symfony_docs',
];

// ─── Test queries (from manual-test-questions.md) ────────────────────────────

const QUERIES: string[] = SINGLE_QUERY
  ? [SINGLE_QUERY]
  : [
      'How do I implement a custom access checker as a tagged service in Drupal?',
      'How does hook_entity_presave() work and how do I alter a node before saving?',
      'Explain the Drupal plugin system and how annotation-based discovery works.',
      'How do I create a custom config entity with a YAML schema?',
      'How do I load entities by a field value in Drupal?',
      'How do cache tags work for node-dependent content in Drupal?',
      'How do I create a custom route with a dynamic parameter in Drupal?',
      'What is the difference between a Migrate source plugin and a process plugin?',
      'How do I create an event subscriber in Drupal?',
      'How does hook_form_alter() work and how do I add a custom validator?',
    ];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hr(char = '─', width = 80): string {
  return char.repeat(width);
}

function formatSnippet(text: string | undefined, maxLen = 280): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function resultLabel(r: Record<string, unknown>): string {
  return (
    (r['symbol_name'] as string) ||
    (r['section'] as string) ||
    (r['file_path'] as string) ||
    '(unknown)'
  );
}

// ─── Mode: top_k_from_each ───────────────────────────────────────────────────

/**
 * For each query, search EVERY table independently with TOP_K_PER_SOURCE results.
 * Results are grouped by table so gaps across sources are immediately visible.
 */
async function runTopKFromEach(): Promise<void> {
  console.log(hr('═'));
  console.log(`MODE: top_k_from_each   TOP_K=${TOP_K_PER_SOURCE}   QUERIES=${QUERIES.length}`);
  console.log(hr('═'));

  // Open DB connection once
  const db = await getDb('./data/lancedb');

  // Pre-open (or record-as-missing) each table
  const openedTables: Record<string, lancedb.Table | null> = {};
  for (const tableName of ALL_TABLES) {
    try {
      openedTables[tableName] = await db.openTable(tableName);
    } catch {
      openedTables[tableName] = null;
      console.warn(`[WARN] Table "${tableName}" could not be opened — skipping.`);
    }
  }

  console.log('');

  for (const query of QUERIES) {
    console.log(hr('═'));
    console.log(`QUERY: "${query}"`);
    console.log(hr('═'));

    // Embed once, reuse across all tables
    const vec = await embed(query);

    for (const tableName of ALL_TABLES) {
      const table = openedTables[tableName];

      console.log(`\n${hr('─')}`);
      console.log(`  TABLE: ${tableName}`);
      console.log(hr('─'));

      if (!table) {
        console.log('  (table not available)');
        continue;
      }

      try {
        const raw = await table.vectorSearch(vec).limit(TOP_K_PER_SOURCE).toArray();
        const results = raw as Array<Record<string, unknown>>;

        if (!results || results.length === 0) {
          console.log('  (no results)');
          continue;
        }

        results.forEach((r, idx) => {
          const dist = typeof r['_distance'] === 'number'
            ? (r['_distance'] as number).toFixed(4)
            : 'N/A';
          const label = resultLabel(r);
          const sourceUrl = (r['source'] as string | undefined) ?? '';
          const snippet = formatSnippet(r['text'] as string | undefined);

          console.log(`  #${idx + 1}  dist=${dist}  |  ${label}`);
          if (sourceUrl && sourceUrl !== label) {
            console.log(`        source: ${sourceUrl}`);
          }
          console.log(`        "${snippet}"`);
        });
      } catch (err) {
        console.log(`  (error querying table: ${err instanceof Error ? err.message : String(err)})`);
      }
    }

    console.log('\n');
  }

  console.log(hr('═'));
  console.log('DONE — top_k_from_each assessment complete.');
  console.log(hr('═'));
}

// ─── Mode: v3_compat ─────────────────────────────────────────────────────────

/**
 * Reproduces the exact behaviour of query-assessment-v3.ts:
 * searches drupal_core_docs and drupal_developer_guides via the
 * existing vectorSearch() helper.
 */
async function runV3Compat(): Promise<void> {
  console.log(hr('═'));
  console.log('MODE: v3_compat (drupal_core_docs + drupal_developer_guides)');
  console.log(hr('═'));

  await getDb('./data/lancedb');

  for (const q of QUERIES) {
    console.log(`\n=== QUERY: "${q}" ===\n`);

    const vec = await embed(q);

    // drupal_core_docs (default table in vectorSearch)
    const coreResults = await vectorSearch(vec, 5) as Array<Record<string, unknown>>;

    console.log('[drupal_core_docs]');
    if (!coreResults || coreResults.length === 0) {
      console.log('  (no results)');
    } else {
      coreResults.forEach((r, idx) => {
        const dist = typeof r['_distance'] === 'number'
          ? (r['_distance'] as number).toFixed(3)
          : 'NA';
        const snippet = formatSnippet(r['text'] as string | undefined, 300);
        console.log(
          `  #${idx + 1} dist=${dist} | ${r['symbol_name'] ?? ''} | ${r['section'] ?? ''} | ${r['file_path'] ?? ''}`,
        );
        console.log(`     "${snippet}"`);
      });
    }

    console.log('\n[drupal_developer_guides]');
    const devResults = await vectorSearch(vec, 5, 'drupal_developer_guides') as Array<Record<string, unknown>>;
    if (!devResults || devResults.length === 0) {
      console.log('  (no results)');
    } else {
      devResults.forEach((r, idx) => {
        const dist = typeof r['_distance'] === 'number'
          ? (r['_distance'] as number).toFixed(3)
          : 'NA';
        const snippet = formatSnippet(r['text'] as string | undefined, 300);
        console.log(
          `  #${idx + 1} dist=${dist} | ${r['section'] ?? ''} | ${r['file_path'] ?? ''}`,
        );
        console.log(`     "${snippet}"`);
      });
    }

    console.log('\n');
  }

  console.log('=== DONE ===');
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (MODE === 'v3_compat') {
    await runV3Compat();
  } else {
    // Default (and explicit): top_k_from_each
    await runTopKFromEach();
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
