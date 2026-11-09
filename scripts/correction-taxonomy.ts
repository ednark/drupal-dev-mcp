/**
 * Failure taxonomy for expert corrections — adopted from
 * `ai_best_practices` skill `drupal-expert-corrections` (upstream commit
 * 4cdb347b, GPL-2.0+; plan Phase 4, plans/active/ai-best-practices-corpus.md).
 *
 * Adapted to THIS stack: their "patch the skill" remediation becomes our
 * concrete targets (corpus doc, eval case, mechanical checker, index change).
 * The classification applies at human error-analysis time — telemetry's
 * mechanical signals are candidates, the human confirms the class.
 *
 * Capture loop (their Capture/Classify/Remediate/Verify, mapped):
 *   Capture  → npm run correction:log (data/telemetry/corrections.jsonl)
 *   Classify → taxonomy below (suggestions shown in telemetry-summary)
 *   Remediate→ targets per class (table below)
 *   Verify   → re-run the eval the correction seeded, or index:benchmark /
 *              behavioral:eval / expert-benchmark
 */

export type CorrectionClass =
  | 'SKILL_GAP'
  | 'SKILL_STALE'
  | 'EVAL_GAP'
  | 'HOOK_CANDIDATE'
  | 'CONFABULATION'
  | 'ASSUMPTION_ERROR';

export interface TaxonomyEntry {
  id: CorrectionClass;
  /** Failure source, verbatim definition from upstream. */
  failureSource: string;
  upstreamExample: string;
  /** Our-stack remediation target(s), in priority order (upstream's order: prevent recurrence first). */
  remediation: string[];
  /** Mechanical telemetry reasons that usually point at this class (suggestions only). */
  telemetrySignals: string[];
}

export const CORRECTION_TAXONOMY: Record<CorrectionClass, TaxonomyEntry> = {
  SKILL_GAP: {
    id: 'SKILL_GAP',
    failureSource: 'Guidance missing from the corpus',
    upstreamExample: 'No skill covers cache tag invalidation model',
    remediation: [
      'Corpus doc: placement-guidance / anti-patterns / concept-bridge entry (ledger `coverage-gap` row first)',
      'Eval case seeded from the correction (behavioral or expert-benchmark)',
    ],
    telemetrySignals: ['zero results', 'weak top score', 'document not_found'],
  },
  SKILL_STALE: {
    id: 'SKILL_STALE',
    failureSource: 'Corpus has outdated info',
    upstreamExample: 'Skill still recommends a superseded migration pattern after the core API changed',
    remediation: [
      'Corpus doc update + corpus-issues ledger version-notes date-stamp',
      'index:freshness sweep for the affected source; version-scoping check (placement-guidance/19 rule)',
      'Eval case asserting the CURRENT pattern',
    ],
    telemetrySignals: ['document not_found (stale citation)', 'entity not_found on a renamed API'],
  },
  EVAL_GAP: {
    id: 'EVAL_GAP',
    failureSource: 'No eval catches this error',
    upstreamExample: 'Agent writes Drupal 7-style code and nothing flags it',
    remediation: [
      'Eval case in the suite that SHOULD have caught it (expert-benchmark / behavioral)',
      'Refusal-path case if the correct behavior is insufficient_evidence',
    ],
    telemetrySignals: ['answered with zero citations', 'low grounding density', 'insufficient_evidence refusal on a covered topic'],
  },
  HOOK_CANDIDATE: {
    id: 'HOOK_CANDIDATE',
    failureSource: 'Deterministic rule not enforced',
    upstreamExample: 'A PHPCS violation should be caught by a hook',
    remediation: [
      'Mechanical checker: contract test (guidance-contract style), verify_drupal_modules extension, audit-skills rule',
      'Validator-corpus entry if the rule belongs in the agent fix loop (drupal-validation-tooling)',
    ],
    telemetrySignals: ['module name not_found (fabricated or unindexed)', 'repeated identical query failing identically'],
  },
  CONFABULATION: {
    id: 'CONFABULATION',
    failureSource: 'Model invented plausible details',
    upstreamExample: 'Agent uses \\Drupal::entityManager() instead of \\Drupal::entityTypeManager()',
    remediation: [
      'verify_drupal_modules / entity-resolution coverage for the fabricated name class',
      'Eval case in the fabricated-name / absence category (expectsRefusal)',
      'Anti-pattern doc ONLY if a canonical correction exists and recurrence is shown',
    ],
    telemetrySignals: ['entity not_found', 'module name not_found'],
  },
  ASSUMPTION_ERROR: {
    id: 'ASSUMPTION_ERROR',
    failureSource: 'Correct facts, wrong inference',
    upstreamExample: 'Agent knows the right service but uses \\Drupal::service() inside a controller instead of constructor DI',
    remediation: [
      'Concept-bridge or anti-pattern doc stating the decision rule (facts are present; the RULE is missing)',
      'Eval case in the concept-trap category (human-judged)',
    ],
    telemetrySignals: ['weak top score on a conceptual query', 'insufficient_evidence refusal on a covered topic'],
  },
};

/** Suggests a classification for a mechanical telemetry failure reason. Suggestions only. */
export function suggestClassification(reason: string): CorrectionClass {
  const lowered = reason.toLowerCase();
  if (lowered.includes('fabricated') || lowered.includes('entity not_found')) return 'CONFABULATION';
  if (lowered.includes('stale citation')) return 'SKILL_STALE';
  if (lowered.includes('zero results') || lowered.includes('weak top score') || lowered.includes('degraded mode')) return 'SKILL_GAP';
  if (lowered.includes('zero citations') || lowered.includes('grounding density') || lowered.includes('refusal')) return 'EVAL_GAP';
  return 'SKILL_GAP';
}

/** Portable project hash (upstream spec: derived from the git remote). */
export function projectIdFromRemote(remoteUrl: string): string {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(remoteUrl.trim()).digest('hex').slice(0, 12);
}

/** Validates a correction's loggable shape (their correction-log format). */
export function validateCorrection(entry: Record<string, unknown>): string | null {
  if (!Object.keys(CORRECTION_TAXONOMY).includes(String(entry.classification))) {
    return `classification must be one of: ${Object.keys(CORRECTION_TAXONOMY).join(', ')}`;
  }
  for (const field of ['claimed', 'corrected', 'classification', 'subsystem']) {
    if (!entry[field] || !String(entry[field]).trim()) return `missing required field: ${field}`;
  }
  const confidence = Number(entry.confidence ?? 0.5);
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) return 'confidence must be within [0, 1]';
  return null;
}
