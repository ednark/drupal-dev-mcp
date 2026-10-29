/**
 * Fetch Drupal change records from drupal.org list pages via Jina reader.
 *
 * The list at https://www.drupal.org/list-changes?page=N renders 50 records
 * per page, each carrying: version, release, date, title, short summary, and
 * the node link. Records relevant to the indexed Drupal versions (10.x, 11.x,
 * and main/12.x) are written as one markdown file per record under
 * data/sources/change-records/records/.
 *
 * Full text: list pages only carry a one-line summary, which is thin evidence
 * for "what replaced the old pattern" questions. By default each NEW record's
 * full node page is also fetched via Jina and appended under `## Full text`
 * (cap 100k chars). `--no-full-text` restores summary-only output.
 * `--backfill-full-text` upgrades previously written summary-only files
 * (resumable: files already containing `## Full text` are skipped) with an
 * optional `--backfill-limit=N` cap per run, default 50, to stay polite to
 * r.jina.ai and drupal.org.
 *
 * Usage:
 *   npx tsx scripts/fetch-change-records.ts [--pages=60]
 *   npx tsx scripts/fetch-change-records.ts --no-full-text
 *   npx tsx scripts/fetch-change-records.ts --backfill-full-text [--backfill-limit=50]
 */

import { mkdir, writeFile, readdir, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = 'data/sources/change-records/records';
const BASE_URL = 'https://www.drupal.org/list-changes';
const NODE_URL = (node: string) => `https://www.drupal.org/node/${node}`;
const RELEVANT_VERSIONS = /^(10|11|12)\./;
const MAIN_BRANCH = 'main';
const FULL_TEXT_MARKER = '\n## Full text\n';
const FULL_TEXT_CAP = 100_000;
const FETCH_DELAY_MS = 1_500;
const BACKFILL_DEFAULT_LIMIT = 50;

interface ChangeRecord {
  node: string;
  version: string;
  release: string;
  date: string;
  title: string;
  summary: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        'User-Agent': 'DrupalDevMCP/1.0 (+https://github.com/example/drupal-dev-mcp)',
        'Accept': 'text/markdown, text/plain, */*',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Parses list-page markdown into records. Rows look like:
 *   11.5.x / 11.5.0 25-Aug-2026[Title](https://www.drupal.org/node/3616293 "Summary")
 */
function parseRecords(markdown: string): ChangeRecord[] {
  const records: ChangeRecord[] = [];
  const pattern = /(\S+)\s*\/\s*(\S+)\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\[([^\]]+)\]\((https:\/\/www\.drupal\.org\/node\/(\d+))(?:\s+"([^"]*)")?\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    records.push({
      version: match[1],
      release: match[2],
      date: match[3],
      title: match[4].trim(),
      node: match[6],
      summary: (match[7] ?? '').trim(),
    });
  }
  return records;
}

function slugify(title: string, node: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || `change-${node}`;
}

function capFullText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= FULL_TEXT_CAP) return trimmed;
  return `${trimmed.slice(0, FULL_TEXT_CAP)}\n\n[Truncated at ${FULL_TEXT_CAP} characters — read the full record at the link above.]`;
}

/**
 * Fetches the full change-record page. Jina returns the rendered page
 * including site chrome; that is fine for search — the behavioral detail
 * (impacted code, replacements) lives in the body and survives chunking.
 */
async function fetchFullText(node: string): Promise<string | null> {
  const markdown = await fetchViaJina(NODE_URL(node));
  if (!markdown || markdown.trim().length < 200) return null;
  return capFullText(markdown);
}

function hasFullText(body: string): boolean {
  return body.includes(FULL_TEXT_MARKER);
}

function nodeIdFromFilename(filename: string): string | null {
  return filename.match(/-(\d+)\.md$/)?.[1] ?? null;
}

