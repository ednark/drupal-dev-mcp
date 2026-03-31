import { chat } from './openai.js';
import {
  retrieve,
  DatasetName,
  RetrievalHit,
  RetrievalOptions,
  RetrievalResponse,
} from './retrieval.js';

export type ResearchConfidence = 'low' | 'medium' | 'high';

export interface DeepResearchOptions {
  question: string;
  drupalVersion?: string;
  datasets?: DatasetName[];
  maxIterations: number;
  queriesPerIteration: number;
  initialTopK: number;
  followupTopK: number;
  maxEvidenceChunks: number;
  includeEvidenceText: boolean;
}

export interface ResearchIterationTrace {
  iteration: number;
  queries: string[];
  datasets: DatasetName[];
  new_evidence_ids: string[];
}

export interface ResearchFinding {
  claim: string;
  evidence_ids: string[];
  confidence?: ResearchConfidence;
}

export interface DossierEvidence {
  evidence_id: string;
  dataset: DatasetName;
  symbol_name?: string;
  fqcn?: string;
  file_path?: string;
  section?: string;
  drupal_version?: string;
  distance: number;
  score: number;
  excerpt?: string;
}

export interface ResearchDossier {
  question: string;
  drupal_version?: string;
  status: 'complete' | 'partial';
  iterations_run: number;
  confidence: ResearchConfidence;
  summary: string;
  recommended_approach: string;
  architecture_direction: string[];
  key_findings: ResearchFinding[];
  implementation_roadmap: Array<{
    step: number;
    title: string;
    rationale: string;
    evidence_ids: string[];
  }>;
  open_questions: string[];
  contradictions: string[];
  search_trace: ResearchIterationTrace[];
  evidence: DossierEvidence[];
  recommended_next_questions: string[];
}

interface EvidenceEntry {
  evidenceId: string;
  hit: RetrievalHit;
  addedAtIteration: number;
}

interface ResearchState {
  question: string;
  drupalVersion?: string;
  iteration: number;
  searchTrace: ResearchIterationTrace[];
  evidenceMap: Map<string, EvidenceEntry>;
  openQuestions: string[];
  findings: ResearchFinding[];
  contradictions: string[];
  consecutiveLowYieldIterations: number;
  datasetHints?: DatasetName[];
}

interface InitialPlannerOutput {
  framing_summary: string;
  sub_questions: string[];
  initial_followup_queries: string[];
  dataset_hints: string[];
  initial_findings: ResearchFinding[];
  open_questions: string[];
}

interface IterationPlannerOutput {
  continue_research: boolean;
  followup_queries: string[];
  dataset_hints?: string[];
  updated_open_questions: string[];
  updated_findings: ResearchFinding[];
  contradictions: string[];
  notes?: string;
}

interface DossierPlannerOutput {
  status: 'complete' | 'partial';
  iterations_run: number;
  confidence: ResearchConfidence;
  summary: string;
  recommended_approach: string;
  architecture_direction: string[];
  key_findings: ResearchFinding[];
  implementation_roadmap: Array<{
    step: number;
    title: string;
    rationale: string;
    evidence_ids: string[];
  }>;
  open_questions: string[];
  contradictions: string[];
  recommended_next_questions: string[];
}

const DATASET_ALLOWLIST: DatasetName[] = [
  'drupal_core_docs',
  'api_drupal_org_docs',
  'drupal_developer_guides',
  'drupal_module_handbook',
  'contrib_module_code',
  'drupal_examples',
  'core_module_code',
  'change_records',
  'symfony_docs',
  'drupal_tutorials',
  'contrib_module_docs',
  'contrib_module_handbook',
  'drupal_best_practices',
  'php_docs',
];

const DATASET_SET = new Set<DatasetName>(DATASET_ALLOWLIST);

const DEFAULT_RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL ?? 'gpt-4o';

const MAX_EVIDENCE_EXCERPT_LENGTH = 700;
const EVIDENCE_DIGEST_LIMIT = 12;

