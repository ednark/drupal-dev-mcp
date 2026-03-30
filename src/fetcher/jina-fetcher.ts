/**
 * Jina AI Reader fetcher.
 *
 * Fetches any public URL by prefixing it with https://r.jina.ai/ which returns
 * clean Markdown extracted from the live page. No API key required for public pages.
 * Because Jina operates its own headless browser fleet the caller doesn't need to
 * worry about bot-detection, JavaScript rendering, or HTML-to-Markdown conversion.
 *
 * The returned `markdown` field is already plain Markdown text and should be used
 * as-is without further HTML extraction.
 */

const JINA_BASE_URL = 'https://r.jina.ai/';

export interface JinaFetchResult {
  /** Clean Markdown content extracted from the target page. */
  markdown: string;
  /** The original target URL (not the r.jina.ai URL). */
  sourceUrl: string;
}

/**
 * Signs of a failed / blocked Jina response even when the HTTP status is 2xx.
 */
function isJinaErrorContent(text: string): boolean {
  const lower = text.slice(0, 500).toLowerCase();
  return (
    lower.includes('error fetching') ||
    lower.includes('unable to fetch') ||
    lower.includes('404 not found') ||
    lower.includes('access denied') ||
    lower.includes('page not found') ||
    text.trim().length < 100
  );
}

export async function fetchWithJina(
  url: string,
  timeoutMs = 30_000,
): Promise<JinaFetchResult | null> {
  const jinaUrl = `${JINA_BASE_URL}${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(jinaUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'text/plain, text/markdown, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Return-Format': 'markdown',
      },
    });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();

    if (!text.trim() || isJinaErrorContent(text)) {
      return null;
    }

    return { markdown: text, sourceUrl: url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
