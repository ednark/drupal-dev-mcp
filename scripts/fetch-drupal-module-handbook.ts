/**
 * Fetch drupal.org module developer handbook pages via Jina AI reader.
 *
 * For each URL:
 *   1. Fetch via https://r.jina.ai/{url}
 *   2. Skip if response < 200 chars or contains "404"/"not found" in first 100 chars
 *   3. Convert URL to filename: last 2 path segments joined with '-', append '-guide.md'
 *      e.g. .../docs/creating-custom-modules        → docs-creating-custom-modules-guide.md
 *      e.g. .../creating-custom-modules/hooks-and-alters → creating-custom-modules-hooks-and-alters-guide.md
 *   4. Skip if file already exists and is > 500 bytes
 *   5. 2-second delay between requests
 *
 * Usage:
 *   npx tsx scripts/fetch-drupal-module-handbook.ts
 */

import { writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DEST_DIR = 'data/sources/drupal-module-handbook';

const HANDBOOK_URLS: string[] = [
  // Core module creation
  'https://www.drupal.org/docs/creating-custom-modules',
  'https://www.drupal.org/docs/creating-custom-modules/let-drupal-know-about-your-module-with-an-infoyml-file',
  'https://www.drupal.org/docs/creating-custom-modules/hooks-and-alters',
  'https://www.drupal.org/docs/creating-custom-modules/defining-and-implementing-hooks',
  'https://www.drupal.org/docs/creating-custom-modules/providing-module-configuration',

  // Services and DI
  'https://www.drupal.org/docs/drupal-apis/services-and-dependency-injection',
  'https://www.drupal.org/docs/drupal-apis/services-and-dependency-injection/services-and-dependency-injection-in-drupal-8',
  'https://www.drupal.org/docs/drupal-apis/services-and-dependency-injection/structure-of-a-service-file',

  // Plugin API
  'https://www.drupal.org/docs/drupal-apis/plugin-api',
  'https://www.drupal.org/docs/drupal-apis/plugin-api/annotations-based-plugins',
  'https://www.drupal.org/docs/drupal-apis/plugin-api/understanding-the-plugin-api',
  'https://www.drupal.org/docs/drupal-apis/plugin-api/creating-a-block-plugin',

  // Routing
  'https://www.drupal.org/docs/drupal-apis/routing-system',
  'https://www.drupal.org/docs/drupal-apis/routing-system/structure-of-routes',
  'https://www.drupal.org/docs/drupal-apis/routing-system/controllers',
  'https://www.drupal.org/docs/drupal-apis/routing-system/access-checking-on-routes',

  // Entity API
  'https://www.drupal.org/docs/drupal-apis/entity-api',
  'https://www.drupal.org/docs/drupal-apis/entity-api/working-with-the-entity-api',
  'https://www.drupal.org/docs/drupal-apis/entity-api/defining-a-content-entity-type-in-drupal-8',

  // Form API
  'https://www.drupal.org/docs/drupal-apis/form-api',
  'https://www.drupal.org/docs/drupal-apis/form-api/introduction-to-form-api',
  'https://www.drupal.org/docs/drupal-apis/form-api/building-a-basic-form',

  // Configuration API
  'https://www.drupal.org/docs/drupal-apis/configuration-api',
  'https://www.drupal.org/docs/drupal-apis/configuration-api/working-with-configuration-in-drupal-8',

  // Database API
  'https://www.drupal.org/docs/drupal-apis/database-api',
  'https://www.drupal.org/docs/drupal-apis/database-api/static-queries',
  'https://www.drupal.org/docs/drupal-apis/database-api/dynamic-queries',

  // Events
  'https://www.drupal.org/docs/creating-custom-modules/subscribe-to-and-dispatch-events',

  // Theming from modules
  'https://www.drupal.org/docs/theming-drupal/twig-in-drupal',
  'https://www.drupal.org/docs/theming-drupal/adding-stylesheets-css-and-javascript-js-to-a-drupal-module',
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert a URL to a filename by taking the last 2 path segments,
 * joining with '-', and appending '-guide.md'.
 *
 * Examples:
 *   https://www.drupal.org/docs/creating-custom-modules
 *     → docs-creating-custom-modules-guide.md
 *   https://www.drupal.org/docs/creating-custom-modules/hooks-and-alters
 *     → creating-custom-modules-hooks-and-alters-guide.md
 */
function urlToFilename(url: string): string {
  const urlObj = new URL(url);
  const segments = urlObj.pathname.split('/').filter(Boolean);

  // Take the last 2 path segments
  const relevantSegments = segments.slice(-2);

  return relevantSegments.join('-') + '-guide.md';
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
      if (i < HANDBOOK_URLS.length - 1) await sleep(2_000);
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

    // 2-second delay between requests (skip after last)
    if (i < HANDBOOK_URLS.length - 1) {
      await sleep(2_000);
    }
  }

  process.stderr.write(`\nDone. ${saved}/${total} pages saved, ${skipped} skipped/failed.\n`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
