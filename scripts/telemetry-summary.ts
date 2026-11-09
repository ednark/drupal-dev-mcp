/**
 * Telemetry summary — surfaces grounding-failure candidates from real agent
 * queries (data/telemetry/tool-calls.jsonl) for human error analysis.
 *
 * This is the Hamel-style step the 2026-11-09 review identified as missing:
 * log real queries, then hand-review the failures until a pattern emerges;
 * codify the pattern as a corpus doc, index change, or eval case.
 *
 * Mechanical failure proxies only — a row here is a *candidate*, not a
 * verdict. Read the full JSONL record (and replay the query) before judging.
 *
 * Usage:
 *   npx tsx scripts/telemetry-summary.ts [--file=PATH] [--days=N] [--json]
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../packages/knowledge/src/index/manifest.js';
import { CORRECTION_TAXONOMY, suggestClassification } from './correction-taxonomy.js';

interface TelemetryRecord {
  ts: string;
  sessionId: string;
  tool: string;
  durationMs: number;
  ok: boolean;
  args?: Record<string, unknown>;
  outcome?: Record<string, unknown>;
  error?: string;
}

interface FailureCandidate {
  ts: string;
  tool: string;
  reason: string;
  query: string;
}

function parseArgs(argv: string[]): { file?: string; days?: number; json?: boolean } {
  const parsed: { file?: string; days?: number; json?: boolean } = {};
  for (const arg of argv) {
    if (arg.startsWith('--file=')) parsed.file = arg.slice('--file='.length);
    else if (arg.startsWith('--days=')) parsed.days = Number(arg.slice('--days='.length));
    else if (arg === '--json') parsed.json = true;
  }
  return parsed;
}

function defaultLogFile(): string {
  return `${findRepoRoot()}/data/telemetry/tool-calls.jsonl`;
}

function normalizedQuery(args: Record<string, unknown> | undefined): string {
  const raw = args?.query ?? args?.question ?? '';
  return String(raw).toLowerCase().trim();
}

const CORRECTIONS_RELPATH = 'data/telemetry/corrections.jsonl';

interface CorrectionEntry {
  timestamp: string;
  subsystem?: string;
  classification: string;
  claimed?: string;
  corrected?: string;
  confidence?: number;
  eval_seed?: unknown;
}

function loadCorrections(): CorrectionEntry[] {
  const file = path.join(findRepoRoot(), CORRECTIONS_RELPATH);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as CorrectionEntry);
}

/** One mechanical proxy per tool; thresholds are deliberately conservative. */
function failureReason(record: TelemetryRecord): string | null {
  if (!record.ok) return `handler error: ${record.error ?? 'unknown'}`;
  const outcome = record.outcome ?? {};
  switch (record.tool) {
    case 'search_drupal':
      if (outcome.resultCount === 0) return 'zero results';
      if (typeof outcome.topScore === 'number' && outcome.topScore < 0.4) return `weak top score ${outcome.topScore.toFixed(2)}`;
      if (outcome.degradedMode) return `degraded mode: ${String(outcome.degradedMode)}`;
      return null;
    case 'get_drupal_entity':
      if (outcome.status === 'not_found' || outcome.status === 'ambiguous') return `entity ${String(outcome.status)}`;
      return null;
    case 'get_drupal_entities':
      return null; // per-item statuses are in the payload; low-signal alone
    case 'get_drupal_document':
      if (outcome.status === 'not_found') return 'document not_found (stale or fabricated citation?)';
      return null;
    case 'verify_drupal_modules': {
      const verdicts = (outcome.moduleVerdicts as Array<{ verdict?: string }> | undefined) ?? [];
      if (verdicts.some(module => module.verdict === 'not_found')) return 'module name not_found (fabricated or unindexed)';
      return null;
    }
    case 'ask_a_drupal_expert':
      if (outcome.status === 'insufficient_evidence') return 'insufficient_evidence refusal';
      if (outcome.status === 'error' || outcome.status === 'unavailable') return `status ${String(outcome.status)}`;
      if (outcome.citationCount === 0) return 'answered with zero citations';
      if (typeof outcome.groundingDensity === 'number' && outcome.groundingDensity < 0.5) return `low grounding density ${outcome.groundingDensity.toFixed(2)}`;
      return null;
    default:
      return null;
  }
}

