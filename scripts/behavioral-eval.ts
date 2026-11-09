/**
 * Behavioral eval suite (plan: ai-best-practices-corpus.md Phase 3).
 *
 * Runs the vendored ai_best_practices behavioral cases (docs/eval/behavioral-upstream/)
 * against THIS index, in two layers:
 *
 * - retrieval mode (default, free, deterministic): for each case, does the
 *   index retrieve evidence supporting the rubric's must_contain_any checks?
 *   Measures corpus coverage of the behavioral surface.
 * - agent mode (--mode=agent, costs LLM calls): ask_a_drupal_expert answers
 *   each case; must_contain_any applies to the answer text. Measures whether
 *   the grounded answer carries the required guidance.
 *
 * Adaptation honesty (docs/eval/behavioral-upstream/PROVENANCE.md):
 * - must_not_contain is ADVISORY here — designed for generated code; a good
 *   grounded answer may quote the anti-pattern to warn against it.
 * - php_lint is skipped (no code artifact).
 * - This is a REPORT, not a release gate (same contract as expert-benchmark).
 *
 * Usage:
 *   npx tsx scripts/behavioral-eval.ts [--mode=retrieval|agent] [--version=11.4]
 *                                      [--bundle=<substring>] [--limit=N] [--save-baseline]
 */

import 'dotenv/config';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { findRepoRoot } from '../packages/knowledge/src/index/manifest.js';
import { SqliteKnowledgeProvider } from '../packages/knowledge/src/query/provider.js';
import { DrupalAgent } from '../packages/agent/src/agent.js';
import { OpenAiLlmProvider } from '../packages/agent/src/openai-provider.js';
import type { KnowledgeProvider } from '../packages/knowledge/src/types.js';

const BEHAVIORAL_DIR = 'docs/eval/behavioral-upstream';
const BASELINE_PATH = 'docs/eval/behavioral-baseline.json';

interface BehavioralCase {
  id: string;
  input: string;
  bundle: string;
  rubricRef: string;
  rubricId: string;
  mustContainAny: string[][];
  mustNotContain: string[];
}

interface CaseResult {
  bundle: string;
  caseId: string;
  mode: 'retrieval' | 'agent';
  passed: boolean;
  failedChecks: Array<{ rubricId: string; missingAny: string[] }>;
  advisoryHits: string[];
  evidenceUris: string[];
  note?: string;
}

function parseArgs(argv: string[]): { mode: 'retrieval' | 'agent'; version: string; bundle?: string; limit?: number; saveBaseline: boolean } {
  const parsed: ReturnType<typeof parseArgs> = { mode: 'retrieval', version: '11.4', saveBaseline: false };
  for (const arg of argv) {
    if (arg.startsWith('--mode=')) parsed.mode = arg.slice('--mode='.length) as 'retrieval' | 'agent';
    else if (arg.startsWith('--version=')) parsed.version = arg.slice('--version='.length);
    else if (arg.startsWith('--bundle=')) parsed.bundle = arg.slice('--bundle='.length);
    else if (arg.startsWith('--limit=')) parsed.limit = Number(arg.slice('--limit='.length));
    else if (arg === '--save-baseline') parsed.saveBaseline = true;
  }
  return parsed;
}

/** rubric_ref format: "rubric/<id>@<version>" */
function rubricIdFrom(ref: string): string {
  return ref.replace(/^rubric\//, '').replace(/@.*$/, '');
}

async function loadCases(filter?: string): Promise<BehavioralCase[]> {
  const root = path.join(findRepoRoot(), BEHAVIORAL_DIR);
  const cases: BehavioralCase[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.name === 'dataset.yaml') {
        const bundle = path.relative(root, path.dirname(absolute));
        if (filter && !bundle.includes(filter)) continue;
        const dataset = parseYaml(await readFile(absolute, 'utf8')) as { questions?: Array<{ id: string; input: string; bundle?: string; rubric_ref?: string }> };
        let rubrics: { rubrics?: Array<{ id: string; checks?: Array<{ kind: string; values?: string[] }> }> } = {};
        try {
          rubrics = parseYaml(await readFile(path.join(path.dirname(absolute), 'rubrics.yaml'), 'utf8')) as typeof rubrics;
        } catch { /* rubric file optional — case falls back to expectations-less pass */ }
        const rubricById = new Map((rubrics.rubrics ?? []).map(rubric => [rubric.id, rubric]));
        for (const question of dataset.questions ?? []) {
          const rubric = rubricById.get(rubricIdFrom(question.rubric_ref ?? ''));
          const mustContainAny: string[][] = [];
          const mustNotContain: string[] = [];
          for (const check of rubric?.checks ?? []) {
            if (check.kind === 'must_contain_any' && check.values?.length) mustContainAny.push(check.values);
            else if (check.kind === 'must_not_contain' && check.values?.length) mustNotContain.push(...check.values);
            // php_lint: not applicable — no code artifact (see header).
          }
          cases.push({
            id: question.id,
            input: question.input,
            bundle,
            rubricRef: question.rubric_ref ?? '',
            rubricId: rubricIdFrom(question.rubric_ref ?? ''),
            mustContainAny,
            mustNotContain,
          });
        }
      }
    }
  }
  await visit(root);
  return cases;
}

function containsAny(haystack: string, needles: string[]): boolean {
  const normalized = haystack.toLowerCase();
  return needles.some(needle => normalized.includes(needle.toLowerCase()));
}

