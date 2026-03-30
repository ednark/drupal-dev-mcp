type DomainState = {
  requestTimestamps: number[];
  lastRequestAt: number;
};

export interface RateLimiterOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  requestsPerMinute?: number;
  adaptiveWindowMs?: number;
  adaptiveStepMs?: number;
  adaptiveMaxPenaltyMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizeHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return 'unknown-host';
  }
}

export class RateLimiter {
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly requestsPerMinute: number;
  private readonly adaptiveWindowMs: number;
  private readonly adaptiveStepMs: number;
  private readonly adaptiveMaxPenaltyMs: number;
  private readonly domains = new Map<string, DomainState>();

  public constructor(options: RateLimiterOptions = {}) {
    this.minDelayMs = options.minDelayMs ?? 4000;
    this.maxDelayMs = Math.max(options.maxDelayMs ?? 12000, this.minDelayMs);
    this.requestsPerMinute = options.requestsPerMinute ?? 6;
    this.adaptiveWindowMs = options.adaptiveWindowMs ?? 180_000;
    this.adaptiveStepMs = options.adaptiveStepMs ?? 1500;
    this.adaptiveMaxPenaltyMs = options.adaptiveMaxPenaltyMs ?? 20_000;
  }

  public async waitForTurn(rawUrl: string): Promise<void> {
    const host = normalizeHost(rawUrl);
    const now = Date.now();
    const domain = this.getOrCreateDomain(host);

    // Keep only timestamps from the last minute.
    domain.requestTimestamps = domain.requestTimestamps.filter((ts) => now - ts < 60_000);
    const recentWindow = domain.requestTimestamps.filter((ts) => now - ts < this.adaptiveWindowMs);

    const jitterDelay = randomInt(this.minDelayMs, this.maxDelayMs);
    const elapsedSinceLastRequest = now - domain.lastRequestAt;
    const waitForJitter = Math.max(0, jitterDelay - elapsedSinceLastRequest);

    // Adaptive penalty: if we keep hitting the same host in a rolling window,
    // apply additional cool-down to lower risk of anti-bot triggers.
    const adaptivePenalty = Math.min(
      this.adaptiveMaxPenaltyMs,
      Math.max(0, recentWindow.length - 1) * this.adaptiveStepMs,
    );

    // Enforce per-domain RPM by waiting until oldest request exits the 60s window.
    let waitForRpm = 0;
    if (domain.requestTimestamps.length >= this.requestsPerMinute) {
      const oldest = domain.requestTimestamps[0];
      waitForRpm = Math.max(0, 60_000 - (now - oldest));
    }

    const totalWait = Math.max(waitForJitter + adaptivePenalty, waitForRpm);
    if (totalWait > 0) {
      await sleep(totalWait);
    }

    const requestAt = Date.now();
    domain.lastRequestAt = requestAt;
    domain.requestTimestamps.push(requestAt);
  }

  private getOrCreateDomain(host: string): DomainState {
    const existing = this.domains.get(host);
    if (existing) {
      return existing;
    }

    const state: DomainState = {
      requestTimestamps: [],
      lastRequestAt: 0,
    };
    this.domains.set(host, state);
    return state;
  }
}
