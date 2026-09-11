/**
 * Fetch api.drupal.org topic/group pages via Jina reader and save as Markdown.
 *
 * api.drupal.org is a React SPA — direct curl returns only a ~3 KB shell page.
 * Jina (https://r.jina.ai/) renders the page and returns clean markdown.
 *
 * The topic list is discovered from the rendered groups index
 * (https://api.drupal.org/api/drupal/groups/11.x) rather than hardcoded:
 * a previous hardcoded URL list used incorrect file paths and silently
 * fetched "path cannot be matched" error pages.
 *
 * Files are saved to data/sources/api-drupal-org/ as {group}.md.
 * Skips files that already exist and are larger than 1000 bytes.
 *
 * Usage:
 *   npx tsx scripts/fetch-api-drupal-org-topics.ts
 */

import { writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DEST_DIR = 'data/sources/api-drupal-org';
const GROUPS_URL = 'https://api.drupal.org/api/drupal/groups/11.x';

/** Snapshot header prepended to each saved file. */
function snapshotHeader(url: string): string {
  return (
    `<!-- fetched: ${new Date().toISOString()} -->\n`
    + `<!-- source: ${url} -->\n\n`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExistsAndLarge(filePath: string, minBytes = 1000): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.size > minBytes;
  }
  catch {
    return false;
  }
}

async function fetchViaJina(url: string): Promise<string | null> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  try {
    const res = await fetch(jinaUrl, {
      headers: {
        'User-Agent': 'DrupalDevMCP/1.0 (+https://github.com/example/drupal-dev-mcp)',
        'Accept': 'text/markdown, text/plain, */*',
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.warn(`  ⚠  Jina returned ${res.status} for ${url}`);
      return null;
    }

    return await res.text();
  }
  catch (err) {
    console.warn(`  ⚠  Fetch failed for ${url}: ${(err as Error).message}`);
    return null;
  }
}

/** Extracts topic URLs from the rendered groups index markdown. */
function topicUrlsFromGroupsIndex(markdown: string): Array<{ slug: string; url: string }> {
  const urls = [...new Set(markdown.match(/https:\/\/api\.drupal\.org\/api\/drupal\/[^)\s]*\/group\/[^)\s]*/g) ?? [])];
  return urls.map(url => {
    const group = url.match(/\/group\/([^/\s]+)\//)?.[1] ?? url.slice(-40);
    return { slug: group, url };
  });
}

async function main(): Promise<void> {
  await mkdir(DEST_DIR, { recursive: true });

  console.log('=== Fetching api.drupal.org groups index via Jina ===');
  const groupsMarkdown = await fetchViaJina(GROUPS_URL);
  if (!groupsMarkdown) {
    console.error('Failed to fetch groups index; aborting.');
    process.exitCode = 1;
    return;
  }
  const topics = topicUrlsFromGroupsIndex(groupsMarkdown);
  console.log(`Discovered ${topics.length} topics from ${GROUPS_URL}\n`);

  // Always refresh the groups index artifact itself.
  const groupsPath = path.join(DEST_DIR, 'groups.md');
  await writeFile(groupsPath, snapshotHeader(GROUPS_URL) + groupsMarkdown, 'utf-8');
  console.log(`✓  groups.md saved (${(await stat(groupsPath)).size} bytes)`);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const topic of topics) {
    const filePath = path.join(DEST_DIR, `${topic.slug}.md`);
    process.stdout.write(`  ↓  ${topic.slug} ... `);
    if (await fileExistsAndLarge(filePath)) {
      console.log('✓ (cached)');
      skipped += 1;
      continue;
    }
    const markdown = await fetchViaJina(topic.url);
    if (!markdown || markdown.includes('cannot be matched against any page')) {
      console.log('✗ (no content)');
      failed += 1;
      continue;
    }
    await writeFile(filePath, snapshotHeader(topic.url) + markdown, 'utf-8');
    console.log(`✓ saved (${markdown.length} bytes)`);
    fetched += 1;
    await sleep(1500);
  }

  console.log(`\n=== Fetch complete ===`);
  console.log(`  Fetched : ${fetched}`);
  console.log(`  Skipped : ${skipped} (already existed)`);
  console.log(`  Failed  : ${failed}`);
}

void main();
