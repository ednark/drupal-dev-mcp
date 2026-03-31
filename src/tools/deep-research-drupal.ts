import type { DatasetName } from '../lib/retrieval.js';
import { runDeepResearch, ResearchDossier } from '../lib/deep-research.js';

type OutputFormat = 'json' | 'markdown';

interface DeepResearchArgs {
  question: string;
  drupal_version?: string;
  datasets?: string[];
  max_iterations?: number;
  queries_per_iteration?: number;
  initial_top_k?: number;
  followup_top_k?: number;
  max_evidence_chunks?: number;
  output_format?: OutputFormat;
  include_evidence_text?: boolean;
}

const DEFAULT_MAX_ITERATIONS = 4;
const DEFAULT_QUERIES_PER_ITERATION = 2;
const DEFAULT_INITIAL_TOP_K = 8;
const DEFAULT_FOLLOWUP_TOP_K = 5;
const DEFAULT_MAX_EVIDENCE_CHUNKS = 18;
const DEFAULT_OUTPUT_FORMAT: OutputFormat = 'json';

const MIN_ITERATIONS = 1;
const MAX_ITERATIONS = 6;
const MIN_QUERIES_PER_ITERATION = 1;
const MAX_QUERIES_PER_ITERATION = 5;
const MIN_INITIAL_TOP_K = 1;
const MAX_INITIAL_TOP_K = 15;
const MIN_FOLLOWUP_TOP_K = 1;
const MAX_FOLLOWUP_TOP_K = 10;
const MIN_EVIDENCE_CHUNKS = 5;
const MAX_EVIDENCE_CHUNKS = 40;

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

export const TOOL_DEFINITION = {
  name: 'deep_research_drupal',
  description: 'Iterative Drupal research planner. Produces implementation roadmaps and architectural guidance grounded in local documentation evidence.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      question: {
        type: 'string',
        description: 'Primary Drupal research question',
      },
      drupal_version: {
        type: 'string',
        description: 'Optional Drupal version filter such as 10.x or 11.x',
      },
      datasets: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional dataset allowlist for all research iterations',
      },
      max_iterations: {
        type: 'integer',
        minimum: MIN_ITERATIONS,
        maximum: MAX_ITERATIONS,
        description: 'Hard cap on research rounds',
      },
      queries_per_iteration: {
        type: 'integer',
        minimum: MIN_QUERIES_PER_ITERATION,
        maximum: MAX_QUERIES_PER_ITERATION,
        description: 'Maximum number of follow-up queries generated in each iteration',
      },
      initial_top_k: {
        type: 'integer',
        minimum: MIN_INITIAL_TOP_K,
        maximum: MAX_INITIAL_TOP_K,
        description: 'Maximum hits for the initial broad retrieval step',
      },
      followup_top_k: {
        type: 'integer',
        minimum: MIN_FOLLOWUP_TOP_K,
        maximum: MAX_FOLLOWUP_TOP_K,
        description: 'Maximum hits per follow-up query',
      },
      max_evidence_chunks: {
        type: 'integer',
        minimum: MIN_EVIDENCE_CHUNKS,
        maximum: MAX_EVIDENCE_CHUNKS,
        description: 'Cap on evidence stored in the final dossier',
      },
      output_format: {
        type: 'string',
        enum: ['json', 'markdown'],
        description: 'Preferred response format',
      },
      include_evidence_text: {
        type: 'boolean',
        description: 'Whether to include full chunk text excerpts in the final response',
      },
    },
    required: ['question'],
  },
};

export async function handleDeepResearchDrupal(rawArgs: Record<string, unknown>): Promise<string> {
  if (!rawArgs || typeof rawArgs !== 'object') {
    throw new Error('Arguments payload must be an object.');
  }

  const args = rawArgs as Partial<DeepResearchArgs>;

  const question = typeof args.question === 'string' ? args.question.trim() : '';
  if (!question) {
    throw new Error('The "question" parameter is required and must be a non-empty string.');
  }

  const drupalVersion = typeof args.drupal_version === 'string' && args.drupal_version.trim().length > 0
    ? args.drupal_version.trim()
    : undefined;

  const maxIterations = normalizeInteger(
    args.max_iterations,
    DEFAULT_MAX_ITERATIONS,
    MIN_ITERATIONS,
    MAX_ITERATIONS,
    'max_iterations',
  );

  const queriesPerIteration = normalizeInteger(
    args.queries_per_iteration,
    DEFAULT_QUERIES_PER_ITERATION,
    MIN_QUERIES_PER_ITERATION,
    MAX_QUERIES_PER_ITERATION,
    'queries_per_iteration',
  );

  const initialTopK = normalizeInteger(
    args.initial_top_k,
    DEFAULT_INITIAL_TOP_K,
    MIN_INITIAL_TOP_K,
    MAX_INITIAL_TOP_K,
    'initial_top_k',
  );

  const followupTopK = normalizeInteger(
    args.followup_top_k,
    DEFAULT_FOLLOWUP_TOP_K,
    MIN_FOLLOWUP_TOP_K,
    MAX_FOLLOWUP_TOP_K,
    'followup_top_k',
  );

  const maxEvidenceChunks = normalizeInteger(
    args.max_evidence_chunks,
    DEFAULT_MAX_EVIDENCE_CHUNKS,
    MIN_EVIDENCE_CHUNKS,
    MAX_EVIDENCE_CHUNKS,
    'max_evidence_chunks',
  );

  const includeEvidenceText = args.include_evidence_text ?? false;
  const datasets = normalizeDatasets(args.datasets);

  const outputFormat = normalizeOutputFormat(args.output_format);

  console.error(`[deep_research_drupal] Question: "${question}"`);

  const dossier = await runDeepResearch({
    question,
    drupalVersion,
    datasets,
    maxIterations,
    queriesPerIteration,
    initialTopK,
    followupTopK,
    maxEvidenceChunks,
    includeEvidenceText,
  });

  if (outputFormat === 'markdown') {
    return renderMarkdown(dossier, includeEvidenceText);
  }

  return JSON.stringify(dossier, null, 2);
}

