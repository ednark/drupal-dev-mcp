import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Local query telemetry (maintainer decision 2026-11-09).
 *
 * Purpose: capture REAL agent queries and mechanical grounding outcomes so
 * corpus/index work is driven by observed failures, not by what the research
 * web happens to surface (see the 2026-11-09 pessimistic review: four runs
 * flagged "retrieval evaluation" gaps the codebase had already solved).
 *
 * Design constraints:
 * - Local-only JSONL, gitignored (data/telemetry/) — queries may contain
 *   client-proprietary content; nothing leaves the machine.
 * - Opt-out: set DRUPAL_DEV_MCP_TELEMETRY=off.
 * - Telemetry must never break a tool call: every write is best-effort and
 *   swallowed on failure.
 * - Mechanical outcome signals only (status, result count, top score,
 *   grounding density, refusal flags). Whether grounding "sufficed" is judged
 *   later by a human reading the log (error analysis), never inferred here.
 */

export interface TelemetryOptions {
  /** Default: on. Set DRUPAL_DEV_MCP_TELEMETRY=off to disable at the environment level. */
  enabled?: boolean;
  /** Default: <repoRoot>/data/telemetry/tool-calls.jsonl */
  logFile?: string;
  /** Overrides the per-process session id (tests). */
  sessionId?: string;
}

export interface TelemetryRecord {
  ts: string;
  sessionId: string;
  tool: string;
  durationMs: number;
  /** false when the handler threw (error message goes to `error`). */
  ok: boolean;
  /** Full tool input arguments — the queries ARE the signal. */
  args?: unknown;
  /** Mechanical outcome signals extracted from the tool's structuredContent. */
  outcome?: Record<string, unknown>;
  error?: string;
}

/** Rotates the log at ~10 MB so one long-lived server cannot grow it unbounded. */
const MAX_LOG_BYTES = 10 * 1024 * 1024;

/** The answer prose is kept for human error analysis, truncated to bound file size. */
const MAX_ANSWER_CHARS = 4000;

/**
 * Mechanical grounding signals from a tool result. Extracted defensively: the
 * telemetry layer must never be the reason a tool call fails.
 */
function extractOutcome(result: unknown): Record<string, unknown> {
  const structured = (result as { structuredContent?: unknown } | null | undefined)?.structuredContent;
  if (!structured || typeof structured !== 'object') return {};
  const sc = structured as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if ('status' in sc) out.status = sc.status;
  if (Array.isArray(sc.results)) {
    out.resultCount = sc.results.length;
    const scores = sc.results
      .map(item => (item as { score?: unknown } | null)?.score)
      .filter((score): score is number => typeof score === 'number');
    out.topScore = scores.length > 0 ? Math.max(...scores) : null;
    // Top hits (id/title/score) suffice to reconstruct what the agent saw;
    // snippets stay out of the log to bound size.
    out.topHits = sc.results.slice(0, 3).map(item => {
      const hit = item as { id?: unknown; title?: unknown; score?: unknown };
      return { id: hit.id, title: hit.title, score: hit.score };
    });
  }
  if ('degradedMode' in sc) out.degradedMode = sc.degradedMode;
  if ('insufficientEvidence' in sc) out.insufficientEvidence = sc.insufficientEvidence;
  if (sc.grounding && typeof sc.grounding === 'object') {
    out.groundingDensity = (sc.grounding as { groundingDensity?: unknown }).groundingDensity ?? null;
  }
  if (Array.isArray(sc.citations)) out.citationCount = sc.citations.length;
  if (Array.isArray(sc.candidates)) out.candidateCount = sc.candidates.length;
  if (Array.isArray(sc.modules)) {
    out.moduleVerdicts = (sc.modules as Array<{ name?: unknown; verdict?: unknown }>)
      .map(module => ({ name: module?.name, verdict: module?.verdict }));
  }
  if (typeof sc.answer === 'string') {
    out.answerChars = sc.answer.length;
    out.answer = sc.answer.slice(0, MAX_ANSWER_CHARS);
  }
  if (typeof sc.reason === 'string' && sc.reason) out.reason = sc.reason.slice(0, 300);
  return out;
}

export interface ToolTelemetry {
  /** Whether this telemetry instance writes at all (exposed for tests/docs). */
  readonly enabled: boolean;
  readonly sessionId: string;
  /**
   * Wraps a registerTool handler. Loose argument typing is deliberate: the
   * wrapper must not constrain the handler's inferred input types at the
   * registerTool call sites.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instrument<T extends (args: any, extra: any) => Promise<any>>(tool: string, handler: T): T;
}

export function createTelemetry(options: TelemetryOptions = {}): ToolTelemetry {
  const enabled = options.enabled ?? process.env.DRUPAL_DEV_MCP_TELEMETRY !== 'off';
  // This file lives at packages/server/{src,dist}/ — three levels up is the
  // repo root in both layouts (same idiom as src/index.ts).
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const logFile = options.logFile ?? path.join(repoRoot, 'data', 'telemetry', 'tool-calls.jsonl');
  const sessionId = options.sessionId ?? randomUUID();

  function write(record: TelemetryRecord): void {
    try {
      mkdirSync(path.dirname(logFile), { recursive: true });
      try {
        if (statSync(logFile).size >= MAX_LOG_BYTES) {
          renameSync(logFile, `${logFile}.1`);
        }
      } catch {
        // stat fails on first write — nothing to rotate.
      }
      appendFileSync(logFile, `${JSON.stringify(record)}\n`);
    } catch {
      // Telemetry must never break a tool call; a failed log write is silent.
    }
  }

  return {
    enabled,
    sessionId,
    instrument<T extends (args: any, extra: any) => Promise<any>>(tool: string, handler: T): T {
      if (!enabled) return handler;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (async (args: any, extra: any) => {
        const startedAt = Date.now();
        try {
          const result = await handler(args, extra);
          write({
            ts: new Date().toISOString(),
            sessionId,
            tool,
            durationMs: Date.now() - startedAt,
            ok: true,
            args,
            outcome: extractOutcome(result),
          });
          return result;
        } catch (error) {
          write({
            ts: new Date().toISOString(),
            sessionId,
            tool,
            durationMs: Date.now() - startedAt,
            ok: false,
            args,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }) as T;
    },
  };
}
