import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { KnowledgeProvider } from '../types.js';

/**
 * Retrieval-quality gate.
 *
 * Design (2026-10-29 revision — replaces the any-term-in-top-5-blob gate,
 * which could not fail: it stayed 28/28 through a corpus change that stripped
 * 7.6MB of navigation chrome, and stayed green while 75% of one source was
 * menu junk):
 *
 * - Rank-aware: a case passes only when a result satisfying its expected
 *   terms appears in the TOP 3. Best rank and MRR are reported per run.
 * - Majority terms: single-term cases require that term; multi-term cases
 *   require at least 2 of the expected terms in the same result.
 * - Per-result matching: terms must co-occur in ONE result (title + snippet
 *   + repositoryPath), not scattered across the top-5 blob.
 * - Chrome invariant: no result anywhere in the run may contain known
 *   page-chrome markers; the ingestion failure mode that produced them
 *   (Jina full-page renders stored raw) must never re-enter the corpus
 *   unnoticed.
 * - Negative terms: cases may declare `expectAbsent` terms that must not
 *   appear in any top-5 result.
 * - Baseline regression mode: `--save-baseline` stores per-case results;
 *   later runs fail on any previously-passing case that regresses, even
 *   when the global ratio holds. Corpus surgeries break retrieval per-case,
 *   not per-ratio.
 */

export interface BenchmarkCase {
  question: string;
  expected: string[];
  /** Terms that must NOT appear in any top-5 result. */
  expectAbsent?: string[];
  /** Search overrides (e.g. sourceTypes for guidance-corpus routing). */
  sourceTypes?: string[];
}