export async function runDeepResearch(options: DeepResearchOptions): Promise<ResearchDossier> {
  validateOptions(options);

  const state: ResearchState = {
    question: options.question,
    drupalVersion: options.drupalVersion,
    iteration: 0,
    searchTrace: [],
    evidenceMap: new Map(),
    openQuestions: [],
    findings: [],
    contradictions: [],
    consecutiveLowYieldIterations: 0,
  };

  console.error('[deep_research] Phase 1: Initial retrieval');
  const initialRetrieval = await performRetrieval({
    query: options.question,
    drupalVersion: options.drupalVersion,
    datasets: options.datasets,
    perDatasetLimit: undefined,
    overallLimit: options.initialTopK,
    includeText: true,
    strategy: 'tiered',
  });

  const initialEvidenceIds = absorbEvidence(state, initialRetrieval.hits, 0, options.maxEvidenceChunks);
  recordTrace(state, {
    iteration: 0,
    queries: [options.question],
    datasets: uniqueDatasets(initialRetrieval.hits),
    new_evidence_ids: initialEvidenceIds,
  });

  console.error('[deep_research] Phase 2: Initial planning prompt');
  const initialPlan = await callInitialPlanner(state, initialRetrieval, options.includeEvidenceText);

  state.openQuestions = dedupeStrings(initialPlan.open_questions);
  state.findings = normalizeFindings(initialPlan.initial_findings, state);
  state.datasetHints = filterDatasets(initialPlan.dataset_hints);

  let pendingQueries = initialPlan.initial_followup_queries.slice(0, options.queriesPerIteration);

  while (state.iteration < options.maxIterations) {
    const nextIteration = state.iteration + 1;
    console.error(`[deep_research] Iteration ${nextIteration}: planning`);

    let iterationPlan: IterationPlannerOutput;
    if (pendingQueries.length > 0 && state.iteration === 0) {
      // Use initial planner follow-ups for the first iteration without another LLM call.
      iterationPlan = {
        continue_research: true,
        followup_queries: pendingQueries,
        dataset_hints: state.datasetHints,
        updated_open_questions: state.openQuestions,
        updated_findings: state.findings,
        contradictions: state.contradictions,
      };
      pendingQueries = [];
    } else {
      iterationPlan = await callIterationPlanner(state, options.includeEvidenceText);
    }

    const followupQueries = iterationPlan.followup_queries.slice(0, options.queriesPerIteration).filter(q => q && q.trim().length > 0);

    if (!iterationPlan.continue_research || followupQueries.length === 0) {
      console.error(`[deep_research] Stop condition met before iteration ${nextIteration}: continue_research=${iterationPlan.continue_research}, followups=${followupQueries.length}`);
      break;
    }

    const datasetHints = filterDatasets(iterationPlan.dataset_hints ?? state.datasetHints ?? []);
    if (datasetHints.length > 0) {
      state.datasetHints = datasetHints;
    }

    console.error(`[deep_research] Iteration ${nextIteration}: executing ${followupQueries.length} follow-up query(ies)`);
    const iterationHits: RetrievalHit[] = [];
    const newEvidenceIds: string[] = [];
    const datasetsTouched = new Set<DatasetName>();

    for (const query of followupQueries) {
      const retrievalResponse = await performRetrieval({
        query,
        drupalVersion: options.drupalVersion,
        datasets: datasetHints.length > 0 ? datasetHints : options.datasets,
        perDatasetLimit: Math.min(4, options.followupTopK),
        overallLimit: options.followupTopK,
        includeText: true,
        strategy: 'flat',
      });

      retrievalResponse.hits.forEach(hit => datasetsTouched.add(hit.dataset));
      iterationHits.push(...retrievalResponse.hits);

      const added = absorbEvidence(state, retrievalResponse.hits, nextIteration, options.maxEvidenceChunks);
      newEvidenceIds.push(...added);
    }

    recordTrace(state, {
      iteration: nextIteration,
      queries: followupQueries,
      datasets: Array.from(datasetsTouched),
      new_evidence_ids: Array.from(new Set(newEvidenceIds)),
    });

    state.iteration = nextIteration;
    state.openQuestions = dedupeStrings(iterationPlan.updated_open_questions);
    state.findings = normalizeFindings(iterationPlan.updated_findings, state);
    state.contradictions = dedupeStrings(iterationPlan.contradictions);

    if (newEvidenceIds.length === 0) {
      state.consecutiveLowYieldIterations += 1;
    } else {
      state.consecutiveLowYieldIterations = 0;
    }

    if (state.consecutiveLowYieldIterations >= 2) {
      console.error('[deep_research] Stop condition: two consecutive low-yield iterations');
      break;
    }

    if (state.evidenceMap.size >= options.maxEvidenceChunks) {
      console.error('[deep_research] Stop condition: evidence budget exhausted');
      break;
    }

    if (!iterationPlan.continue_research) {
      console.error('[deep_research] Stop condition: planner requested stop');
      break;
    }
  }

  console.error('[deep_research] Phase 3: Final dossier synthesis');
  const dossier = await callDossierPlanner(state, options);
  const finalEvidence = buildFinalEvidenceList(state, options.includeEvidenceText);
  const filteredRoadmap = normalizeRoadmap(dossier.implementation_roadmap, state);
  const filteredKeyFindings = normalizeFindings(dossier.key_findings, state);
  return {
    ...dossier,
    question: state.question,
    drupal_version: state.drupalVersion,
    search_trace: state.searchTrace,
    evidence: finalEvidence,
    implementation_roadmap: filteredRoadmap,
    key_findings: filteredKeyFindings,
    open_questions: dedupeStrings(dossier.open_questions),
    contradictions: dedupeStrings(dossier.contradictions),
    recommended_next_questions: dedupeStrings(dossier.recommended_next_questions),
  };
}

