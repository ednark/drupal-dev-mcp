#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import pLimit from 'p-limit';
import type { Page } from 'playwright';
import { dismissCookieConsent, preSetConsentCookies } from './cookie-handler.ts';
import { extractMainContentHtml, extractTextFromHtml } from './content-extractor.ts';
import { fetchUrlMultiTier } from './multi-tier-fetcher.ts';
import { RateLimiter } from './rate-limiter.ts';
import { executeWithRetry, isBlockedOrInvalidResponse } from './retry-handler.ts';
import type { BrowserSession } from './stealth-browser.ts';
import { createBrowserSession } from './stealth-browser.ts';
import { simulateGoogleReferral, warmUpBrowser } from './warmup.ts';

type OutputFormat = 'html' | 'text';
type FilenamePattern = 'slug' | 'url';
type FetchStrategy = 'multi-tier' | 'playwright';

interface FetchUrlOptions {
  format: OutputFormat;
  headless?: boolean;
  simulateHuman?: boolean;
  timeoutMs?: number;
  referrer?: string;
  strategy?: FetchStrategy;
}

interface FetchUrlResult {
  url: string;
  status: number | null;
  content: string;
  tier: 'wayback' | 'http' | 'jina' | 'playwright';
}

interface BatchCommandOptions {
  outputDir: string;
  format: OutputFormat;
  concurrency: number;
  skipExisting: boolean;
  headless?: boolean;
  filenamePattern: FilenamePattern;
  simulateHuman?: boolean;
  strategy: FetchStrategy;
}

const DEFAULT_STORAGE_STATE_PATH = 'data/cache/playwright-storage-state.json';

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function extensionForFormat(format: OutputFormat): string {
  return format === 'html' ? 'html' : 'txt';
}

function normalizeDash(value: string): string {
  return value.replace(/-+/g, '-').replace(/^-/, '').replace(/-$/, '');
}

