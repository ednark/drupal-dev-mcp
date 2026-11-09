/**
 * Correction log — Capture step of the expert-corrections loop (plan Phase 4,
 * taxonomy adopted from ai_best_practices `drupal-expert-corrections`).
 *
 * Appends one JSON object per line to data/telemetry/corrections.jsonl
 * (append-only, gitignored alongside telemetry). The upstream format is kept
 * field-for-field so corrections remain portable; `eval_seed` matches the
 * behavioral-suite rubric shape, so a correction can be promoted directly
 * into docs/eval/behavioral-upstream-style cases.
 *
 * Usage:
 *   npm run correction:log -- \
 *     --subsystem=caching \
 *     --class=SKILL_GAP \
 *     --claimed="Cache tags are invalidated synchronously" \
 *     --corrected="Invalidation is two-phase: checksum immediate, eviction lazy on next read" \
 *     --reasoning="Assumed invalidation means deletion like most cache systems" \
 *     [--confidence=0.7] [--project-id=<hash>] \
 *     [--seed-prompt="..."] [--seed-contains=a,b,c] [--seed-not-contains=x,y]
 *   npm run correction:log -- --list [--class=SKILL_GAP]
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { findRepoRoot } from '../packages/knowledge/src/index/manifest.js';
import { CORRECTION_TAXONOMY, projectIdFromRemote, validateCorrection, type CorrectionClass } from './correction-taxonomy.js';

interface Args {
  subsystem?: string;
  class_?: string;
  claimed?: string;
  corrected?: string;
  reasoning?: string;
  confidence?: string;
  projectId?: string;
  seedPrompt?: string;
  seedContains?: string;
  seedNotContains?: string;
  list?: boolean;
  listClass?: string;
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([a-z-]+)=(.*)$/s);
    if (match) {
      const camel = match[1]!.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      const key = camel === 'class' ? 'class_' : camel;
      parsed[key as keyof Args] = match[2] as never;
    } else if (arg === '--list') parsed.list = true;
  }
  return parsed;
}

function correctionsPath(): string {
  return path.join(findRepoRoot(), 'data', 'telemetry', 'corrections.jsonl');
}

function defaultProjectId(): string {
  try {
    const remote = execSync('git remote get-url origin', { cwd: findRepoRoot(), encoding: 'utf8' }).trim();
    return projectIdFromRemote(remote);
  } catch {
    return 'local';
  }
}

function list(filterClass?: string): void {
  const file = correctionsPath();
  if (!existsSync(file)) {
    process.stdout.write('No corrections logged yet (data/telemetry/corrections.jsonl).\n');
    return;
  }
  const entries = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
  const scoped = filterClass ? entries.filter(entry => entry.classification === filterClass) : entries;
  process.stdout.write(`${scoped.length}/${entries.length} correction(s)${filterClass ? ` of class ${filterClass}` : ''}:\n\n`);
  for (const entry of scoped) {
    process.stdout.write(`[${entry.timestamp}] ${entry.classification} · ${entry.subsystem} · confidence ${entry.confidence}\n`);
    process.stdout.write(`  claimed:   ${String(entry.claimed)}\n`);
    process.stdout.write(`  corrected: ${String(entry.corrected)}\n`);
    if (entry.eval_seed) process.stdout.write(`  eval_seed: promotable ✓\n`);
  }
  process.stdout.write('\nBy class: ');
  const counts = new Map<string, number>();
  for (const entry of scoped) counts.set(String(entry.classification), (counts.get(String(entry.classification)) ?? 0) + 1);
  process.stdout.write([...counts.entries()].map(([classification, count]) => `${classification}×${count}`).join(', ') + '\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    list(args.listClass);
    return;
  }

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    subsystem: args.subsystem,
    classification: args.class_,
    claimed: args.claimed,
    corrected: args.corrected,
    reasoning_failure: args.reasoning,
    confidence: args.confidence ? Number(args.confidence) : 0.5,
    project_id: args.projectId ?? defaultProjectId(),
  };
  if (args.seedPrompt) {
    entry.eval_seed = {
      prompt: args.seedPrompt,
      ...(args.seedContains ? { must_contain_any: args.seedContains.split(',').map(value => value.trim()) } : {}),
      ...(args.seedNotContains ? { must_not_contain: args.seedNotContains.split(',').map(value => value.trim()) } : {}),
    };
  }

  const error = validateCorrection(entry);
  if (error) {
    process.stderr.write(`Invalid correction: ${error}\n`);
    process.stderr.write(`Valid classes: ${Object.keys(CORRECTION_TAXONOMY).join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(path.dirname(correctionsPath()), { recursive: true });
  appendFileSync(correctionsPath(), `${JSON.stringify(entry)}\n`);
  const taxonomy = CORRECTION_TAXONOMY[entry.classification as CorrectionClass];
  process.stdout.write(`Correction logged (${entry.classification}).\n`);
  process.stdout.write(`Remediation targets (priority order):\n`);
  for (const [index, step] of taxonomy.remediation.entries()) process.stdout.write(`  ${index + 1}. ${step}\n`);
  process.stdout.write(`Verify with: the seeded eval, index:benchmark, or behavioral:eval.\n`);
}

main();