function validateOptions(options: DeepResearchOptions): void {
  if (!options.question || typeof options.question !== 'string') {
    throw new Error('DeepResearchOptions.question is required');
  }
  if (options.maxIterations <= 0) {
    throw new Error('DeepResearchOptions.maxIterations must be positive');
  }
  if (options.queriesPerIteration <= 0) {
    throw new Error('DeepResearchOptions.queriesPerIteration must be positive');
  }
  if (options.initialTopK <= 0) {
    throw new Error('DeepResearchOptions.initialTopK must be positive');
  }
  if (options.followupTopK <= 0) {
    throw new Error('DeepResearchOptions.followupTopK must be positive');
  }
  if (options.maxEvidenceChunks <= 0) {
    throw new Error('DeepResearchOptions.maxEvidenceChunks must be positive');
  }
}

async function performRetrieval(args: {
  query: string;
  drupalVersion?: string;
  datasets?: DatasetName[];
  perDatasetLimit?: number;
  overallLimit: number;
  includeText: boolean;
  strategy: RetrievalOptions['strategy'];
}): Promise<RetrievalResponse> {
  const { query, drupalVersion, datasets, perDatasetLimit, overallLimit, includeText, strategy } = args;
  const retrievalOptions: RetrievalOptions = {
    query,
    drupalVersion,
    datasets,
    perDatasetLimit,
    overallLimit,
    includeText,
    strategy,
  };

  return retrieve(retrievalOptions);
}

function absorbEvidence(
  state: ResearchState,
  hits: RetrievalHit[],
  iteration: number,
  maxEvidenceChunks: number,
): string[] {
  const newIds: string[] = [];

  for (const hit of hits) {
    const evidenceId = computeEvidenceId(hit);
    const existing = state.evidenceMap.get(evidenceId);
    if (!existing) {
      state.evidenceMap.set(evidenceId, { evidenceId, hit, addedAtIteration: iteration });
      newIds.push(evidenceId);
    } else if (hit.distance < existing.hit.distance) {
      state.evidenceMap.set(evidenceId, { evidenceId, hit, addedAtIteration: existing.addedAtIteration });
    }
  }

  if (state.evidenceMap.size > maxEvidenceChunks) {
    const sorted = Array.from(state.evidenceMap.values()).sort((a, b) => b.hit.score - a.hit.score);
    const keep = sorted.slice(0, maxEvidenceChunks);
    const keepSet = new Set(keep.map(entry => entry.evidenceId));
    for (const key of state.evidenceMap.keys()) {
      if (!keepSet.has(key)) {
        state.evidenceMap.delete(key);
      }
    }
  }

  return newIds;
}

function computeEvidenceId(hit: RetrievalHit): string {
  if (hit.id) {
    return `${hit.dataset}:${hit.id}`;
  }
  const fileComponent = hit.file_path ?? 'unknown';
  const chunkComponent = hit.chunk_index ?? 0;
  return `${hit.dataset}:${fileComponent}:${chunkComponent}`;
}

function recordTrace(state: ResearchState, trace: ResearchIterationTrace): void {
  state.searchTrace.push({
    iteration: trace.iteration,
    queries: trace.queries,
    datasets: trace.datasets,
    new_evidence_ids: trace.new_evidence_ids,
  });
}

function uniqueDatasets(hits: RetrievalHit[]): DatasetName[] {
  return Array.from(new Set(hits.map(hit => hit.dataset)));
}