function filenameFromUrlPattern(rawUrl: string): string {
  const protocolReplaced = rawUrl.replace(/:\/\//g, '-');
  const slashReplaced = protocolReplaced.replace(/[/?#=&:]+/g, '-');
  return normalizeDash(slashReplaced);
}

function filenameFromSlugPattern(rawUrl: string): string {
  const protocolReplaced = rawUrl.replace(/:\/\//g, '-');
  const slug = protocolReplaced.replace(/[./?#=&:]+/g, '-');
  return normalizeDash(slug);
}

function buildOutputFilename(url: string, format: OutputFormat, pattern: FilenamePattern): string {
  const ext = extensionForFormat(format);
  const baseName = pattern === 'slug' ? filenameFromSlugPattern(url) : filenameFromUrlPattern(url);
  return `${baseName}.${ext}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function parseUrlListFile(filePath: string): Promise<string[]> {
  const source = await fs.readFile(filePath, 'utf8');
  return source
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

async function simulateHumanBehavior(page: Page): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1366, height: 768 };
  const x1 = randomInt(50, Math.max(60, viewport.width - 50));
  const y1 = randomInt(50, Math.max(60, viewport.height - 50));
  const x2 = randomInt(50, Math.max(60, viewport.width - 50));
  const y2 = randomInt(50, Math.max(60, viewport.height - 50));

  await page.mouse.move(x1, y1, { steps: randomInt(8, 24) });
  await page.waitForTimeout(randomInt(120, 350));
  await page.mouse.move(x2, y2, { steps: randomInt(8, 24) });
  await page.waitForTimeout(randomInt(120, 350));

  const scrollHeight = await page.evaluate(() => document.documentElement?.scrollHeight ?? document.body?.scrollHeight ?? 2000);
  const targetScrollDistance = Math.min(Math.max(1200, Math.floor(scrollHeight * 0.6)), 8000);
  let scrolled = 0;
  while (scrolled < targetScrollDistance) {
    const step = randomInt(250, 900);
    await page.mouse.wheel(0, step);
    scrolled += step;
    await page.waitForTimeout(randomInt(180, 550));
  }

  await page.waitForTimeout(randomInt(200, 700));
}

function extractDomain(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
}

function buildReferrerPool(domain: string): string[] {
  return [
    `https://${domain}/`,
    'https://www.drupal.org/',
    'https://www.google.com/search?q=drupal+form+api',
  ];
}

function pickReferrerForUrl(url: string): string {
  const domain = extractDomain(url);
  const pool = domain ? buildReferrerPool(domain) : ['https://www.drupal.org/'];
  return pool[randomInt(0, pool.length - 1)];
}

async function waitForDrupalContentReady(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 8_000 });
  } catch {
    // Best-effort; some pages keep long-lived connections open.
  }

  try {
    await page.waitForSelector('.layout-content, #block-system-main, main .region-content, article', {
      timeout: 6_000,
      state: 'attached',
    });
  } catch {
    // Continue to extraction fallback if Drupal-specific selectors are not present.
  }
}

async function fetchUrlWithPlaywright(session: BrowserSession, url: string, options: FetchUrlOptions): Promise<FetchUrlResult | null> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const referrer = options.referrer ?? pickReferrerForUrl(url);
  let googleReferralAttempted = false;

  return executeWithRetry<FetchUrlResult>(
    async () => {
      let page: Page | null = null;
      try {
        if (!googleReferralAttempted) {
          googleReferralAttempted = true;
          console.error('[fetcher] operation: simulating Google referral flow', url);
          page = await simulateGoogleReferral(session, url);
          console.error('[fetcher] operation: Google referral navigation complete', url);
        } else {
          console.error('[fetcher] operation: opening page', url);
          page = await session.openPage(url, {
            timeoutMs,
            waitUntil: 'domcontentloaded',
            referer: referrer,
            beforeNavigate: async (tab) => {
              await preSetConsentCookies(tab, url);
            },
          });
          console.error('[fetcher] operation: page opened', url);
        }

        console.error('[fetcher] operation: dismissing cookie consent');
        await dismissCookieConsent(page);
        console.error('[fetcher] operation: cookie consent dismissed');

        if (options.simulateHuman) {
          console.error('[fetcher] operation: simulating human behavior');
          await simulateHumanBehavior(page);
          console.error('[fetcher] operation: simulate human done');
        }

        console.error('[fetcher] operation: waiting for Drupal content ready');
        await waitForDrupalContentReady(page);
        await page.waitForTimeout(randomInt(6000, 11000));
        console.error('[fetcher] operation: waited for content, extracting HTML');

        const htmlContent = await extractMainContentHtml(page);
        console.error('[fetcher] operation: extracted html length=', typeof htmlContent === 'string' ? htmlContent.length : 'null');
        if (typeof htmlContent === 'string') {
          console.error('[fetcher] operation: html snippet:', htmlContent.slice(0, 200).replace(/\n/g, ' '));
        }
        const status = null;

        let blocked = isBlockedOrInvalidResponse(status, htmlContent);
        console.error('[fetcher] operation: isBlockedOrInvalidResponse=', blocked);

        // If the page looks blocked, give it one more chance: wait a bit and re-check.
        if (blocked) {
          console.error('[fetcher] operation: blocked detected, attempting mitigation');

          // Try a lightweight mitigation: simulate human interaction + reload once.
          try {
            await simulateHumanBehavior(page).catch(() => undefined);
            await page.waitForTimeout(randomInt(2000, 5000));
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
            await waitForDrupalContentReady(page);
            await page.waitForTimeout(randomInt(2500, 5000));
          } catch (e) {
            console.error('[fetcher] operation: mitigation actions failed:', e instanceof Error ? e.message : e);
          }

          // Re-extract after mitigation and re-evaluate blocking.
          const htmlContentRetry = await extractMainContentHtml(page);
          console.error('[fetcher] operation: retry extracted html length=', typeof htmlContentRetry === 'string' ? htmlContentRetry.length : 'null');
          blocked = isBlockedOrInvalidResponse(status, htmlContentRetry);
          console.error('[fetcher] operation: retry isBlockedOrInvalidResponse=', blocked);
          if (blocked) {
            console.error('[fetcher] operation: still blocked after mitigation, attempting fresh page with alternate referrer');

            // Attempt one final fresh open with an alternate referrer to bypass perimeter checks.
            try {
              await session.closePage(page).catch(() => undefined);
              page = await session.openPage(url, {
                timeoutMs,
                waitUntil: 'domcontentloaded',
                referer: 'https://www.google.com/',
                beforeNavigate: async (tab) => {
                  await preSetConsentCookies(tab, url);
                },
              });

              await dismissCookieConsent(page).catch(() => undefined);
              await simulateHumanBehavior(page).catch(() => undefined);
              await waitForDrupalContentReady(page).catch(() => undefined);
              await page.waitForTimeout(randomInt(3500, 7000));

              const htmlContentAlt = await extractMainContentHtml(page);
              console.error('[fetcher] operation: alt extracted html length=', typeof htmlContentAlt === 'string' ? htmlContentAlt.length : 'null');
              const blockedAlt = isBlockedOrInvalidResponse(status, htmlContentAlt);
              console.error('[fetcher] operation: alt isBlockedOrInvalidResponse=', blockedAlt);
              if (blockedAlt) {
                console.error('[fetcher] operation: alt attempt also blocked, returning null');
                return null;
              }

              // Use alt content if valid
              const contentAlt = options.format === 'text' ? await extractTextFromHtml(page) : htmlContentAlt;
              if (!contentAlt || !contentAlt.trim()) {
                console.error('[fetcher] operation: alt content empty, returning null');
                return null;
              }

              return {
                url,
                status,
                content: contentAlt,
                tier: 'playwright',
              };
            } catch (e) {
              console.error('[fetcher] operation: alt attempt failed:', e instanceof Error ? e.message : e);
              return null;
            }
          }
        }

        const content = options.format === 'text' ? await extractTextFromHtml(page) : htmlContent;
        console.error('[fetcher] operation: final content length=', typeof content === 'string' ? content.length : 'null');
        if (!content || !content.trim()) {
          console.error('[fetcher] operation: content empty after extraction, returning null');
          return null;
        }

        return {
          url,
          status,
          content,
          tier: 'playwright',
        };
      } finally {
        await session.persistStorageState().catch(() => undefined);
        if (page) {
          await session.closePage(page).catch(() => undefined);
        }
      }
    },
    (result: FetchUrlResult | null) => result === null || !result.content.trim(),
    url,
    { maxRetries: 3, baseDelayMs: 2000 },
  );
}

async function fetchUrl(session: BrowserSession, url: string, options: FetchUrlOptions): Promise<FetchUrlResult | null> {
  if (options.strategy === 'playwright') {
    return fetchUrlWithPlaywright(session, url, options);
  }

  const timeoutMs = options.timeoutMs ?? 60_000;
  const multiTierResult = await fetchUrlMultiTier(url, {
    format: options.format,
    timeoutMs,
    preferFromDate: '20240101',
    preferToDate: '20251231',
    playwrightFetch: async () => {
      const fallback = await fetchUrlWithPlaywright(session, url, {
        ...options,
        headless: false,
        simulateHuman: true,
        timeoutMs,
      });

      if (!fallback?.content?.trim()) {
        return null;
      }

      return fallback.content;
    },
  });

  if (!multiTierResult?.content?.trim()) {
    return null;
  }

  return {
    url,
    status: multiTierResult.status,
    content: multiTierResult.content,
    tier: multiTierResult.tier,
  };
}

async function runSingle(url: string, options: {
  output?: string;
  format?: OutputFormat;
  headless?: boolean;
  simulateHuman?: boolean;
  strategy?: FetchStrategy;
}): Promise<void> {
  const format = options.format ?? 'html';
  const strategy = options.strategy ?? 'multi-tier';
  const sessionHeadless = false;
  const storageStatePath = DEFAULT_STORAGE_STATE_PATH;
  console.error('[fetcher] creating browser session');
  const session = await createBrowserSession({
    headless: sessionHeadless,
    channel: 'chrome',
    storageStatePath,
  });
  console.error('[fetcher] browser session created');
  let result: FetchUrlResult | null = null;

  try {
    const domain = extractDomain(url);
    if (domain) {
      console.error('[fetcher] starting warm-up for domain', domain);
      try {
        await warmUpBrowser(session, domain);
        console.error('[fetcher] warm-up completed');
      } catch (e) {
        console.warn('[fetcher] warm-up failed (non-fatal):', e instanceof Error ? e.message : e);
      }
    }

    console.error('[fetcher] starting fetch for', url);
    result = await fetchUrl(session, url, {
      format,
      headless: options.headless,
      simulateHuman: options.simulateHuman,
      referrer: pickReferrerForUrl(url),
      strategy,
    });
    console.error('[fetcher] fetch completed for', url, 'result?', Boolean(result));
  } finally {
    await session.close();
  }

  if (!result) {
    throw new Error(`Permanent failure while fetching URL: ${url}`);
  }

  process.stderr.write(`[fetcher] tier=${result.tier} url=${url}\n`);

  if (options.output) {
    const outputPath = path.resolve(options.output);
    await ensureDirectory(path.dirname(outputPath));
    await fs.writeFile(outputPath, result.content, 'utf8');
    process.stderr.write(`[fetcher] saved ${url} -> ${outputPath}\n`);
    return;
  }

  process.stdout.write(result.content);
}

async function runBatch(urlListFile: string, options: BatchCommandOptions): Promise<void> {
  const urls = await parseUrlListFile(urlListFile);
  await ensureDirectory(options.outputDir);

  const sessionHeadless = false;
  const storageStatePath = DEFAULT_STORAGE_STATE_PATH;
  const session = await createBrowserSession({
    headless: sessionHeadless,
    channel: 'chrome',
    storageStatePath,
  });

  const effectiveConcurrency = options.strategy === 'playwright'
    ? 1
    : Math.max(1, Math.min(2, options.concurrency));
  const limiter = pLimit(effectiveConcurrency);
  const delayMin = options.strategy === 'playwright' ? 30_000 : 5_000;
  const delayMax = options.strategy === 'playwright' ? 75_000 : 15_000;
  const rpm = options.strategy === 'playwright' ? 1 : 4;
  const rateLimiter = new RateLimiter({
    minDelayMs: delayMin,
    maxDelayMs: delayMax,
    requestsPerMinute: rpm,
    adaptiveWindowMs: 180_000,
    adaptiveStepMs: 2000,
    adaptiveMaxPenaltyMs: 25_000,
  });

  const total = urls.length;
  let completed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const warmedDomains = new Set<string>();
    for (const url of urls) {
      const domain = extractDomain(url);
      if (!domain || warmedDomains.has(domain)) {
        continue;
      }

      await warmUpBrowser(session, domain).catch(() => undefined);
      warmedDomains.add(domain);
    }

    const tasks = urls.map((url) => limiter(async () => {
      const fileName = buildOutputFilename(url, options.format, options.filenamePattern);
      const outputPath = path.join(options.outputDir, fileName);

      if (options.skipExisting && (await fileExists(outputPath))) {
        skipped += 1;
        completed += 1;
        process.stderr.write(`[${completed}/${total}] SKIP ${url}\n`);
        return;
      }

      await rateLimiter.waitForTurn(url);
      await new Promise((resolve) => setTimeout(resolve, randomInt(900, 3200)));

      const result = await fetchUrl(session, url, {
        format: options.format,
        headless: options.headless,
        simulateHuman: options.simulateHuman,
        referrer: pickReferrerForUrl(url),
        strategy: options.strategy,
      });

      completed += 1;
      if (!result) {
        failed += 1;
        process.stderr.write(`[${completed}/${total}] FAIL ${url}\n`);
        return;
      }

      await fs.writeFile(outputPath, result.content, 'utf8');
      await new Promise((resolve) => setTimeout(resolve, randomInt(750, 2500)));
      succeeded += 1;
      process.stderr.write(`[${completed}/${total}] OK   [${result.tier}] ${url} -> ${outputPath}\n`);
    }));

    await Promise.all(tasks);
    process.stderr.write(
      `[fetcher] complete total=${total} ok=${succeeded} fail=${failed} skipped=${skipped} output=${options.outputDir}\n`,
    );
  } finally {
    await session.close();
  }
}

