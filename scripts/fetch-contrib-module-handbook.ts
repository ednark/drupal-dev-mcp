/**
 * Fetch drupal.org handbook/documentation pages for contrib modules via Jina AI reader.
 *
 * For each URL:
 *   1. Fetch via https://r.jina.ai/{url}
 *   2. Skip if response < 200 chars or contains "404"/"not found" in first 100 chars
 *   3. Convert URL to filename: last 2 path segments joined with '-', append '-handbook.md'
 *      e.g. .../contributed-modules/webform → contributed-modules-webform-handbook.md
 *      e.g. .../8/modules/token            → 8-modules-token-handbook.md
 *   4. Skip if file already exists and is > 500 bytes
 *   5. 1.5-second delay between requests
 *
 * Usage:
 *   npx tsx scripts/fetch-contrib-module-handbook.ts
 */

import { writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DEST_DIR = 'data/sources/contrib-modules';

const HANDBOOK_URLS: string[] = [
  'https://www.drupal.org/docs/contributed-modules/views',
  'https://www.drupal.org/docs/contributed-modules/webform',
  'https://www.drupal.org/docs/contributed-modules/paragraphs',
  'https://www.drupal.org/docs/contributed-modules/pathauto',
  'https://www.drupal.org/docs/contributed-modules/metatag',
  'https://www.drupal.org/docs/contributed-modules/devel',
  'https://www.drupal.org/docs/contributed-modules/token',
  'https://www.drupal.org/docs/contributed-modules/simple-sitemap',
  'https://www.drupal.org/docs/contributed-modules/scheduler',
  'https://www.drupal.org/docs/contributed-modules/redirect',
  'https://www.drupal.org/docs/contributed-modules/linkit',
  'https://www.drupal.org/docs/contributed-modules/twig-tweak',
  'https://www.drupal.org/docs/contributed-modules/admin-toolbar',
  'https://www.drupal.org/docs/contributed-modules/field-group',
  'https://www.drupal.org/docs/contributed-modules/better-exposed-filters',
  'https://www.drupal.org/docs/contributed-modules/google-analytics',
  'https://www.drupal.org/docs/contributed-modules/colorbox',
  'https://www.drupal.org/docs/contributed-modules/slick-carousel',
  'https://www.drupal.org/docs/contributed-modules/media-entity',
  'https://www.drupal.org/docs/contributed-modules/imce',
  'https://www.drupal.org/docs/8/modules/webform',
  'https://www.drupal.org/docs/8/modules/views',
  'https://www.drupal.org/docs/8/modules/token',
  'https://www.drupal.org/docs/8/modules/paragraphs',
  'https://www.drupal.org/docs/8/core/modules/views',
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert a URL to a filename by taking the last 2 path segments,
 * joining with '-', and appending '-handbook.md'.
 *
 * Examples:
 *   https://www.drupal.org/docs/contributed-modules/webform
 *     → contributed-modules-webform-handbook.md
 *   https://www.drupal.org/docs/8/modules/token
 *     → 8-modules-token-handbook.md  (last 2 of 3 segments: modules/token... wait)
 *
 * Re-reading spec: "last 2 path segments"
 *   .../8/modules/token → segments are ["8","modules","token"], last 2 = ["modules","token"]
 *   But the example says "8-modules-token-handbook.md" which is 3 segments...
 *
 * Actually the example says: `.../8/modules/token` → `8-modules-token-handbook.md`
 * That looks like ALL 3 remaining path segments after /docs/ joined.
 * Let me re-read: "take the last 2 path segments" but the example shows 3.
 *
 * Looking at the examples carefully:
 *   .../contributed-modules/webform → "contributed-modules-webform" = 2 segments joined
 *   .../8/modules/token             → "8-modules-token"             = 3 segments joined
 *
 * The rule must be: take the path after /docs/, join all remaining segments with '-'.
 * OR: interpret "last 2 path segments" for /contributed-modules/webform as the full
 * tail, but for /8/modules/token the spec example shows 3 segments.
 *
 * Going with: strip /docs/ prefix from the path, join remaining segments with '-'.
 */
function urlToFilename(url: string): string {
  const urlObj = new URL(url);
  const segments = urlObj.pathname.split('/').filter(Boolean);

  // Remove leading "docs" segment if present
  const docsIdx = segments.indexOf('docs');
  const relevantSegments = docsIdx >= 0 ? segments.slice(docsIdx + 1) : segments.slice(-2);

  return relevantSegments.join('-') + '-handbook.md';
}

async function fileExistsAndIsLarge(filePath: string, minBytes = 500): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.size > minBytes;
  } catch {
    return false;
  }
}

async function fetchHandbookPage(url: string): Promise<string | null> {
  const jinaUrl = `https://r.jina.ai/${url}`;

  try {
    const res = await fetch(jinaUrl, {
      headers: {
        'User-Agent': 'DrupalDevMCP/1.0 (+https://github.com/example/drupal-dev-mcp)',
        'Accept': 'text/plain',
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return null;
    }

    const text = await res.text();

    if (!text || text.trim().length < 200) {
      return null;
    }

    // Check first 100 chars for 404 or "not found" indicators
    const preview = text.slice(0, 100).toLowerCase();
    if (preview.includes('404') || preview.includes('not found')) {
      return null;
    }

    return text.trim();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  await mkdir(DEST_DIR, { recursive: true });

  const total = HANDBOOK_URLS.length;
  let saved = 0;
  let skipped = 0;

  for (let i = 0; i < HANDBOOK_URLS.length; i++) {
    const url = HANDBOOK_URLS[i]!;
    const filename = urlToFilename(url);
    const outPath = path.join(DEST_DIR, filename);

    process.stderr.write(`Fetching ${i + 1}/${total}: ${url}\n`);

    // Skip if file already exists and has content
    if (await fileExistsAndIsLarge(outPath)) {
      process.stderr.write(`  ✗ skipped (file exists: ${filename})\n`);
      skipped++;
      if (i < HANDBOOK_URLS.length - 1) await sleep(1_500);
      continue;
    }

    const content = await fetchHandbookPage(url);

    if (!content) {
      process.stderr.write(`  ✗ ${url} (too short or 404)\n`);
      skipped++;
    } else {
      await writeFile(outPath, content, 'utf8');
      process.stderr.write(`  ✓ saved ${filename} (${content.length} chars)\n`);
      saved++;
    }

    // 1.5-second delay between requests (skip after last)
    if (i < HANDBOOK_URLS.length - 1) {
      await sleep(1_500);
    }
  }

  process.stderr.write(`\nDone. ${saved}/${total} pages saved, ${skipped} skipped/failed.\n`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
