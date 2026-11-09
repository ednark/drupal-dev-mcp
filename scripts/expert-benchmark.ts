/**
 * Stratified expert benchmark ("expert index") — measures ask_a_drupal_expert
 * per question category, producing attributable evidence for the human
 * decision-maker. See docs/eval/expert-benchmark-plan.md for the role:
 *
 * - This is a REPORT, not a release gate (the expert is idempotentHint:
 *   false; a gate would measure noise).
 * - Mechanical checkers only: citation resolution, refusal detection,
 *   version-statement extraction. Correctness judgment (lookup, concept
 *   traps) belongs to the human reviewer reading the committed answers.
 * - Every run carries an attribution block: index runId/builtAt, models,
 *   scaffold version, timestamp.
 *
 * Usage:
 *   npx tsx scripts/expert-benchmark.ts [--model=X] [--plan-model=Y] [--limit=N] [--dry-run]
 *
 * Requires OPENAI_API_KEY (or OPENAI_BASE_URL for a local endpoint).
 * Output: docs/eval/expert-index-results.json
 */

import { resolve } from 'node:path';
import { findRepoRoot } from '../packages/knowledge/src/index/manifest.js';
import { SqliteKnowledgeProvider } from '../packages/knowledge/src/query/provider.js';
import { DrupalAgent } from '../packages/agent/src/agent.js';
import { OpenAiLlmProvider } from '../packages/agent/src/openai-provider.js';
import type { KnowledgeProvider } from '../packages/knowledge/src/types.js';

interface ExpertCase {
  id: string;
  category: 'lookup' | 'concept-trap' | 'version-trap' | 'absence' | 'fabricated-name' | 'tool-name';
  question: string;
  drupalVersion: string;
  /** Absence/fabrication cases: a correct run refuses (insufficientEvidence or explicit unverified flag). */
  expectsRefusal?: boolean;
  /** Depth to run. */
  depth?: 'ask' | 'research';
  note: string;
}

const CASES: ExpertCase[] = [
  { id: 'lookup-cache-invalidate', category: 'lookup', question: 'How do I invalidate a custom block when its content is edited?', drupalVersion: '11.4', note: 'Expected: block-content cache tag derivation (anti-pattern 09).' },
  { id: 'lookup-hook-form', category: 'lookup', question: 'Write a hook_entity_presave implementation for module X on 11.x.', drupalVersion: '11.4', note: 'Expected: current hook form for the line (anti-pattern 02).' },
  { id: 'concept-tags-vs-contexts', category: 'concept-trap', question: 'My block changes per current node. Should I use a cache tag or a cache context?', drupalVersion: '11.4', note: 'Correct distinction required; human-judged.' },
  { id: 'concept-twig-raw', category: 'concept-trap', question: 'Render this user-submitted string with Twig.', drupalVersion: '11.4', note: 'Expected: avoid |raw; escaping rules (anti-pattern 03); human-judged.' },
  { id: 'version-canvas', category: 'version-trap', question: 'Can I use Drupal Canvas on Drupal 10.6?', drupalVersion: '10.6', note: 'Expected: version-correct statement (Canvas is ^11.3); human-judged.' },
  { id: 'version-contact', category: 'version-trap', question: 'Is the Contact module in Drupal 12.0 core?', drupalVersion: '12.0', note: 'Expected: removed (snapshot-verified); human-judged.' },
  { id: 'version-php-floor', category: 'version-trap', question: 'What PHP version does Drupal 11.4 require?', drupalVersion: '11.4', note: 'Expected: >= 8.3.0 from composer.json; beware contrib proximity (corpus-issue phpfloor).' },
  { id: 'version-upgrade-floor-12', category: 'version-trap', question: 'Can I upgrade a Drupal 10.6 site directly to Drupal 12?', drupalVersion: '12.0', note: 'Expected: no — every site must reach 11.3.0+ first (change record 3585783, placement-guidance/19); human-judged.' },
  { id: 'version-10-eol', category: 'version-trap', question: 'Is Drupal 10.6 still receiving security coverage?', drupalVersion: '10.6', note: 'Expected: security support ends 2026-12-09; the index drops the 10.6 line after that date (placement-guidance/19); human-judged.' },
  { id: 'absence-core-mcp', category: 'absence', question: 'Does Drupal core provide a built-in MCP server?', drupalVersion: '11.4', expectsRefusal: true, note: 'Correct refusal: the corpus has a contrib mcp_server but no core one.' },
  { id: 'fabricated-module', category: 'fabricated-name', question: 'Install drupal/block_cache_pro and configure it.', drupalVersion: '11.4', expectsRefusal: true, note: 'Correct refusal: fabricated project name (the researcher invented tool_api the same way).' },
  { id: 'tool-name-contract', category: 'tool-name', question: 'Which tool does the docs search?', drupalVersion: '11.4', note: 'Expected: the exact exposed tool name search_drupal (Laravel Boost naming-drift lesson).' },
];

const REFUSAL_RE = /insufficient|cannot (be )?confirm|unverified|not verifiable|no (?:such|built-in)|does not exist|unable to (?:determine|verify)/i;
const VERSION_RE = /\b(?:1[012]\.\d|8\.\d)(?:\.x)?\b/g;

