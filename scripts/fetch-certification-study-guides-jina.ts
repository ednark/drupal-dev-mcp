#!/usr/bin/env tsx
/**
 * Fetch Acquia certification study-guide pages via the Jina reader API.
 *
 * docs.acquia.com pages are a React SPA — plain curl returns a shell page, and
 * the previous fetchers needed pandoc (fetch-certification-study-guides.sh) or
 * Playwright (fetch-acquia-certification-study-guides.ts), neither of which is
 * a repo dependency. Jina renders the SPA server-side and returns clean
 * markdown with `Title:` / `URL Source:` front matter, which the indexer's
 * discovery gate uses for title and canonical URL.
 *
 * Output: data/sources/certification/<url-derived>.md
 *
 * Usage:
 *   npm run index:fetch-certification
 */

import fs from 'fs';
import path from 'path';

const DEST_DIR = 'data/sources/certification';
const JINA_BASE = 'https://r.jina.ai/';
const DELAY_MS = 2000;
/** Pages whose rendered body is smaller than this are shell pages, not content. */
const MIN_CONTENT_BYTES = 2000;

const URLS = [
  'https://docs.acquia.com/acquia-academy/acquia-certified-drupal-site-builder',
  'https://docs.acquia.com/acquia-academy/acquia-certified-drupal-developer',
  'https://docs.acquia.com/acquia-academy/acquia-certified-drupal-backend-specialist',
  'https://docs.acquia.com/acquia-academy/acquia-certified-drupal-front-end-specialist',
  'https://www.acquia.com/node/41096',
];

function urlToFilename(url: string): string {
  return url
    .replace(/^https?:\/\//, (match) => match.replace('://', '-'))
    .replace(/[/?#=&:]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/-$/, '')
    + '.md';
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithJina(url: string): Promise<string> {
  const response = await fetch(`${JINA_BASE}${url}`, {
    headers: { 'Accept': 'text/plain' },
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
      // The discovery gate rejects raw shell pages and stubs; a short body
      // means Jina could not render the SPA content — keep the old file (if
      // any) rather than writing junk.
      if (content.trim().length < MIN_CONTENT_BYTES) {
        throw new Error(`rendered body too small (${content.trim().length} bytes); refusing to save`);
      }
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`  ✓ saved as ${filename} (${content.length} bytes)`);
      successCount++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ failed: ${errorMessage}`);
      failCount++;
    }

    if (i < URLS.length - 1) {
      await delay(DELAY_MS);
    }
  }

  console.log(`\n════════════════════════════════`);
  console.log(`Done! Success: ${successCount}/${total}, Failed: ${failCount}/${total}`);
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});