async function callInitialPlanner(
  state: ResearchState,
  retrieval: RetrievalResponse,
  includeEvidenceText: boolean,
): Promise<InitialPlannerOutput> {
  const systemPrompt = `You are Deep Research Planner, an expert Drupal technical strategist.
Use only the provided retrieval evidence to plan further research.
Respond with strict JSON matching the required schema.
Do not invent Drupal APIs or modules that are not present in the evidence.
Recommend narrow, high-signal follow-up queries optimized for planning guidance, not conversational answers.`;

  const evidenceDigest = buildEvidenceDigest(state, includeEvidenceText);
  const userPayload = {
    question: state.question,
    drupal_version: state.drupalVersion ?? null,
    initial_retrieval: {
      total_hits: retrieval.hits.length,
      evidence: evidenceDigest,
    },
    instructions: {
      required_fields: [
        'framing_summary',
        'sub_questions',
        'initial_followup_queries',
        'dataset_hints',
        'initial_findings',
        'open_questions',
      ],
      query_limits: {
        max_queries: 'Respect the provided queries_per_iteration limit',
      },
    },
  };

  const userMessage = JSON.stringify(userPayload, null, 2);

  return callJsonModel<InitialPlannerOutput>(systemPrompt, userMessage);
}

async function callIterationPlanner(
  state: ResearchState,
  includeEvidenceText: boolean,
): Promise<IterationPlannerOutput> {
  const systemPrompt = `You are Deep Research Planner, coordinating Drupal research iterations.
Use ONLY the provided evidence ledger and trace.
Return strict JSON with keys: continue_research (boolean), followup_queries (array of strings), dataset_hints (array of dataset identifiers or empty), updated_open_questions (array of strings), updated_findings (array of objects with claim and evidence_ids), contradictions (array of strings), optional notes.
Follow-up queries must be specific and reference Drupal components seen in evidence.`;

  const userPayload = {
    question: state.question,
    drupal_version: state.drupalVersion ?? null,
    current_iteration: state.iteration,
    open_questions: state.openQuestions,
    findings: state.findings,
    contradictions: state.contradictions,
    evidence_ledger: buildEvidenceDigest(state, includeEvidenceText),
    search_trace: state.searchTrace,
  };

  const userMessage = JSON.stringify(userPayload, null, 2);

  return callJsonModel<IterationPlannerOutput>(systemPrompt, userMessage);
}

async function callDossierPlanner(
  state: ResearchState,
  options: DeepResearchOptions,
): Promise<DossierPlannerOutput> {
  const systemPrompt = `You are Deep Research Planner, producing the final planning dossier for Drupal implementation work.
Use ONLY the provided evidence ledger, findings, open questions, contradictions, and search trace.
Respond with strict JSON using the schema:
{
  "status": "complete" | "partial",
  "iterations_run": number,
  "confidence": "low" | "medium" | "high",
  "summary": string,
  "recommended_approach": string,
  "architecture_direction": string[],
  "key_findings": [{"claim": string, "evidence_ids": string[], "confidence"?: "low"|"medium"|"high"}],
  "implementation_roadmap": [{"step": number, "title": string, "rationale": string, "evidence_ids": string[]}],
  "open_questions": string[],
  "contradictions": string[],
  "recommended_next_questions": string[]
}
Do not cite any evidence ids that are not listed in the evidence ledger.
Plan for future implementation; do not provide raw code or conversational answers.`;

  const userPayload = {
    question: state.question,
    drupal_version: state.drupalVersion ?? null,
    iterations_run: state.iteration,
    findings: state.findings,
    open_questions: state.openQuestions,
    contradictions: state.contradictions,
    evidence_ledger: buildEvidenceDigest(state, options.includeEvidenceText),
    search_trace: state.searchTrace,
  };

  const userMessage = JSON.stringify(userPayload, null, 2);

  return callJsonModel<DossierPlannerOutput>(systemPrompt, userMessage);
}