function normalizeInteger(
  value: unknown,
  defaultValue: number,
  min: number,
  max: number,
  field: string,
): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`The "${field}" parameter must be an integer.`);
  }
  if (value < min || value > max) {
    throw new Error(`The "${field}" parameter must be between ${min} and ${max}.`);
  }
  return value;
}

function normalizeOutputFormat(format: unknown): OutputFormat {
  if (format === 'markdown') return 'markdown';
  return DEFAULT_OUTPUT_FORMAT;
}

function normalizeDatasets(input: unknown): DatasetName[] | undefined {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) {
    throw new Error('The "datasets" parameter must be an array of strings.');
  }

  const normalized: DatasetName[] = [];
  for (const entry of input) {
    if (typeof entry !== 'string') {
      throw new Error('Each dataset entry must be a string.');
    }
    const trimmed = entry.trim() as DatasetName;
    if (!DATASET_SET.has(trimmed)) {
      throw new Error(`Unknown dataset: ${entry}`);
    }
    if (!normalized.includes(trimmed)) {
      normalized.push(trimmed);
    }
  }

  return normalized.length > 0 ? normalized : undefined;
}

function renderMarkdown(dossier: ResearchDossier, includeEvidenceText: boolean): string {
  const { question, drupal_version, status, iterations_run, confidence } = dossier;
  const lines: string[] = [];

  lines.push(`# Deep Research Dossier`);
  lines.push('');
  lines.push(`- **Question:** ${question}`);
  if (drupal_version) {
    lines.push(`- **Drupal Version:** ${drupal_version}`);
  }
  lines.push(`- **Status:** ${status}`);
  lines.push(`- **Iterations Run:** ${iterations_run}`);
  lines.push(`- **Confidence:** ${confidence}`);
  lines.push('');

  if (dossier.summary) {
    lines.push('## Summary');
    lines.push(dossier.summary.trim());
    lines.push('');
  }

  if (dossier.recommended_approach) {
    lines.push('## Recommended Approach');
    lines.push(dossier.recommended_approach.trim());
    lines.push('');
  }

  if (dossier.architecture_direction.length > 0) {
    lines.push('## Architecture Direction');
    lines.push(...dossier.architecture_direction.map(item => `- ${item}`));
    lines.push('');
  }

  if (dossier.implementation_roadmap.length > 0) {
    lines.push('## Implementation Roadmap');
    for (const step of dossier.implementation_roadmap) {
      lines.push(`### Step ${step.step}: ${step.title}`);
      lines.push(step.rationale.trim());
      if (step.evidence_ids.length > 0) {
        lines.push('Evidence:');
        for (const id of step.evidence_ids) {
          lines.push(`- ${id}`);
        }
      }
      lines.push('');
    }
  }

  if (dossier.key_findings.length > 0) {
    lines.push('## Key Findings');
    for (const finding of dossier.key_findings) {
      lines.push(`- **Claim:** ${finding.claim}`);
      if (finding.confidence) {
        lines.push(`  - Confidence: ${finding.confidence}`);
      }
      if (finding.evidence_ids.length > 0) {
        lines.push(`  - Evidence IDs: ${finding.evidence_ids.join(', ')}`);
      }
    }
    lines.push('');
  }

  if (dossier.open_questions.length > 0) {
    lines.push('## Open Questions');
    lines.push(...dossier.open_questions.map(item => `- ${item}`));
    lines.push('');
  }

  if (dossier.contradictions.length > 0) {
    lines.push('## Contradictions or Ambiguities');
    lines.push(...dossier.contradictions.map(item => `- ${item}`));
    lines.push('');
  }

  if (dossier.recommended_next_questions.length > 0) {
    lines.push('## Recommended Next Questions');
    lines.push(...dossier.recommended_next_questions.map(item => `- ${item}`));
    lines.push('');
  }

  if (dossier.search_trace.length > 0) {
    lines.push('## Search Trace');
    for (const trace of dossier.search_trace) {
      lines.push(`- **Iteration ${trace.iteration}:**`);
      lines.push(`  - Queries: ${trace.queries.join('; ')}`);
      lines.push(`  - Datasets: ${trace.datasets.join(', ')}`);
      lines.push(`  - New Evidence: ${trace.new_evidence_ids.join(', ') || 'None'}`);
    }
    lines.push('');
  }

  if (dossier.evidence.length > 0) {
    lines.push('## Evidence Ledger');
    for (const evidence of dossier.evidence) {
      lines.push(`- **${evidence.evidence_id}** (${evidence.dataset})`);
      const details: string[] = [];
      if (evidence.symbol_name) details.push(`Symbol: ${evidence.symbol_name}`);
      if (evidence.file_path) details.push(`File: ${evidence.file_path}`);
      if (evidence.section) details.push(`Section: ${evidence.section}`);
      if (evidence.drupal_version) details.push(`Version: ${evidence.drupal_version}`);
      if (details.length > 0) {
        lines.push('  - ' + details.join(' | '));
      }
      lines.push(`  - Score: ${evidence.score.toFixed(4)} (distance ${evidence.distance.toFixed(4)})`);
      if (includeEvidenceText && evidence.excerpt) {
        lines.push('  - Excerpt:');
        lines.push('');
        lines.push('```');
        lines.push(evidence.excerpt.trim());
        lines.push('```');
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