function addSingleCommand(parent: Command): void {
  parent
    .command('single <url>')
    .description('Fetch a single URL')
    .option('-o, --output <file>', 'Write output to file')
    .option('-f, --format <html|text>', 'Output format', 'html')
    .option('--headless', 'Run in headless mode')
    .option('--simulate-human', 'Enable optional mouse movement + scroll simulation')
    .option('--strategy <multi-tier|playwright>', 'Fetch strategy', 'multi-tier')
    .action(async (url: string, opts: { output?: string; format?: OutputFormat; headless?: boolean; simulateHuman?: boolean; strategy?: FetchStrategy }) => {
      await runSingle(url, {
        output: opts.output,
        format: opts.format,
        headless: opts.headless,
        simulateHuman: opts.simulateHuman,
        strategy: opts.strategy,
      });
    });
}

function addBatchCommand(parent: Command): void {
  parent
    .command('batch <urlListFile>')
    .description('Fetch URLs from a file (one URL per line; # comments and empty lines are skipped)')
    .option('-o, --output-dir <dir>', 'Output directory', 'data/sources')
    .option('-f, --format <html|text>', 'Output format', 'html')
    .option('-c, --concurrency <n>', 'Concurrent workers', '1')
    .option('--skip-existing', 'Skip output files that already exist')
    .option('--filename-pattern <slug|url>', 'Output naming pattern', 'url')
    .option('--headless', 'Run in headless mode')
    .option('--simulate-human', 'Enable optional mouse movement + scroll simulation')
    .option('--strategy <multi-tier|playwright>', 'Fetch strategy', 'multi-tier')
    .action(async (urlListFile: string, opts: {
      outputDir: string;
      format: OutputFormat;
      concurrency: string;
      skipExisting?: boolean;
      filenamePattern: FilenamePattern;
      headless?: boolean;
      simulateHuman?: boolean;
      strategy: FetchStrategy;
    }) => {
      await runBatch(urlListFile, {
        outputDir: opts.outputDir,
        format: opts.format,
        concurrency: Number.parseInt(opts.concurrency, 10) || 1,
        skipExisting: Boolean(opts.skipExisting),
        filenamePattern: opts.filenamePattern,
        headless: opts.headless,
        simulateHuman: opts.simulateHuman,
        strategy: opts.strategy,
      });
    });
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('drupal-fetcher')
    .description('Multi-tier URL fetcher (Wayback -> HTTP -> Playwright fallback)')
    .version('1.0.0');

  // Support both forms:
  // - fetch single <url>
  // - single <url>
  addSingleCommand(program);
  addBatchCommand(program);

  const fetchCommand = program.command('fetch').description('Namespaced commands');
  addSingleCommand(fetchCommand);
  addBatchCommand(fetchCommand);

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[fetcher] fatal: ${message}\n`);
  process.exit(1);
});
