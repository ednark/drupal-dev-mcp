/**
 * Fetch Drupal change records from drupal.org list pages via Jina reader.
 *
 * The list at https://www.drupal.org/list-changes?page=N renders 50 records
 * per page, each carrying: version, release, date, title, short summary, and
 * the node link. The previous corpus only had a 15-record sample JSON file.
 *
 * Rows are filtered to records relevant to the indexed Drupal versions
 * (10.x, 11.x, and main/12.x) and written as one markdown file per record
 * under data/sources/change-records/records/. Each file links to the full
 * node on drupal.org for deeper detail.
 *
 * Usage:
 *   npx tsx scripts/fetch-change-records.ts [--pages=60]
 */

import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = 'data/sources/change-records/records';
const BASE_URL = 'https://www.drupal.org/list-changes';
const RELEVANT_VERSIONS = /^(10|11|12)\./;
const MAIN_BRANCH = 'main';

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

async function main(): Promise<void> {
  const pagesArg = process.argv.find(arg => arg.startsWith('--pages='));
  const pages = pagesArg ? Number(pagesArg.split('=')[1]) : 60;
  await mkdir(OUT_DIR, { recursive: true });
  const existing = new Set(await readdir(OUT_DIR).catch(() => [] as string[]));

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
  for (const record of unique.values()) {
    const filename = `${slugify(record.title, record.node)}-${record.node}.md`;
    if (existing.has(filename)) continue;
    const body = [
      `# ${record.title}`,
      '',
      `**Source**: https://www.drupal.org/node/${record.node}`,
      `**Introduced in**: ${record.version} / ${record.release}`,
      `**Date**: ${record.date}`,
      '',
      record.summary || 'See the full change record on drupal.org for details.',
      '',
      `Full change record: https://www.drupal.org/node/${record.node}`,
      '',
    ].join('\n');
    await writeFile(path.join(OUT_DIR, filename), body, 'utf8');
    written += 1;
  }

  console.log(`\n=== Fetch complete ===`);
  console.log(`  Records seen : ${all.length}`);
  console.log(`  Relevant     : ${unique.size} (Drupal 10.x / 11.x / main)`);
  console.log(`  Files written: ${written} (new only)`);
  console.log(`  Output       : ${OUT_DIR}`);
}

void main();
