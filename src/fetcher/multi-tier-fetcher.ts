import { load } from 'cheerio';
import { fetchWithHttp } from './http-fetcher.ts';
import { fetchWithJina } from './jina-fetcher.ts';
import { isBlockedOrInvalidResponse } from './retry-handler.ts';
import { fetchFromWayback } from './wayback-fetcher.ts';

export type MultiTierName = 'wayback' | 'http' | 'jina' | 'playwright';
export type MultiTierOutputFormat = 'html' | 'text';

export interface MultiTierFetchOptions {
  format?: MultiTierOutputFormat;
  timeoutMs?: number;
  preferFromDate?: string;
  preferToDate?: string;
  playwrightFetch?: () => Promise<string | null>;
}

export interface MultiTierFetchResult {
  content: string;
  status: number | null;
  tier: MultiTierName;
  sourceUrl?: string;
}

let playwrightFallbackChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function extractMainContentFromHtml(html: string): string {
  const $ = load(html);
  const selectors = [
    '[data-history-node-id]',
    'article.node',
    '.node--view-mode-full',
    '.layout-main-wrapper',
    'main article',
    'main .region-content',
    'article',
    'main',
    '.content',
    '#content',
    '.region-content',
    '#block-system-main',
    'body',
  ];

  let best = '';
  let bestTextLen = 0;
  for (const selector of selectors) {
    const candidate = $(selector).first();
    if (!candidate.length) {
      continue;
    }

    const candidateText = candidate.text().trim();
    if (candidateText.length > bestTextLen) {
      bestTextLen = candidateText.length;
      best = $.html(candidate);
    }
  }

  return best || html;
}

function extractTextFromHtmlString(html: string): string {
  const $ = load(html);
  const selectors = [
    '[data-history-node-id]',
    'article.node',
    '.node--view-mode-full',
    '.layout-main-wrapper',
    'main article',
    'main .region-content',
    'article',
    'main',
    '.content',
    '#content',
    '.region-content',
    '#block-system-main',
    'body',
  ];

  let best = '';
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text.length > best.length) {
      best = text;
    }
  }

  return best || $.text().trim();
}

function formatContent(html: string, format: MultiTierOutputFormat): string {
  if (format === 'text') {
    return extractTextFromHtmlString(html);
  }

  return extractMainContentFromHtml(html);
}

function queuePlaywrightFallback(operation: () => Promise<string | null>): Promise<string | null> {
  const run = playwrightFallbackChain.then(async () => {
    await sleep(randomInt(15_000, 45_000));
    return operation();
  });

  playwrightFallbackChain = run.then(() => undefined).catch(() => undefined);
  return run;
}

export async function fetchUrlMultiTier(url: string, options: MultiTierFetchOptions = {}): Promise<MultiTierFetchResult | null> {
  const format = options.format ?? 'html';
  const timeoutMs = options.timeoutMs ?? 60_000;

  const wayback = await fetchFromWayback(url, {
    timeoutMs,
    from: options.preferFromDate,
    to: options.preferToDate,
  });

  if (wayback?.html?.trim()) {
    return {
      content: formatContent(wayback.html, format),
      status: 200,
      tier: 'wayback',
      sourceUrl: wayback.archivedUrl,
    };
  }

  const http = await fetchWithHttp(url, {
    timeoutMs,
    retries: 3,
    minDelayMs: 3000,
    maxDelayMs: 10000,
    referer: 'https://www.drupal.org/docs',
  });

  if (http?.html?.trim()) {
    const blocked = isBlockedOrInvalidResponse(http.status, http.html);
    if (!blocked) {
      return {
        content: formatContent(http.html, format),
        status: http.status,
        tier: 'http',
      };
    }
  }

  // Tier 3: Jina AI Reader — headless browser fleet, returns clean Markdown,
  // no bot-detection risk, no API key needed for public pages.
  const jina = await fetchWithJina(url, timeoutMs);
  if (jina?.markdown?.trim()) {
    return {
      content: jina.markdown,
      status: 200,
      tier: 'jina',
      sourceUrl: jina.sourceUrl,
    };
  }

  if (!options.playwrightFetch) {
    return null;
  }

  const playwrightContent = await queuePlaywrightFallback(options.playwrightFetch);
  if (!playwrightContent || !playwrightContent.trim()) {
    return null;
  }

  return {
    content: playwrightContent,
    status: null,
    tier: 'playwright',
  };
}

