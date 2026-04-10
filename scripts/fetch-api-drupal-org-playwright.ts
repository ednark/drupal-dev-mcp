#!/usr/bin/env npx tsx
/**
 * Playwright-based fetcher for api.drupal.org groups/topics.
 *
 * api.drupal.org is a JavaScript SPA — curl returns a ~3KB shell page.
 * This script uses headless Chromium via Playwright to fully render each page
 * and save the resulting HTML to data/sources/api-drupal-org/.
 *
 * Output files are named {group-slug}.html (no _ prefix) so the parser at
 * etl/parse-api-drupal-org.ts picks them up.
 *
 * Usage: npx tsx scripts/fetch-api-drupal-org-playwright.ts
 */

import { chromium } from 'playwright';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DEST_DIR = 'data/sources/api-drupal-org';
const BASE_URL = 'https://api.drupal.org';
const INDEX_URL = `${BASE_URL}/api/drupal/groups/11.x`;

// Polite delay between requests (ms)
const MIN_DELAY_MS = 1200;
const MAX_DELAY_MS = 2200;

// URL regex matching group/topic pages
const GROUP_URL_RE = /\/api\/drupal\/[^/]+\/group\/([^/?#]+)\/11\.x/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(): Promise<void> {
  const ms = MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
  return sleep(ms);
}

async function main() {
  await fs.mkdir(DEST_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  try {
    // ── Step 1: Collect all topic URLs from paginated index ─────────────────
    const topicUrls = new Map<string, string>(); // slug → full URL

    console.log('=== Collecting group/topic URLs from index pages ===\n');

    for (let pageNum = 0; pageNum <= 10; pageNum++) {
      const indexUrl =
        pageNum === 0 ? INDEX_URL : `${INDEX_URL}?page=${pageNum}`;

      console.log(`  [index page ${pageNum}] ${indexUrl}`);

      try {
        await page.goto(indexUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

        // Wait for the Angular/React SPA to render the link list
        await page
          .waitForSelector('a[href*="/group/"]', { timeout: 20_000 })
          .catch(() => null);

        // Also wait a moment for any lazy renders
        await sleep(1000);

        const links: string[] = await page.$$eval(
          'a',
          (anchors: Element[]) =>
            (anchors as HTMLAnchorElement[])
              .map((a) => a.href)
              .filter((href) =>
                /\/api\/drupal\/[^/]+\/group\/[^/?#]+\/11\.x/.test(href),
              ),
        );

        if (links.length === 0) {
          console.log(
            `    No group links found — end of pagination at page ${pageNum}.`,
          );
          break;
        }

        let newOnPage = 0;
        for (const url of links) {
          const m = url.match(GROUP_URL_RE);
          if (m) {
            const slug = m[1];
            if (!topicUrls.has(slug)) {
              topicUrls.set(slug, url);
              newOnPage++;
            }
          }
        }

        console.log(
          `    Found ${links.length} group links (${newOnPage} new, total ${topicUrls.size})`,
        );

        await randomDelay();
      } catch (err) {
        console.error(
          `    ERROR loading index page ${pageNum}: ${(err as Error).message}`,
        );
        break;
      }
    }

    console.log(`\nTotal unique group topics discovered: ${topicUrls.size}`);

    if (topicUrls.size === 0) {
      // Check if cached HTML files already exist before treating this as a fatal error
      let cachedFiles: string[] = [];
      try {
        cachedFiles = (await fs.readdir(DEST_DIR)).filter((f) =>
          f.endsWith('.html'),
        );
      } catch {
        // Directory may not exist yet — treat as no cache
      }
      if (cachedFiles.length > 0) {
        console.warn(
          `⚠ No new topics fetched, but ${cachedFiles.length} cached files exist in ${DEST_DIR}. Using cached data.`,
        );
        process.exit(0);
      }
      console.error(
        '\nERROR: Zero topic URLs collected. The site structure may have changed.',
      );
      process.exit(1);
    }

    // ── Step 2: Fetch each topic page ────────────────────────────────────────
    console.log('\n=== Fetching individual topic pages ===\n');

    let fetched = 0;
    let skipped = 0;
    let failed = 0;

    for (const [slug, url] of topicUrls) {
      const outputFile = path.join(DEST_DIR, `${slug}.html`);

      // Skip if already saved
      try {
        await fs.access(outputFile);
        console.log(`  SKIP (exists): ${slug}`);
        skipped++;
        continue;
      } catch {
        // not present — proceed
      }

      console.log(`  Fetching: ${slug}`);
      console.log(`    URL: ${url}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });

        // Wait for the SPA to render meaningful content
        await page
          .waitForSelector('h1, main, #content, article', {
            timeout: 15_000,
          })
          .catch(() => null);

        await sleep(800); // small extra settle

        const html = await page.content();

        if (html.length < 800) {
          console.warn(
            `    WARNING: response too small (${html.length} bytes) — skipping`,
          );
          failed++;
          await randomDelay();
          continue;
        }

        await fs.writeFile(outputFile, html, 'utf8');
        fetched++;
        console.log(`    Saved: ${outputFile} (${(html.length / 1024).toFixed(1)} KB)`);
      } catch (err) {
        console.error(`    ERROR: ${(err as Error).message}`);
        failed++;
      }

      await randomDelay();
    }

    console.log('\n=== Done ===');
    console.log(`  Fetched : ${fetched} topic(s)`);
    console.log(`  Skipped : ${skipped} topic(s) (already existed)`);
    console.log(`  Failed  : ${failed} topic(s)`);
    console.log(`  Output  : ${DEST_DIR}/`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
