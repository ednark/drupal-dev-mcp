import { executeWithRetry } from './retry-handler.ts';
import { buildGoogleSearchUrl } from './warmup.ts';

const DEFAULT_MIN_DELAY_MS = 3000;
const DEFAULT_MAX_DELAY_MS = 10000;

const USER_AGENT_POOL: readonly string[] = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.91 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0',
];

export interface HttpFetcherOptions {
  timeoutMs?: number;
  retries?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  referer?: string;
}

export interface HttpFetchResult {
  url: string;
  status: number;
  html: string;
  headers: Headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(items: readonly T[]): T {
  const index = randomInt(0, items.length - 1);
  return items[index];
}

function buildBrowserHeaders(rawUrl: string, _referer?: string): HeadersInit {
  const googleReferer = buildGoogleSearchUrl(rawUrl);

  return {
    'User-Agent': pickRandom(USER_AGENT_POOL),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'max-age=0',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    Referer: googleReferer,
    Origin: new URL(rawUrl).origin,
  };
}

export async function fetchWithHttp(rawUrl: string, options: HttpFetcherOptions = {}): Promise<HttpFetchResult | null> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = options.retries ?? 3;
  const minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
  const maxDelayMs = Math.max(options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS, minDelayMs);

  const result = await executeWithRetry<HttpFetchResult>(
    async () => {
      await sleep(randomInt(minDelayMs, maxDelayMs));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(rawUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: buildBrowserHeaders(rawUrl, options.referer),
        });

        const html = await response.text();
        if (!html.trim()) {
          return null;
        }

        return {
          url: rawUrl,
          status: response.status,
          html,
          headers: response.headers,
        };
      } finally {
        clearTimeout(timer);
      }
    },
    (attemptResult) => {
      if (!attemptResult) {
        return true;
      }

      if (attemptResult.status >= 500) {
        return true;
      }

      return false;
    },
    rawUrl,
    {
      maxRetries: retries,
      baseDelayMs: 1000,
    },
  );

  return result;
}
