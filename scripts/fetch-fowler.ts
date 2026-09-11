/**
 * Fetch Martin Fowler's design/methodology writing relevant to Drupal development.
 *
 * martinfowler.com blocks bulk crawling of its article index (403 on
 * /articles/), but individual pages render fine via Jina. This script therefore
 * fetches:
 *
 *   1. The full PoEAA pattern catalog (eaaCatalog/, ~40 pages) — discovered
 *      by crawling the catalog index, which links every pattern.
 *   2. A curated list of bliki entries and articles most relevant to Drupal
 *      backend work: DI, CQRS, event sourcing, strangler fig (legacy
 *      migrations), testing, technical debt, web architecture.
 *
 * Files are saved to data/sources/fowler/ as markdown. Re-runs are incremental.
 *
 * Usage:
 *   npx tsx scripts/fetch-fowler.ts
 */

import { writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import path from 'node:path';

const DEST_DIR = 'data/sources/fowler';
const CATALOG_INDEX = 'https://martinfowler.com/eaaCatalog/';

/** Curated pages, grouped for maintainability. */
const CURATED: string[] = [
  // Dependency injection / container patterns
  'https://martinfowler.com/bliki/InversionOfControl.html',
  'https://martinfowler.com/articles/injection.html',
  // Domain modeling
  'https://martinfowler.com/bliki/AnemicDomainModel.html',
  'https://martinfowler.com/bliki/CQRS.html',
  'https://martinfowler.com/eaaDev/EventSourcing.html',
  'https://martinfowler.com/bliki/Seedwork.html',
  'https://martinfowler.com/bliki/SelfEncapsulation.html',
  // Legacy migration — directly relevant to Drupal 7/8 → 10/11 migrations
  'https://martinfowler.com/bliki/StranglerFigApplication.html',
  // Testing
  'https://martinfowler.com/bliki/UnitTest.html',
  'https://martinfowler.com/bliki/TestPyramid.html',
  'https://martinfowler.com/articles/practical-test-pyramid.html',
  // Web architecture
  'https://martinfowler.com/articles/refactoring-pipelines.html',
  'https://martinfowler.com/articles/replaceThrow.html',
  // Process / methodology
  'https://martinfowler.com/articles/continuousIntegration.html',
  'https://martinfowler.com/bliki/TechnicalDebt.html',
  'https://martinfowler.com/bliki/SemanticDiffusion.html',
  'https://martinfowler.com/bliki/ArchitectureDecisionRecord.html',
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fileExistsAndLarge(filePath: string, minBytes = 1_000): Promise<boolean> {
  try {
    return (await stat(filePath)).size > minBytes;
  } catch {
    return false;
  }
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

function fileNameFor(url: string): string {
  const slug = url.replace('https://martinfowler.com/', '').replace(/\.html$/, '').replace(/\//g, '__');
  return `${slug || 'index'}.md`;
}

function stripJinaPreamble(markdown: string): string {
  return markdown
    .replace(/^Title: .*\n/m, '')
    .replace(/^URL Source: .*\n/m, '')
    .replace(/^Markdown Content:\n/m, '')
    .trimStart();
}

async function main(): Promise<void> {
  await mkdir(DEST_DIR, { recursive: true });
  const existing = new Set(await readdir(DEST_DIR).catch(() => [] as string[]));

  console.log('=== Fetching Fowler eaaCatalog index ===');
  const catalogIndex = await fetchViaJina(CATALOG_INDEX);
  const catalogLinks = catalogIndex
    ? [...new Set((catalogIndex.match(/https:\/\/martinfowler\.com\/eaaCatalog\/[a-zA-Z0-9]+\.html/g) ?? []))]
    : [];
  console.log(`Discovered ${catalogLinks.length} catalog patterns`);

  const targets = [...catalogLinks, ...CURATED];
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const url of targets) {
    const fileName = fileNameFor(url);
    if (existing.has(fileName) || (await fileExistsAndLarge(path.join(DEST_DIR, fileName)))) {
      skipped += 1;
      continue;
    }
    process.stdout.write(`  ↓ ${url.replace('https://martinfowler.com/', '')} ... `);
    const markdown = await fetchViaJina(url);
    // The site 404s render a small "not found" page; require real content.
    if (!markdown || markdown.length < 1_000 || markdown.includes('Warning: Target URL returned error')) {
      console.log('✗');
      failed += 1;
      continue;
    }
    const header = `<!-- fetched: ${new Date().toISOString()} -->\n<!-- source: ${url} -->\n\n`;
    await writeFile(path.join(DEST_DIR, fileName), header + stripJinaPreamble(markdown), 'utf8');
    console.log(`✓ (${markdown.length} bytes)`);
    fetched += 1;
    await sleep(1_500);
  }

  console.log(`\n=== Fetch complete ===`);
  console.log(`  Fetched : ${fetched}`);
  console.log(`  Skipped : ${skipped} (already existed)`);
  console.log(`  Failed  : ${failed}`);
  console.log(`  Output  : ${DEST_DIR}`);
}

void main();