function main(): void {
  const { file, days, json } = parseArgs(process.argv.slice(2));
  const logFile = file ?? defaultLogFile();

  if (!existsSync(logFile)) {
    console.log(`No telemetry file at ${logFile} — nothing recorded yet (or telemetry disabled via DRUPAL_DEV_MCP_TELEMETRY=off).`);
    return;
  }

  const records: TelemetryRecord[] = readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as TelemetryRecord);

  const cutoff = days
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const scoped = cutoff ? records.filter(record => record.ts >= cutoff) : records;

  if (scoped.length === 0) {
    console.log(`Telemetry file ${logFile} has ${records.length} record(s) but none in the requested window.`);
    return;
  }

  const byTool = new Map<string, number>();
  const byVersion = new Map<string, number>();
  for (const record of scoped) {
    byTool.set(record.tool, (byTool.get(record.tool) ?? 0) + 1);
    const version = String(record.args?.drupal_version ?? 'unknown');
    byVersion.set(version, (byVersion.get(version) ?? 0) + 1);
  }

  const failures: FailureCandidate[] = [];
  for (const record of scoped) {
    const reason = failureReason(record);
    if (reason) {
      failures.push({
        ts: record.ts,
        tool: record.tool,
        reason,
        query: normalizedQuery(record.args).slice(0, 160),
      });
    }
  }

  const queryCounts = new Map<string, { count: number; tools: Set<string>; lastTs: string }>();
  for (const record of scoped) {
    const query = normalizedQuery(record.args);
    if (!query) continue;
    const entry = queryCounts.get(query) ?? { count: 0, tools: new Set<string>(), lastTs: record.ts };
    entry.count += 1;
    entry.tools.add(record.tool);
    entry.lastTs = record.ts;
    queryCounts.set(query, entry);
  }
  const repeated = [...queryCounts.entries()]
    .filter(([, entry]) => entry.count >= 2)
    .sort((a, b) => b[1].count - a[1].count);

  const sizeMb = statSync(logFile).size / (1024 * 1024);
  const range: [string, string] = [scoped[0]!.ts, scoped[scoped.length - 1]!.ts];

  if (json) {
    console.log(JSON.stringify({
      logFile,
      sizeMb: Number(sizeMb.toFixed(2)),
      range,
      totalCalls: scoped.length,
      byTool: Object.fromEntries(byTool),
      byVersion: Object.fromEntries(byVersion),
      failures,
      repeatedQueries: repeated.map(([query, entry]) => ({ query, count: entry.count, tools: [...entry.tools], lastTs: entry.lastTs })),
    }, null, 2));
    return;
  }

  const lines: string[] = [];
  lines.push('# Telemetry summary');
  lines.push('');
  lines.push(`- Log: \`${logFile}\` (${sizeMb.toFixed(2)} MB)`);
  lines.push(`- Window: ${range[0]} → ${range[1]} (${scoped.length} calls)`);
  lines.push(`- Tools: ${[...byTool.entries()].map(([tool, count]) => `${tool}×${count}`).join(', ')}`);
  lines.push(`- Drupal versions: ${[...byVersion.entries()].map(([version, count]) => `${version}×${count}`).join(', ')}`);
  lines.push('');
  lines.push(`## Failure candidates (${failures.length})`);
  lines.push('');
  lines.push('Mechanical proxies only — read the full JSONL record and replay the query before judging. Repeated failures on the same query are the strongest corpus-gap signal.');
  lines.push('');
  if (failures.length === 0) {
    lines.push('None observed in this window.');
  } else {
    lines.push('Suggested classification uses the correction taxonomy (scripts/correction-taxonomy.ts) — confirm by hand, then log with `npm run correction:log`.');
    lines.push('');
    for (const failure of failures) {
      const suggested = suggestClassification(failure.reason);
      lines.push(`- \`${failure.ts}\` **${failure.tool}** — ${failure.reason} — query: \`${failure.query}\` → suggested: **${suggested}**`);
    }
    lines.push('');
    lines.push('Taxonomy: ' + Object.values(CORRECTION_TAXONOMY).map(entry => `${entry.id} (${entry.failureSource.toLowerCase()})`).join(' · '));
  }
  lines.push('');
  lines.push(`## Repeated queries (${repeated.length})`);
  lines.push('');
  lines.push('Candidate eval questions: anything asked repeatedly deserves a stable answer and, if it failed once, a benchmark case.');
  lines.push('');
  if (repeated.length === 0) {
    lines.push('None observed in this window.');
  } else {
    for (const [query, entry] of repeated.slice(0, 25)) {
      lines.push(`- ×${entry.count} [${[...entry.tools].join(', ')}] \`${query}\``);
    }
  }
  lines.push('');
  console.log(lines.join('\n'));

  // Corrections section (Capture loop, plan Phase 4): aggregates the
  // correction log so repeat offenders surface as eval-promotion candidates.
  const corrections = loadCorrections();
  if (corrections.length > 0) {
    const byClass = new Map<string, number>();
    const bySubsystem = new Map<string, number>();
    const promotable: CorrectionEntry[] = [];
    for (const correction of corrections) {
      byClass.set(correction.classification, (byClass.get(correction.classification) ?? 0) + 1);
      if (correction.subsystem) bySubsystem.set(correction.subsystem, (bySubsystem.get(correction.subsystem) ?? 0) + 1);
      if (correction.eval_seed) promotable.push(correction);
    }
    const repeatSubsystems = [...bySubsystem.entries()].filter(([, count]) => count >= 2);
    console.log('');
    console.log(`## Corrections (${corrections.length} logged — ${CORRECTIONS_RELPATH})`);
    console.log('');
    console.log(`By class: ${[...byClass.entries()].map(([classification, count]) => `${classification}×${count}`).join(', ')}`);
    if (repeatSubsystems.length > 0) {
      console.log(`Repeat subsystems (promotion candidates — same subsystem corrected ≥2×): ${repeatSubsystems.map(([subsystem, count]) => `${subsystem}×${count}`).join(', ')}`);
    }
    if (promotable.length > 0) {
      console.log(`${promotable.length} correction(s) carry eval_seed — promotable into behavioral cases (docs/eval/behavioral-upstream format).`);
    }
    console.log('Full log with remediation targets: npx tsx scripts/correction-log.ts --list');
  }
}

main();
