/**
 * debug-query.ts
 *
 * Standalone CLI tool for ad-hoc inspection of vector search results,
 * grouped by LanceDB source table. All tables are searched in parallel.
 *
 * Usage:
 *   npx tsx scripts/debug-query.ts "your query here"
 *   npx tsx scripts/debug-query.ts "your query here" --topk 5
 *   npx tsx scripts/debug-query.ts "your query here" --topk 10 --tables drupal_core_docs,api_drupal_org_docs
 *   npx tsx scripts/debug-query.ts "your query here" --tables all
 */

import 'dotenv/config';

import * as lancedb from '@lancedb/lancedb';
import OpenAI from 'openai';
import { validateConfig } from '../src/config.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_TABLES: string[] = [
  'drupal_core_docs',
  'drupal_developer_guides',
  'drupal_tutorials',
  'certification_docs',
  'contrib_module_docs',
  'contrib_module_code',
  'php_docs',
  'symfony_docs',
  'api_drupal_org_docs',
];

const EMBED_MODEL = 'text-embedding-3-small';
// Cost: $0.02 per 1M tokens — approx 4 chars per token
const COST_PER_TOKEN = 0.00002 / 1000;

// ─── CLI argument parsing ────────────────────────────────────────────────────

function getFlag(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function parseArgs(): { query: string; topk: number; tables: string[] } {
  // First positional arg (not a flag and not a flag value)
  const positionalArgs: string[] = [];
  const flagNames = new Set(['--topk', '--tables']);
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) continue;
    // Skip values that belong to a preceding flag
    const prev = process.argv[i - 1];
    if (prev && flagNames.has(prev)) continue;
    positionalArgs.push(arg);
  }

  const query = positionalArgs[0] ?? '';

  if (!query) {
    console.error('');
    console.error('  Usage:');
    console.error('    npx tsx scripts/debug-query.ts "your query here"');
    console.error('    npx tsx scripts/debug-query.ts "your query here" --topk 5');
    console.error('    npx tsx scripts/debug-query.ts "your query here" --topk 10 --tables drupal_core_docs,api_drupal_org_docs');
    console.error('    npx tsx scripts/debug-query.ts "your query here" --tables all');
    console.error('');
    console.error('  Valid table names:');
    for (const t of ALL_TABLES) console.error(`    • ${t}`);
    console.error('');
    process.exit(1);
  }

  const topk = parseInt(getFlag('--topk') ?? '5', 10);
  if (isNaN(topk) || topk < 1) {
    console.error(`✗ --topk must be a positive integer; got "${getFlag('--topk')}"`);
    process.exit(1);
  }

  const tablesArg = getFlag('--tables') ?? 'all';
  let tables: string[];
  if (tablesArg === 'all') {
    tables = ALL_TABLES;
  } else {
    tables = tablesArg.split(',').map((t) => t.trim()).filter(Boolean);
    const invalid = tables.filter((t) => !ALL_TABLES.includes(t));
    if (invalid.length > 0) {
      console.error(`✗ Unknown table(s): ${invalid.join(', ')}`);
      console.error(`  Valid: ${ALL_TABLES.join(', ')}`);
      process.exit(1);
    }
  }

  return { query, topk, tables };
}

// ─── Embedding ───────────────────────────────────────────────────────────────

async function embedQuery(text: string): Promise<{ vector: number[]; tokens: number }> {
  const config = validateConfig();
  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const response = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: text,
  });
  const tokens = response.usage?.total_tokens ?? Math.ceil(text.length / 4);
  return { vector: response.data[0].embedding, tokens };
}

// ─── Output formatting ───────────────────────────────────────────────────────

const BOX_WIDTH = 64; // inner text width (excl. border chars)

function ruler(char = '═', width = 70): string {
  return char.repeat(width);
}

/** Truncate a string to maxLen chars, appending '…' if truncated. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * Word-wrap `text` to `width` chars per line, return an array of lines.
 * Collapses whitespace first for cleanliness.
 */
