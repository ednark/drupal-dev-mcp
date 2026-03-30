#!/usr/bin/env npx tsx
/**
 * Playwright-based fetcher for the Acquia Certification Study Guide pages on docs.acquia.com.
 *
 * These pages are dynamically rendered (React SPA), so plain curl/http returns a shell page.
 * This script uses headless Chromium via Playwright to fully render each page, extract the
 * main text content, and save it as a .md file in data/sources/certification/.
 *
 * Output filenames follow the same https-<host>-<path>.md convention used by other sources.
 *
 * Usage:
 *   npx tsx scripts/fetch-acquia-certification-study-guides.ts
 */

import { chromium } from 'playwright';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DEST_DIR = 'data/sources/certification';

const URLS = [
  'https://docs.acquia.com/acquia-academy/acquia-certified-drupal-site-builder',
  'https://docs.acquia.com/acquia-academy/acquia-certified-drupal-developer',
  'https://docs.acquia.com/acquia-academy/acquia-certified-drupal-backend-specialist',
  'https://docs.acquia.com/acquia-academy/acquia-certified-drupal-front-end-specialist',
  'https://www.acquia.com/node/41096',
];

const MIN_CONTENT_BYTES = 2000;
const DELAY_BETWEEN_PAGES_MS = 2500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert a URL to a filesystem-safe filename base using the same convention as
 * the existing certification scraper (https- prefix, slashes become dashes).
 */
function urlToFilenameBase(rawUrl: string): string {
  return rawUrl
    .replace(/^https?:\/\//, (match) => match.replace('://', '-'))
    .replace(/[/?#=&:]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/-$/, '');
}

/**
 * Extract the main textual content from the page.
 * Tries article > main > body in order, falling back to full page text.
 * Returns a clean markdown-ish string.
 */
async function extractContent(page: import('playwright').Page, url: string): Promise<string> {
  const text = await page.evaluate(() => {
    // Prefer the main article/content area
    const selectors = [
      'article',
      '[role="main"]',
      'main',
      '.main-content',
      '#main-content',
      'body',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && (el as HTMLElement).innerText.trim().length > 500) {
        return (el as HTMLElement).innerText.trim();
      }
    }

    return document.body.innerText.trim();
  });

  // Prepend source URL as a reference comment
  return `<!-- Source: ${url} -->\n\n${text}`;
}

async function main(): Promise<void> {
  await fs.mkdir(DEST_DIR, { recursive: true });

  console.log(`\nFetching ${URLS.length} Acquia Certification study guide pages…\n`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  const page = await context.newPage();

  let succeeded = 0;
  let failed = 0;

  for (const url of URLS) {
    const filenameBase = urlToFilenameBase(url);
    const outputPath = path.join(DEST_DIR, `${filenameBase}.md`);

    try {
      // Check if already exists
      try {
        await fs.access(outputPath);
        console.log(`SKIP  ${url} (already exists)`);
        continue;
      } catch {
        // File doesn't exist, proceed with fetch
      }

      console.log(`FETCH ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

      // Wait for dynamic content to hydrate
      try {
        await page.waitForLoadState('networkidle', { timeout: 12_000 });
      } catch {
        // Best-effort; SPA pages may keep connections open
      }

      // Extra wait for React/JS-rendered content to settle
      await sleep(1500);

      const content = await extractContent(page, url);

      if (content.length < MIN_CONTENT_BYTES) {
        console.error(`  ✗ Content too short (${content.length} bytes) — skipping`);
        failed++;
        continue;
      }

      await fs.writeFile(outputPath, content, 'utf8');
      const sizeKb = (content.length / 1024).toFixed(1);
      console.log(`  ✓ Saved ${outputPath} (${sizeKb} KB)`);
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ FAILED ${url}: ${msg}`);
      failed++;
    }

    if (URLS.indexOf(url) < URLS.length - 1) {
      await sleep(DELAY_BETWEEN_PAGES_MS);
    }
  }

  await context.close();
  await browser.close();

  console.log(`\nDone. succeeded=${succeeded} failed=${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