async function runRetrieval(provider: KnowledgeProvider, testCase: BehavioralCase, version: string): Promise<CaseResult> {
  const response = await provider.search({ query: testCase.input, drupalVersion: version, mode: 'hybrid', limit: 8 });
  // Mirror the real agent flow: search returns pointers + snippets, the agent
  // fetches full documents via get_drupal_document. Evidence = snippets PLUS
  // the full text of the top results — checking snippets alone undercounts
  // (code tokens like '#cache' often sit below the snippet cut).
  const evidenceParts = response.results.map(result => `${result.title}\n${result.snippet ?? ''}`);
  const evidenceUris: string[] = [];
  for (const result of response.results) {
    const uri = result.chunkResourceUri ?? result.resourceUri;
    evidenceUris.push(uri);
    try {
      const resource = await provider.readResource(uri);
      if (resource?.text) evidenceParts.push(resource.text);
    } catch { /* unreadable resource — snippet evidence still applies */ }
  }
  const evidence = evidenceParts.join('\n');
  const failedChecks = testCase.mustContainAny
    .filter(values => !containsAny(evidence, values))
    .map(values => ({ rubricId: testCase.rubricId, missingAny: values }));
  return {
    bundle: testCase.bundle,
    caseId: testCase.id,
    mode: 'retrieval',
    passed: failedChecks.length === 0,
    failedChecks,
    advisoryHits: [],
    evidenceUris: evidenceUris.slice(0, 3),
  };
}

async function runAgent(agent: DrupalAgent, testCase: BehavioralCase): Promise<CaseResult> {
  const response = await agent.ask(testCase.input, { drupalVersion: '11.4' });
  const answer = response.answer ?? '';
  const failedChecks = testCase.mustContainAny
    .filter(values => !containsAny(answer, values))
    .map(values => ({ rubricId: testCase.rubricId, missingAny: values }));
  // Advisory: anti-pattern tokens present in the answer are EXPECTED when the
  // answer warns against them — report, never fail (see header).
  const advisoryHits = testCase.mustNotContain.filter(token => answer.toLowerCase().includes(token.toLowerCase()));
  return {
    bundle: testCase.bundle,
    caseId: testCase.id,
    mode: 'agent',
    passed: failedChecks.length === 0,
    failedChecks,
    advisoryHits,
    evidenceUris: response.citations.map(citation => citation.resourceUri),
    note: response.stopReason === 'insufficient_evidence' ? 'insufficient_evidence refusal' : undefined,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cases = (await loadCases(args.bundle)).slice(0, args.limit ?? Number.POSITIVE_INFINITY);
  if (cases.length === 0) {
    process.stdout.write('No behavioral cases matched.\n');
    return;
  }

  const provider = await SqliteKnowledgeProvider.open();
  const agent = args.mode === 'agent'
    ? new DrupalAgent({
        knowledge: provider,
        llm: new OpenAiLlmProvider(process.env.OPENAI_API_KEY ?? (process.env.OPENAI_BASE_URL ? 'local-endpoint' : undefined)),
      })
    : null;

  const results: CaseResult[] = [];
  try {
    for (const testCase of cases) {
      const result = agent ? await runAgent(agent, testCase) : await runRetrieval(provider, testCase, args.version);
      results.push(result);
      process.stdout.write(`${result.passed ? '✔' : '✖'} [${result.bundle}::${result.caseId}]${result.note ? ` (${result.note})` : ''}\n`);
    }
  } finally {
    provider.close();
  }

  const passed = results.filter(result => result.passed).length;
  const byBundle = new Map<string, { passed: number; total: number }>();
  for (const result of results) {
    const entry = byBundle.get(result.bundle) ?? { passed: 0, total: 0 };
    entry.total += 1;
    if (result.passed) entry.passed += 1;
    byBundle.set(result.bundle, entry);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    version: args.version,
    upstream: 'ai_best_practices @ 4cdb347b (docs/eval/behavioral-upstream/PROVENANCE.md)',
    totals: { passed, total: results.length, rate: Number((passed / results.length).toFixed(3)) },
    advisoryHits: results.filter(result => result.advisoryHits.length > 0).map(result => ({ bundle: result.bundle, caseId: result.caseId, hits: result.advisoryHits })),
    byBundle: Object.fromEntries([...byBundle.entries()].map(([bundle, entry]) => [bundle, { ...entry, rate: Number((entry.passed / entry.total).toFixed(3)) }])),
    cases: results,
  };

  // Baseline comparison (retrieval mode is deterministic — regression-checkable).
  if (args.mode === 'retrieval') {
    try {
      const baseline = JSON.parse(await readFile(path.join(findRepoRoot(), BASELINE_PATH), 'utf8')) as { totals: { passed: number }; cases: Array<{ bundle: string; caseId: string; passed: boolean }> };
      const baselineByKey = new Map(baseline.cases.map(c => [`${c.bundle}::${c.caseId}`, c.passed]));
      const regressions = results.filter(result => baselineByKey.get(`${result.bundle}::${result.caseId}`) === true && !result.passed);
      (report as Record<string, unknown>)['regressions'] = regressions.map(result => ({ bundle: result.bundle, caseId: result.caseId }));
      if (regressions.length > 0) process.stdout.write(`\n⚠ ${regressions.length} regression(s) vs baseline (${BASELINE_PATH})\n`);
    } catch { /* no baseline yet */ }
  }
  if (args.saveBaseline) {
    await writeFile(path.join(findRepoRoot(), BASELINE_PATH), JSON.stringify({ generatedAt: report.generatedAt, totals: report.totals, cases: results.map(({ bundle, caseId, passed }) => ({ bundle, caseId, passed })) }, null, 2));
    process.stdout.write(`Baseline saved: ${BASELINE_PATH}\n`);
  }

  process.stdout.write(`\n# Behavioral eval (${args.mode})\n`);
  process.stdout.write(`Total: ${passed}/${results.length} (${report.totals.rate})\n`);
  for (const [bundle, entry] of byBundle) {
    process.stdout.write(`  ${bundle}: ${entry.passed}/${entry.total}\n`);
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
