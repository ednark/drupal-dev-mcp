export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

export interface RetryAttemptContext {
  url: string;
  attempt: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayForAttempt(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * Math.pow(2, attempt - 1);
}

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

export function isBlockedOrInvalidResponse(status: number | null, body: string): boolean {
  if (status !== null && [401, 403, 429, 503].includes(status)) {
    return true;
  }

  const normalizedBody = normalize(body);
  if (!normalizedBody) {
    return true;
  }

  const blockMarkers = [
    'access denied',
    'you have been blocked',
    'forbidden',
    'cloudflare',
    'checking your browser before accessing',
    'attention required',
    'perimeterx',
    'captcha',
    'verify you are human',
  ];

  return blockMarkers.some((marker) => normalizedBody.includes(marker));
}

export async function executeWithRetry<T>(
  operation: (context: RetryAttemptContext) => Promise<T | null>,
  isResultInvalid: (result: T | null) => boolean,
  url: string,
  options: RetryOptions = {},
): Promise<T | null> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      // Log attempt start
      console.error(`[fetcher] retry:${attempt} url:${url} - starting attempt`);
      const result = await operation({ url, attempt });

      if (!isResultInvalid(result)) {
        console.error(`[fetcher] retry:${attempt} url:${url} - success`);
        return result;
      }

      console.error(`[fetcher] retry:${attempt} url:${url} - result considered invalid, will retry if attempts remain`);
    } catch (err) {
      // Log the caught exception for diagnostics; continue to retry.
      console.error(
        `[fetcher] retry:${attempt} url:${url} - exception caught during attempt:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    if (attempt < maxRetries) {
      await sleep(delayForAttempt(attempt, baseDelayMs));
    }
  }

  return null;
}