export const BENCHMARK_CASES: BenchmarkCase[] = [
  { question: 'create Views display taxonomy terms exposed filters', expected: ['views', 'taxonomy', 'filter'] },
  { question: 'programmatically create a view and add a field', expected: ['view', 'field'] },
  { question: 'create a custom block plugin BlockBase build', expected: ['blockbase', 'block'] },
  { question: 'block visibility custom condition blockAccess', expected: ['blockaccess', 'condition'] },
  { question: 'custom field type custom formatter FieldType FieldFormatter', expected: ['fieldtype', 'fieldformatter'] },
  { question: 'baseFieldDefinitions BaseFieldDefinition content entity', expected: ['basefielddefinition', 'basefielddefinitions'] },
  { question: 'Node create field values save entity API', expected: ['node', 'create', 'save'] },
  { question: 'entity view builder render view mode', expected: ['viewbuilder'] },
  { question: 'taxonomy term storage loadTree vocabulary', expected: ['loadtree', 'termstorage'] },
  { question: 'taxonomy term reference field entity_reference', expected: ['entity_reference', 'taxonomy'] },
  { question: 'Twig template suggestion node bundle content type', expected: ['twig', 'suggestion'] },
  { question: 'attach CSS library libraries.yml render array', expected: ['libraries.yml', '#attached', 'library'] },
  { question: 'FormBase buildForm validateForm submitForm', expected: ['formbase', 'validateform', 'submitform'] },
  { question: 'form AJAX callback AjaxResponse ReplaceCommand', expected: ['ajaxresponse', 'replacecommand', '#ajax'] },
  { question: 'custom text filter plugin FilterBase process', expected: ['filterbase', 'filter'] },
  { question: 'configuration schema custom module schema.yml typed config', expected: ['typedconfig', 'schema'] },
  { question: 'custom content entity ContentEntityBase ContentEntityType', expected: ['contententitybase', 'contententitytype'] },
  { question: 'hook_entity_presave modify entity before saving', expected: ['hook_entity_presave', 'presave'] },
  { question: 'custom service services.yml dependency injection controller', expected: ['services.yml', 'containerinjectioninterface', 'dependency injection'] },
  { question: 'Drupal Database API select fields execute fetchAll', expected: ['select', 'database', 'fetchall'] },
  // Human-phrased cases promoted from the community-question audit
  // (docs/eval/human-questions-audit.md): real community phrasings with
  // unambiguous ground truth, verified to pass in lexical mode. The audit's
  // hybrid-only winners were deliberately left out — this gate runs lexical.
  { question: 'How do I create custom regions in a theme?', expected: ['infoyml'] },
  { question: 'How can I fix these "Cannot autowire service" errors?', expected: ['autowiring', 'service_container'] },
  { question: 'Permanent Cache Bin and Memcache', expected: ['memcache'] },
  { question: 'Custom exception subscriber does not handle PHP errors', expected: ['exceptionsubscriber'] },
  { question: 'webform email handler does not allow certain roles in to field', expected: ['emailwebformhandler'] },
  // Contract-retrieval cases: machine-readable definitions (SDC components,
  // config schema) must surface alongside their prose documentation. Added
  // with milestone-1 structured YAML contract extraction.
  { question: 'single directory components theming sdc', expected: ['single-directory'] },
  { question: 'define sdc component.yml metadata', expected: ['component.yml'] },
  { question: 'component yml slots required props documentation', expected: ['slots'] },
  // Curated-corpus cases (2026-10-29): the guidance corpora, security
  // advisories, and full-text change records must be reachable by the
  // queries agents actually issue.
  { question: 'Twig raw filter security fix escaping bypass', expected: ['anti-patterns', 'raw'] },
  { question: 'phpcs Drupal coding standards DrupalPractice sniffs', expected: ['phpcs', 'drupalpractice'] },
  { question: 'phpstan deprecation rules drupal extension baseline', expected: ['phpstan', 'deprecation'] },
  { question: 'drupal canvas requirements version 11.3', expected: ['canvas'] },
  { question: 'mcp server for drupal stdio http transports', expected: ['mcp server'] },
  { question: 'SA-CORE-2026-014', expected: ['sa-core-2026-014'] },
  { question: 'security advisory remote code execution field ui', expected: ['sa-core'] },
  { question: 'object oriented hook implementations autowired services ModuleHandler deprecated', expected: ['autowired', 'modulehandler'] },
  { question: 'batch api queue long running form submit', expected: ['batch'] },
  { question: 'service locator instead of dependency injection class', expected: ['service locator'] },
  { question: 'where do preprocess hooks live module or theme', expected: ['preprocess'], sourceTypes: ['guidance'] },
  { question: 'how do I get the currently logged in user account', expected: ['current-user', 'account'], sourceTypes: ['guidance'] },
  // Negative case: pure marketing/navigation vocabulary must not surface
  // record bodies — the chrome-ingestion failure mode, as a test.
  {
    question: 'drupal for ecommerce fintech healthcare industries',
    expected: ['drupal'],
    expectAbsent: ['change record status', 'security advisory id', 'skip to main content'],
  },
] as const;

/** Known page-chrome markers — see scripts/curate-chrome.ts. */
const CHROME_MARKERS = [
  'skip to main content',
  'markdown content:',
  'yes, please no, do not track me',
  'can we use first and third party cookies',
] as const;

const PASS_RANK = 3;
const TOP_K = 5;

export interface BenchmarkCaseResult {
  question: string;
  passed: boolean;
  /** Rank (1-based) of the best result satisfying the expected terms; null when none in top K. */
  rank: number | null;
  matched: string[];
  results: Array<{ title: string; uri: string }>;
  /** Set when a negative term appeared or the chrome invariant fired for this case. */
  violation?: string;
}

export interface BenchmarkBaseline {
  savedAt: string;
  version: string;
  cases: Array<{ question: string; passed: boolean; rank: number | null }>;
}

export interface BenchmarkResult {
  passed: number;
  total: number;
  releaseGate: boolean;
  /** Mean reciprocal rank over cases with a top-K hit. */
  mrr: number | null;
  /** Cases that passed in the stored baseline but fail now. */
  regressions: Array<{ question: string; baselineRank: number | null }>;
  baseline?: { path: string; savedAt: string } | { path: string; missing: true };
  chromeViolations: number;
  cases: BenchmarkCaseResult[];
}

interface Search_like_Result {
  title: string;
  snippet?: string;
  repositoryPath?: string;
  resourceUri: string;
}

