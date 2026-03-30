import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const ARCHIVE_MIN_INTERVAL_MS = 2000;
const DEFAULT_CACHE_FILE = 'data/cache/wayback-cdx-cache.json';

let archiveLastRequestAt = 0;
let archiveRequestChain: Promise<void> = Promise.resolve();

type WaybackCacheEntry = {
  timestamp: string | null;
  statusCode: string | null;
  checkedAt: string;
};

type WaybackCacheMap = Record<string, WaybackCacheEntry>;

export interface WaybackFetcherOptions {
  from?: string;
  to?: string;
  cacheFile?: string;
  timeoutMs?: number;
  forceRefresh?: boolean;
}

export interface WaybackFetchResult {
  sourceUrl: string;
  archivedUrl: string;
  timestamp: string;
  html: string;
}

interface AvailableApiResponse {
  archived_snapshots?: {
    closest?: {
      available?: boolean;
      status?: string;
      timestamp?: string;
      url?: string;
    };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDateRange(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const cleaned = value.replace(/[^0-9]/g, '');
  if (cleaned.length !== 8) {
    return fallback;
  }

  return cleaned;
}

function buildArchivedContentUrl(timestamp: string, rawUrl: string): string {
  return `https://web.archive.org/web/${timestamp}id_/${rawUrl}`;
}

async function withArchiveRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  const run = archiveRequestChain.then(async () => {
    const now = Date.now();
    const elapsed = now - archiveLastRequestAt;
    const waitMs = Math.max(0, ARCHIVE_MIN_INTERVAL_MS - elapsed);
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    const result = await operation();
    archiveLastRequestAt = Date.now();
    return result;
  });

  archiveRequestChain = run.then(() => undefined).catch(() => undefined);
  return run;
}

async function readCache(cacheFile: string): Promise<WaybackCacheMap> {
  try {
    const raw = await fs.readFile(cacheFile, 'utf8');
    const parsed = JSON.parse(raw) as WaybackCacheMap;
    return parsed ?? {};
  } catch {
    return {};
  }
}

async function writeCache(cacheFile: string, cache: WaybackCacheMap): Promise<void> {
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2), 'utf8');
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await withArchiveRateLimit(() => fetch(url, { signal: controller.signal }));
    if (!response.ok) {
      throw new Error(`Wayback request failed (${response.status}) for ${url}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await withArchiveRateLimit(() => fetch(url, { signal: controller.signal }));
    if (!response.ok) {
      throw new Error(`Wayback content fetch failed (${response.status}) for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseCdxTimestamp(payload: unknown): string | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  if (payload.length < 2) {
    return null;
  }

  const [, firstRow] = payload;
  if (!Array.isArray(firstRow)) {
    return null;
  }

  const [timestamp, statusCode] = firstRow;
  if (typeof timestamp !== 'string') {
    return null;
  }

  if (typeof statusCode === 'string' && statusCode !== '200') {
    return null;
  }

  return timestamp;
}

async function lookupTimestampViaCdx(rawUrl: string, from: string, to: string, timeoutMs: number): Promise<string | null> {
  const cdxUrl = new URL('https://web.archive.org/cdx/search/cdx');
  cdxUrl.searchParams.set('url', rawUrl);
  cdxUrl.searchParams.set('output', 'json');
  cdxUrl.searchParams.set('limit', '1');
  cdxUrl.searchParams.set('fl', 'timestamp,statuscode');
  cdxUrl.searchParams.set('filter', 'statuscode:200');
  cdxUrl.searchParams.set('from', from);
  cdxUrl.searchParams.set('to', to);
  cdxUrl.searchParams.set('sort', 'desc');

  const payload = await fetchJsonWithTimeout<unknown>(cdxUrl.toString(), timeoutMs);
  return parseCdxTimestamp(payload);
}

async function lookupTimestampViaCdxAny(rawUrl: string, timeoutMs: number): Promise<string | null> {
  const cdxUrl = new URL('https://web.archive.org/cdx/search/cdx');
  cdxUrl.searchParams.set('url', rawUrl);
  cdxUrl.searchParams.set('output', 'json');
  cdxUrl.searchParams.set('limit', '1');
  cdxUrl.searchParams.set('fl', 'timestamp,statuscode');
  cdxUrl.searchParams.set('filter', 'statuscode:200');
  cdxUrl.searchParams.set('sort', 'desc');

  const payload = await fetchJsonWithTimeout<unknown>(cdxUrl.toString(), timeoutMs);
  return parseCdxTimestamp(payload);
}

async function lookupTimestampViaAvailable(rawUrl: string, timeoutMs: number): Promise<string | null> {
  const availableUrl = new URL('https://archive.org/wayback/available');
  availableUrl.searchParams.set('url', rawUrl);

  const payload = await fetchJsonWithTimeout<AvailableApiResponse>(availableUrl.toString(), timeoutMs);
  const closest = payload.archived_snapshots?.closest;
  if (!closest?.available || !closest.timestamp) {
    return null;
  }

  if (closest.status && closest.status !== '200') {
    return null;
  }

  return closest.timestamp;
}

export async function fetchFromWayback(rawUrl: string, options: WaybackFetcherOptions = {}): Promise<WaybackFetchResult | null> {
  const timeoutMs = options.timeoutMs ?? 25_000;
  const from = normalizeDateRange(options.from, '20240101');
  const to = normalizeDateRange(options.to, '20251231');
  const cacheFile = options.cacheFile ?? DEFAULT_CACHE_FILE;
  const cacheKey = `${rawUrl}::${from}-${to}`;

  const cache = await readCache(cacheFile);
  let timestamp: string | null = null;

  if (!options.forceRefresh && cache[cacheKey]) {
    timestamp = cache[cacheKey].timestamp;
  }

  if (!timestamp) {
    try {
      timestamp = await lookupTimestampViaCdx(rawUrl, from, to, timeoutMs);
    } catch {
      timestamp = null;
    }

    if (!timestamp) {
      try {
        timestamp = await lookupTimestampViaAvailable(rawUrl, timeoutMs);
      } catch {
        timestamp = null;
      }
    }

    if (!timestamp) {
      try {
        timestamp = await lookupTimestampViaCdxAny(rawUrl, timeoutMs);
      } catch {
        timestamp = null;
      }
    }

    cache[cacheKey] = {
      timestamp,
      statusCode: timestamp ? '200' : null,
      checkedAt: new Date().toISOString(),
    };
    await writeCache(cacheFile, cache);
  }

  if (!timestamp) {
    return null;
  }

  const archivedUrl = buildArchivedContentUrl(timestamp, rawUrl);

  try {
    const html = await fetchTextWithTimeout(archivedUrl, timeoutMs);
    if (!html.trim()) {
      return null;
    }

    return {
      sourceUrl: rawUrl,
      archivedUrl,
      timestamp,
      html,
    };
  } catch {
    return null;
  }
}
