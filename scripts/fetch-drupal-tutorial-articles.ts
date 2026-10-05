#!/usr/bin/env tsx
/**
 * Fetch full article content from drupal.org developer documentation
 * using the Jina AI reader API for clean markdown output.
 *
 * Usage:
 *   npx tsx scripts/fetch-drupal-tutorial-articles.ts
 */

import fs from 'fs';
import path from 'path';

const DEST_DIR = 'data/sources/tutorials/drupal-org-docs';
const JINA_BASE = 'https://r.jina.ai/';
const DELAY_MS = 1500;

const URLS = [
  'https://www.drupal.org/docs/develop/creating-modules/subscribe-to-and-dispatch-events',
  'https://www.drupal.org/docs/develop/creating-modules/understanding-hooks',
  'https://www.drupal.org/docs/develop/creating-modules/add-a-routing-file',
  'https://www.drupal.org/docs/develop/creating-modules/add-a-basic-controller',
  'https://www.drupal.org/docs/develop/creating-modules/add-a-menu-link',
  'https://www.drupal.org/docs/develop/creating-modules/add-default-configuration',
  'https://www.drupal.org/docs/develop/creating-modules/prepare-a-module-skeleton',
  'https://www.drupal.org/docs/develop/creating-modules/building-a-views-display-style-plugin-for-drupal',
  'https://www.drupal.org/docs/drupal-apis/services-and-dependency-injection/services-and-dependency-injection-in-drupal-8',
  'https://www.drupal.org/docs/drupal-apis/services-and-dependency-injection/structure-of-a-service-file',
  'https://www.drupal.org/docs/drupal-apis/services-and-dependency-injection/altering-existing-services-providing-dynamic-services',
  'https://www.drupal.org/docs/drupal-apis/entity-api/introduction-to-entity-api-in-drupal-8',
  'https://www.drupal.org/docs/drupal-apis/entity-api/defining-and-using-content-entity-field-definitions',
  'https://www.drupal.org/docs/drupal-apis/plugin-api/d8-plugin-system-overview',
  'https://www.drupal.org/docs/drupal-apis/plugin-api/annotations-based-plugins',
  'https://www.drupal.org/docs/drupal-apis/form-api/introduction-to-form-api',
  'https://www.drupal.org/docs/drupal-apis/form-api/theming-a-form',
  'https://www.drupal.org/docs/drupal-apis/cache-api/cache-api',
  'https://www.drupal.org/docs/drupal-apis/cache-api/cache-tags',
  'https://www.drupal.org/docs/drupal-apis/cache-api/cache-contexts',
  'https://www.drupal.org/docs/drupal-apis/routing-system/controllers',
  'https://www.drupal.org/docs/drupal-apis/routing-system/access-checking-on-routes',
  'https://www.drupal.org/docs/drupal-apis/routing-system/parameters-in-routes',
  'https://www.drupal.org/docs/drupal-apis/render-api/render-arrays',
  'https://www.drupal.org/docs/drupal-apis/render-api/cacheability-of-render-arrays',
  'https://www.drupal.org/docs/drupal-apis/database-api/database-api-overview',
  'https://www.drupal.org/docs/drupal-apis/database-api/select-queries',
  'https://www.drupal.org/docs/drupal-apis/javascript-api/javascript-api-overview',
  'https://www.drupal.org/docs/drupal-apis/javascript-api/javascript-behaviors',
  'https://www.drupal.org/docs/develop/standards/coding-standards',
  'https://www.drupal.org/docs/develop/standards/php/php-coding-standards',
  'https://www.drupal.org/docs/develop/standards/documenting-your-project/in-code-documentation-standards',
  'https://www.drupal.org/docs/develop/managing-a-drupalorg-theme-with-starterkit',
];

function urlToFilename(url: string): string {
  // Remove scheme and www prefix, replace slashes with dashes
  return url
    .replace('https://www.drupal.org/', '')
    .replace(/\//g, '-')
    + '.md';
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithJina(url: string): Promise<string> {
  const jinaUrl = `${JINA_BASE}${url}`;
  const response = await fetch(jinaUrl, {
    headers: {
      'Accept': 'text/plain',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

async function main(): Promise<void> {
  fs.mkdirSync(DEST_DIR, { recursive: true });

  const total = URLS.length;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < URLS.length; i++) {
    const url = URLS[i];
    const filename = urlToFilename(url);
    const filePath = path.join(DEST_DIR, filename);

    console.log(`Fetching ${i + 1}/${total}: ${url}`);

    try {
      const content = await fetchWithJina(url);

      const fileContent = `Drupal docs snapshot\nSource: ${url}\n\n${content}`;
      fs.writeFileSync(filePath, fileContent, 'utf-8');
      console.log(`  ✓ saved as ${filename}`);
      successCount++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ failed: ${errorMessage}`);
      failCount++;
    }

    // Delay between requests (skip after last)
    if (i < URLS.length - 1) {
      await delay(DELAY_MS);
    }
  }

  console.log(`\n════════════════════════════════`);
  console.log(`Done! Success: ${successCount}/${total}, Failed: ${failCount}/${total}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