function resultCorpus(result: Search_like_Result): string {
  return `${result.title}\n${result.snippet ?? ''}\n${result.repositoryPath ?? ''}`.toLowerCase();
}

function requiredTerms(expected: string[]): number {
  return expected.length === 1 ? 1 : 2;
}

function evaluateCase(benchmark: BenchmarkCase, results: Search_like_Result[]): BenchmarkCaseResult {
  let rank: number | null = null;
  let matched: string[] = [];
  let violation: string | undefined;

  results.forEach((result, index) => {
    const corpus = resultCorpus(result);
    const hit = benchmark.expected.filter(term => corpus.includes(term.toLowerCase()));
    if (hit.length >= requiredTerms(benchmark.expected) && rank === null) {
      rank = index + 1;
      matched = hit;
    }
  });

  if (benchmark.expectAbsent?.length) {
    for (const term of benchmark.expectAbsent) {
      if (results.some(result => resultCorpus(result).includes(term.toLowerCase()))) {
        violation = `negative term surfaced: "${term}"`;
        break;
      }
    }
  }
  for (const marker of CHROME_MARKERS) {
    if (results.some(result => resultCorpus(result).includes(marker))) {
      violation = `chrome marker in results: "${marker}"`;
      break;
    }
  }

  return {
    question: benchmark.question,
    passed: rank !== null && rank <= PASS_RANK && !violation,
    rank,
    matched,
    results: results.map(result => ({ title: result.title, uri: result.resourceUri })),
    violation,
  };
}

function readBaseline(baselinePath: string): BenchmarkBaseline | null {
  if (!existsSync(baselinePath)) return null;
  try {
    return JSON.parse(readFileSync(baselinePath, 'utf8')) as BenchmarkBaseline;
  } catch {
    return null;
  }
}

export async function runBenchmark(
  provider: KnowledgeProvider,
  version = '11.4',
  options: { baselinePath?: string; saveBaseline?: boolean } = {},
) {
  const cases: BenchmarkCaseResult[] = [];
  let chromeViolations = 0;

  for (const benchmark of BENCHMARK_CASES) {
    const response = await provider.search({
      query: benchmark.question,
      drupalVersion: version,
      mode: 'lexical',
      limit: TOP_K,
      sourceTypes: benchmark.sourceTypes,
    });
    const result = evaluateCase(benchmark, response.results as Search_like_Result[]);
    if (result.violation?.startsWith('chrome marker')) chromeViolations += 1;
    cases.push(result);
  }

  const passed = cases.filter(result => result.passed).length;
  const ranks = cases.map(result => result.rank).filter((rank): rank is number => rank !== null);
  const mrr = ranks.length ? ranks.reduce((sum, rank) => sum + 1 / rank, 0) / cases.length : null;

  // Baseline regression mode: pass previously-green cases must stay green.
  const regressions: BenchmarkResult['regressions'] = [];
  let baseline: BenchmarkResult['baseline'];
  if (options.baselinePath) {
    const stored = readBaseline(options.baselinePath);
    if (stored && !options.saveBaseline) {
      baseline = { path: options.baselinePath, savedAt: stored.savedAt };
      const baselineByQuestion = new Map(stored.cases.map(item => [item.question, item]));
      for (const result of cases) {
        const previous = baselineByQuestion.get(result.question);
        if (previous?.passed && !result.passed) {
          regressions.push({ question: result.question, baselineRank: previous.rank });
        }
      }
    }
    if (options.saveBaseline) {
      mkdirSync(path.dirname(options.baselinePath), { recursive: true });
      const payload: BenchmarkBaseline = {
        savedAt: new Date().toISOString(),
        version,
        cases: cases.map(result => ({ question: result.question, passed: result.passed, rank: result.rank })),
      };
      writeFileSync(options.baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      baseline = { path: options.baselinePath, savedAt: payload.savedAt };
    }
  }

  const ratioGate = passed >= Math.ceil(cases.length * 0.8);
  const releaseGate = ratioGate && regressions.length === 0 && chromeViolations === 0;
  return { passed, total: cases.length, releaseGate, mrr, regressions, baseline, chromeViolations, cases };
}