async function main(): Promise<void> {
  const pagesArg = process.argv.find(arg => arg.startsWith('--pages='));
  const pages = pagesArg ? Number(pagesArg.split('=')[1]) : 60;
  const noFullText = process.argv.includes('--no-full-text');
  const backfill = process.argv.includes('--backfill-full-text');
  const backfillLimitArg = process.argv.find(arg => arg.startsWith('--backfill-limit='));
  const backfillLimit = backfillLimitArg ? Number(backfillLimitArg.split('=')[1]) : BACKFILL_DEFAULT_LIMIT;

  await mkdir(OUT_DIR, { recursive: true });
  const existing = new Set(await readdir(OUT_DIR).catch(() => [] as string[]));

  // Backfill mode upgrades summary-only files and exits; list pages are not re-parsed.
  if (backfill) {
    const pending: Array<{ name: string; node: string }> = [];
    for (const name of [...existing].filter(name => name.endsWith('.md')).sort()) {
      const node = nodeIdFromFilename(name);
      if (!node) continue;
      const body = await readFile(path.join(OUT_DIR, name), 'utf8').catch(() => '');
      if (hasFullText(body)) continue;
      pending.push({ name, node });
      if (pending.length >= backfillLimit) break;
    }
    console.log(`=== Backfill full text ===`);
    console.log(`  Candidates : ${pending.length} (limit ${backfillLimit})`);
    let ok = 0;
    let failed = 0;
    for (const item of pending) {
      process.stdout.write(`  ↓ ${item.node} ... `);
      const fullText = await fetchFullText(item.node);
      if (!fullText) {
        console.log('✗ (fetch failed; will retry next run)');
        failed += 1;
      } else {
        await appendFile(path.join(OUT_DIR, item.name), `${FULL_TEXT_MARKER}\n${fullText}\n`, 'utf8');
        console.log('✓');
        ok += 1;
      }
      await sleep(FETCH_DELAY_MS);
    }
    console.log(`\n  Expanded   : ${ok}`);
    console.log(`  Failed     : ${failed} (resumable — re-run to continue)`);
    return;
  }

  const all: ChangeRecord[] = [];
  let failedPages = 0;
  for (let page = 0; page < pages; page += 1) {
    process.stdout.write(`  ↓ page ${page} ... `);
    const markdown = await fetchViaJina(page === 0 ? BASE_URL : `${BASE_URL}?page=${page}`);
    if (!markdown) {
      console.log('✗ (fetch failed)');
      failedPages += 1;
      if (failedPages >= 3) { console.log('  Too many failed pages; stopping early.'); break; }
      continue;
    }
    const records = parseRecords(markdown);
    if (records.length === 0) {
      console.log(`✓ (0 records — end of list, stopping)`);
      break;
    }
    all.push(...records);
    console.log(`✓ ${records.length} records`);
    await sleep(1500);
  }

  const relevant = all.filter(record =>
    RELEVANT_VERSIONS.test(record.version) || record.version === MAIN_BRANCH);
  const unique = new Map(relevant.map(record => [record.node, record]));

  let written = 0;
  let expanded = 0;
  for (const record of unique.values()) {
    const filename = `${slugify(record.title, record.node)}-${record.node}.md`;
    if (existing.has(filename)) continue;
    const summaryBody = [
      `# ${record.title}`,
      '',
      `**Source**: ${NODE_URL(record.node)}`,
      `**Introduced in**: ${record.version} / ${record.release}`,
      `**Date**: ${record.date}`,
      '',
      record.summary || 'See the full change record on drupal.org for details.',
      '',
      `Full change record: ${NODE_URL(record.node)}`,
      '',
    ].join('\n');

    if (noFullText) {
      await writeFile(path.join(OUT_DIR, filename), summaryBody, 'utf8');
      written += 1;
      continue;
    }
    const fullText = await fetchFullText(record.node);
    const body = fullText
      ? `${summaryBody}${FULL_TEXT_MARKER}\n${fullText}\n`
      : summaryBody;
    if (fullText) expanded += 1;
    await writeFile(path.join(OUT_DIR, filename), body, 'utf8');
    written += 1;
    await sleep(FETCH_DELAY_MS);
  }

  console.log(`\n=== Fetch complete ===`);
  console.log(`  Records seen : ${all.length}`);
  console.log(`  Relevant     : ${unique.size} (Drupal 10.x / 11.x / main)`);
  console.log(`  Files written: ${written} (new only)`);
  console.log(`  Full text    : ${noFullText ? 'skipped (--no-full-text)' : `${expanded} of ${written} expanded`}`);
  console.log(`  Output       : ${OUT_DIR}`);
}

void main();