function wordWrap(text: string, width: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word.length > width ? word.slice(0, width) : word;
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word.length > width ? word.slice(0, width) : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Render a Unicode box around an array of text lines.
 * Lines are padded/truncated to exactly BOX_WIDTH chars.
 */
function renderBox(lines: string[]): string {
  const w = BOX_WIDTH;
  const top    = '  ┌' + '─'.repeat(w + 2) + '┐';
  const bottom = '  └' + '─'.repeat(w + 2) + '┘';
  const body = lines.map((l) => {
    const padded = l.padEnd(w).slice(0, w);
    return `  │ ${padded} │`;
  });
  return [top, ...body, bottom].join('\n');
}

function resultHeading(r: Record<string, unknown>): string {
  return (
    (r['symbol_name'] as string | undefined) ||
    (r['title'] as string | undefined) ||
    (r['section'] as string | undefined) ||
    (r['file_path'] as string | undefined) ||
    '(unknown)'
  );
}

function formatTableSection(
  tableName: string,
  results: Array<Record<string, unknown>> | null,
  error: string | null,
): string {
  const lines: string[] = [];
  lines.push(ruler('═'));

  if (error) {
    lines.push(` TABLE: ${tableName}  [Error: ${error}]`);
    lines.push(ruler('═'));
    return lines.join('\n');
  }

  if (!results || results.length === 0) {
    lines.push(` TABLE: ${tableName}  [No results]`);
    lines.push(ruler('═'));
    return lines.join('\n');
  }

  lines.push(` TABLE: ${tableName}  (${results.length} result${results.length !== 1 ? 's' : ''})`);
  lines.push(ruler('═'));
  lines.push('');

  results.forEach((r, idx) => {
    const dist = typeof r['_distance'] === 'number'
      ? (r['_distance'] as number).toFixed(4)
      : 'N/A';
    const heading = truncate(resultHeading(r), 60);
    const sourceRaw = (r['source'] as string | undefined) ?? '';
    const source = sourceRaw ? truncate(sourceRaw, 80) : null;
    const rawText = (r['text'] as string | undefined) ?? '';

    lines.push(`  #${idx + 1}  dist=${dist}  ${heading}`);
    if (source) {
      lines.push(`      src: ${source}`);
    }

    // Wrap text and cap at 8 lines
    const wrapped = wordWrap(rawText, BOX_WIDTH);
    const capped = wrapped.slice(0, 8);
    if (wrapped.length > 8) {
      capped[7] = truncate(capped[7] ?? '', BOX_WIDTH - 1) + '…';
    }
    lines.push(renderBox(capped));
    lines.push('');
  });

  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { query, topk, tables } = parseArgs();
  const config = validateConfig();
  const startTime = Date.now();

  console.log('');
  console.log(ruler('═'));
  console.log(` DEBUG QUERY`);
  console.log(` Query : ${query}`);
  console.log(` Top-K : ${topk} per table`);
  console.log(` Tables: ${tables.join(', ')}`);
  console.log(ruler('═'));
  console.log('');
  console.log('  Embedding query…');

  let vector: number[];
  let tokens: number;
  try {
    ({ vector, tokens } = await embedQuery(query));
  } catch (err) {
    console.error(`\n✗ Failed to embed query: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(`  Embedded (${tokens} tokens).  Searching ${tables.length} table(s) in parallel…`);
  console.log('');

  // Open DB connection
  const db = await lancedb.connect(config.lancedbPath);

  // Search all tables in parallel
  const searchPromises = tables.map(async (tableName) => {
    let table: lancedb.Table;
    try {
      table = await db.openTable(tableName);
    } catch {
      return {
        tableName,
        results: null as Array<Record<string, unknown>> | null,
        error: 'table not found — skipped',
      };
    }
    try {
      const raw = await table.vectorSearch(vector).limit(topk).toArray();
      return {
        tableName,
        results: raw as Array<Record<string, unknown>>,
        error: null as string | null,
      };
    } catch (err) {
      return {
        tableName,
        results: null as Array<Record<string, unknown>> | null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const settled = await Promise.allSettled(searchPromises);

  // Render output
  let totalResults = 0;
  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      console.log(ruler('═'));
      console.log(` TABLE: (unknown)  [Unexpected error: ${String(outcome.reason)}]`);
      console.log(ruler('═'));
      console.log('');
      continue;
    }
    const { tableName, results, error } = outcome.value;
    if (results) totalResults += results.length;
    console.log(formatTableSection(tableName, results, error));
    console.log('');
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const costUsd = (tokens * COST_PER_TOKEN).toFixed(6);

  console.log(ruler('─'));
  console.log(` Summary`);
  console.log(`   Total results : ${totalResults}`);
  console.log(`   Tables queried: ${tables.length}`);
  console.log(`   Time elapsed  : ${elapsed}s`);
  console.log(`   Embedding cost: ~$${costUsd}  (${tokens} tokens @ ${EMBED_MODEL})`);
  console.log(ruler('─'));
  console.log('');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