async function callJsonModel<T>(systemPrompt: string, userMessage: string, retry = true): Promise<T> {
  const firstResponse = await chat(systemPrompt, userMessage, DEFAULT_RESEARCH_MODEL);
  const parsedFirst = safeParseJson<T>(firstResponse);
  if (parsedFirst.success) {
    return parsedFirst.value;
  }

  if (!retry) {
    throw new Error(`Failed to parse planner response as JSON: ${parsedFirst.error}`);
  }

  const retryMessage = `${userMessage}

Important: Respond with STRICT JSON only. No prose.`;
  const retryResponse = await chat(systemPrompt, retryMessage, DEFAULT_RESEARCH_MODEL);
  const parsedRetry = safeParseJson<T>(retryResponse);
  if (parsedRetry.success) {
    return parsedRetry.value;
  }

  throw new Error(`Failed to parse planner response after retry: ${parsedRetry.error}`);
}

function safeParseJson<T>(input: string): { success: true; value: T } | { success: false; error: string } {
  try {
    const trimmed = input.trim();
    const jsonStart = trimmed.indexOf('{');
    const jsonEnd = trimmed.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return { success: false, error: 'No JSON object detected' };
    }
    const jsonText = trimmed.slice(jsonStart, jsonEnd + 1);
    return { success: true, value: JSON.parse(jsonText) as T };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function buildEvidenceDigest(state: ResearchState, includeText: boolean): Array<Record<string, unknown>> {
  const evidenceEntries = getTopEvidenceEntries(state, EVIDENCE_DIGEST_LIMIT);
  return evidenceEntries.map(entry => {
    const hit = entry.hit;
    const excerpt = includeText && hit.text ? truncate(hit.text, MAX_EVIDENCE_EXCERPT_LENGTH) : undefined;
    return {
      evidence_id: entry.evidenceId,
      dataset: hit.dataset,
      label: hit.symbol_name ?? hit.section ?? hit.file_path ?? 'Unknown',
      distance: hit.distance,
      score: hit.score,
      symbol_name: hit.symbol_name ?? null,
      fqcn: hit.fqcn ?? null,
      file_path: hit.file_path ?? null,
      drupal_version: hit.drupal_version ?? null,
      section: hit.section ?? null,
      excerpt: excerpt ?? null,
    };
  });
}

function getTopEvidenceEntries(state: ResearchState, limit: number): EvidenceEntry[] {
  return Array.from(state.evidenceMap.values())
    .sort((a, b) => b.hit.score - a.hit.score)
    .slice(0, limit);
}

function buildFinalEvidenceList(state: ResearchState, includeText: boolean): DossierEvidence[] {
  return getTopEvidenceEntries(state, state.evidenceMap.size).map(entry => {
    const hit = entry.hit;
    return {
      evidence_id: entry.evidenceId,
      dataset: hit.dataset,
      symbol_name: hit.symbol_name,
      fqcn: hit.fqcn,
      file_path: hit.file_path,
      section: hit.section,
      drupal_version: hit.drupal_version,
      distance: hit.distance,
      score: hit.score,
      excerpt: includeText ? hit.text : undefined,
    };
  });
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function filterDatasets(names: string[] | undefined): DatasetName[] {
  if (!names) return [];
  const normalized: DatasetName[] = [];
  for (const name of names) {
    const trimmed = name.trim() as DatasetName;
    if (DATASET_SET.has(trimmed) && !normalized.includes(trimmed)) {
      normalized.push(trimmed);
    }
  }
  return normalized;
}

function dedupeStrings(values: string[] | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

function normalizeFindings(findings: ResearchFinding[] | undefined, state: ResearchState): ResearchFinding[] {
  if (!findings) return [];
  const validIds = new Set(state.evidenceMap.keys());
  return findings
    .map(finding => {
      const evidenceIds = (finding.evidence_ids ?? []).filter(id => validIds.has(id));
      if (evidenceIds.length === 0) return null;
      const normalized: ResearchFinding = {
        claim: finding.claim,
        evidence_ids: evidenceIds,
      };
      if (finding.confidence) {
        normalized.confidence = finding.confidence;
      }
      return normalized;
    })
    .filter((item): item is ResearchFinding => item !== null);
}

function normalizeRoadmap(
  roadmap: ResearchDossier['implementation_roadmap'] | undefined,
  state: ResearchState,
): ResearchDossier['implementation_roadmap'] {
  if (!roadmap) return [];
  const validIds = new Set(state.evidenceMap.keys());
  return roadmap
    .map(item => {
      const evidenceIds = (item.evidence_ids ?? []).filter(id => validIds.has(id));
      return {
        step: item.step,
        title: item.title,
        rationale: item.rationale,
        evidence_ids: evidenceIds,
      };
    })
    .filter(item => item.rationale.trim().length > 0 || item.evidence_ids.length > 0);
}