function versionedNames(answer: string): string[] {
  return [...new Set(answer.match(VERSION_RE) ?? [])];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const model = args.find(a => a.startsWith('--model='))?.split('=')[1];
  const planModel = args.find(a => a.startsWith('--plan-model='))?.split('=')[1];
  const limit = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? 0);
  const dryRun = args.includes('--dry-run');
  const repoRoot = findRepoRoot(process.cwd());

  if (dryRun) {
    for (const c of limit ? CASES.slice(0, limit) : CASES) {
      process.stdout.write(`[${c.category}] ${c.id}: ${c.question} (v${c.drupalVersion}${c.expectsRefusal ? ', expects refusal' : ''})\n`);
    }
    process.stdout.write(`total: ${CASES.length} cases; dry run (no LLM calls)\n`);
    return;
  }

  const indexRoot = resolve(repoRoot, 'data/index');
  const knowledge: KnowledgeProvider = await SqliteKnowledgeProvider.open(indexRoot);
  const indexStatus = await knowledge.getIndexStatus();
  const llm = new OpenAiLlmProvider(
    process.env.OPENAI_API_KEY ?? (process.env.OPENAI_BASE_URL ? 'local-endpoint' : undefined),
    model ?? process.env.OPENAI_AGENT_MODEL ?? 'gpt-4o-mini',
  );
  const agent = new DrupalAgent({ knowledge, llm });

  const cases = limit ? CASES.slice(0, limit) : CASES;
  const results: Array<Record<string, unknown>> = [];
  let resolvedTotal = 0;
  let citationTotal = 0;

  for (const c of cases) {
    process.stdout.write(`[${c.category}] ${c.question}`);
    const response = c.depth === 'research'
      ? await agent.research(c.question, { drupalVersion: c.drupalVersion })
      : await agent.ask(c.question, { drupalVersion: c.drupalVersion });

    // Mechanical checker 1: citation resolution (every cited URI must resolve
    // to indexed text via the knowledge provider — the README's verify step).
    let resolved = 0;
    for (const citation of response.citations) {
      const resource = await knowledge.readResource(citation.resourceUri).catch(() => null);
      if (resource) resolved += 1;
    }
    citationTotal += response.citations.length;
    resolvedTotal += resolved;

    // Mechanical checker 2: refusal detection (absence/fabrication).
    const refused = response.insufficientEvidence || REFUSAL_RE.test(response.answer);

    // Mechanical checker 3: version statements (extracted for human review).
    const versions = versionedNames(response.answer);

    const refusalOk = c.expectsRefusal ? refused : undefined;
    results.push({
      id: c.id,
      category: c.category,
      question: c.question,
      drupalVersion: c.drupalVersion,
      status: response.stopReason === 'insufficient_evidence' ? 'insufficient_evidence' : 'answered',
      stopReason: response.stopReason,
      refusalDetected: refused,
      expectsRefusal: c.expectsRefusal ?? undefined,
      refusalVerdict: c.expectsRefusal ? (refused ? 'correct-refusal' : 'CONFIDENT-ANSWER') : undefined,
      citationsResolved: `${resolved}/${response.citations.length}`,
      versionsNamed: versions,
      groundingDensity: response.grounding.groundingDensity,
      usage: response.usage,
      answer: response.answer,
      note: c.note,
    });
    process.stdout.write(`  -> ${results.at(-1)!['status']}${c.expectsRefusal ? ` refusalVerdict=${results.at(-1)!['refusalVerdict']}` : ''} citations ${resolved}/${response.citations.length}`);
  }

  const perCategory: Record<string, { cases: number; citationsResolved: number; citationsTotal: number }> = {};
  for (const r of results) {
    const cat = String(r.category);
    perCategory[cat] ??= { cases: 0, citationsResolved: 0, citationsTotal: 0 };
    perCategory[cat].cases += 1;
    const [res, tot] = String(r.citationsResolved).split('/').map(Number);
    perCategory[cat].citationsResolved += res;
    perCategory[cat].citationsTotal += tot;
  }

  const report = {
    attribution: {
      indexRunId: indexStatus.runId,
      indexBuiltAt: indexStatus.builtAt,
      indexDocuments: indexStatus.counts.documents,
      model: model ?? process.env.OPENAI_AGENT_MODEL ?? 'gpt-4o-mini',
      planModel: process.env.OPENAI_AGENT_PLAN_MODEL ?? model ?? process.env.OPENAI_AGENT_MODEL ?? 'gpt-4o-mini',
      scaffold: 'drupal-dev-mcp 0.2.x',
      timestamp: new Date().toISOString(),
    },
    disclaimer: 'Factual record for human review — the project is not a decision maker. Correctness on lookup/concept-trap cases is judged by the human reviewer from the committed answers.',
    summary: {
      cases: results.length,
      citationsResolvedTotal: resolvedTotal,
      citationsTotal: citationTotal,
      perCategory,
    },
    results,
  };

  const outPath = resolve(repoRoot, 'docs/eval/expert-index-results.json');
  const fs = await import('node:fs');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`\nresults written: ${outPath}`);
  process.stdout.write(`citation resolution: ${resolvedTotal}/${citationTotal}`);
  process.stdout.write('Human review next: lookup/concept-trap correctness and refusal quality are judged from the committed answers (no LLM-as-judge).\n');
}

void main();
