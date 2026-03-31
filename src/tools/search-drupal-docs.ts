import type { DatasetName, RetrievalResponse } from '../lib/retrieval.js';
import { retrieveContext } from '../lib/retrieval.js';

type Strategy = 'tiered' | 'flat';

export interface SearchDrupalDocsArgs {
  query: string;
  drupal_version?: string;
  datasets?: string[];
  top_k?: number;
  per_dataset_limit?: number;
  strategy?: Strategy;
  include_text?: boolean;
  include_metadata?: boolean;
}

const MIN_TOP_K = 1;
const MAX_TOP_K = 25;
const MIN_PER_DATASET = 1;
const MAX_PER_DATASET = 10;
const DEFAULT_TOP_K = 8;
const DEFAULT_PER_DATASET = 4;
const DEFAULT_STRATEGY: Strategy = 'tiered';
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
  name: 'search_drupal_docs',
  description: 'Raw Drupal documentation search for agents. Returns unsynthesized retrieval hits with exact excerpts and metadata.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Natural-language search query for Drupal-related documents',
      },
      drupal_version: {
        type: 'string',
        description: 'Optional Drupal version filter such as 10.x or 11.x',
      },
      datasets: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional explicit dataset allowlist',
      },
      top_k: {
        type: 'integer',
        minimum: MIN_TOP_K,
        maximum: MAX_TOP_K,
        description: 'Maximum number of hits returned after merge and filtering',
      },
      per_dataset_limit: {
        type: 'integer',
        minimum: MIN_PER_DATASET,
        maximum: MAX_PER_DATASET,
        description: 'Maximum hits to fetch from each searched dataset before merge',
      },
      strategy: {
        type: 'string',
        enum: ['tiered', 'flat'],
        description: 'Whether to preserve source-quality tiers or rank globally by relevance',
      },
      include_text: {
        type: 'boolean',
        description: 'Whether to include chunk text in the final payload',
      },
      include_metadata: {
        type: 'boolean',
        description: 'Whether to include section, file path, symbol name, and related metadata',
      },
    },
    required: ['query'],
  },
};

export async function handleSearchDrupalDocs(rawArgs: Record<string, unknown>): Promise<string> {
  const start = Date.now();

  if (!rawArgs || typeof rawArgs !== 'object') {
    throw new Error('Arguments payload must be an object.');
  }

  const args = rawArgs as Partial<SearchDrupalDocsArgs>;

  const query = (typeof args.query === 'string' ? args.query.trim() : '').replace(/\s+/g, ' ').trim();
  if (!query) {
    throw new Error('The "query" parameter is required and must be a non-empty string.');
  }

  const drupalVersion = typeof args.drupal_version === 'string' && args.drupal_version.trim().length > 0
    ? args.drupal_version.trim()
    : undefined;

  const topK = normalizeInteger(args.top_k, DEFAULT_TOP_K, MIN_TOP_K, MAX_TOP_K, 'top_k');
  const perDatasetLimit = normalizeInteger(args.per_dataset_limit, DEFAULT_PER_DATASET, MIN_PER_DATASET, MAX_PER_DATASET, 'per_dataset_limit');

  const strategy = args.strategy === 'flat' ? 'flat' : DEFAULT_STRATEGY;
  const includeText = args.include_text ?? true;
  const includeMetadata = args.include_metadata ?? true;

  const datasets = normalizeDatasets(args.datasets);

  console.error(`[search_drupal_docs] Query: "${query}"${drupalVersion ? ` (version: ${drupalVersion})` : ''}`);

  const retrievalResponse = await retrieveContext({
    query,
    drupalVersion,
    datasets,
    perDatasetLimit,
    overallLimit: topK,
    strategy,
    includeText,
  });

  const payload = formatResponse(retrievalResponse, {
    includeMetadata,
    includeText,
    limit: topK,
  });

  const topDistance = payload.hits.length > 0
    ? Math.min(...payload.hits.map(hit => hit.distance))
    : null;

  const queryHash = Buffer.from(query).toString('base64').slice(0, 12);
  const metricsLog = {
    query_hash: queryHash,
    datasets_requested: payload.datasets_requested,
    datasets_searched: payload.datasets_searched,
    total_hits_before_filter: payload.total_hits_before_filter,
    total_hits_after_filter: payload.total_hits_after_filter,
    returned_hits: payload.hits.length,
    include_text: includeText,
    include_metadata: includeMetadata,
    strategy: payload.strategy,
    top_distance: topDistance,
    latency_ms: Date.now() - start,
  };
  console.error(`[search_drupal_docs][metrics] ${JSON.stringify(metricsLog)}`);

  return JSON.stringify(payload, null, 2);
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

function normalizeDatasets(datasets: unknown): DatasetName[] | undefined {
  if (datasets === undefined || datasets === null) return undefined;
  if (!Array.isArray(datasets)) {
    throw new Error('The "datasets" parameter must be an array of strings.');
  }

  const normalized: DatasetName[] = [];
  for (const entry of datasets) {
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

interface FormatOptions {
  includeMetadata: boolean;
  includeText: boolean;
  limit: number;
}

interface RawHit {
  id: string;
  dataset: DatasetName;
  source: string;
  distance: number;
  score: number;
  rank: number;
  tier?: number;
  text?: string;
  symbol_name?: string;
  fqcn?: string;
  file_path?: string;
  drupal_version?: string;
  section?: string;
  chunk_index?: number;
};

type RawRetrievalResponse = Omit<RetrievalResponse, 'hits'> & { hits: RawHit[] };

function formatResponse(
  response: RetrievalResponse,
  options: FormatOptions,
): RawRetrievalResponse {
  const { includeMetadata, includeText, limit } = options;

  const hits: RawHit[] = response.hits
    .slice(0, limit)
    .map((hit) => {
      const base: RawHit = {
        id: hit.id,
        dataset: hit.dataset,
        source: hit.source,
        distance: hit.distance,
        score: hit.score,
        rank: hit.rank,
      };

      if (hit.tier !== undefined) {
        base.tier = hit.tier;
      }

      if (includeText) {
        base.text = hit.text;
      }

      if (includeMetadata) {
        if (hit.symbol_name !== undefined) base.symbol_name = hit.symbol_name;
        if (hit.fqcn !== undefined) base.fqcn = hit.fqcn;
        if (hit.file_path !== undefined) base.file_path = hit.file_path;
        if (hit.drupal_version !== undefined) base.drupal_version = hit.drupal_version;
        if (hit.section !== undefined) base.section = hit.section;
        if (hit.chunk_index !== undefined) base.chunk_index = hit.chunk_index;
      }

      return base;
    });

  return {
    query: response.query,
    drupal_version: response.drupal_version,
    strategy: response.strategy,
    datasets_requested: response.datasets_requested,
    datasets_searched: response.datasets_searched,
    thresholds_applied: response.thresholds_applied,
    total_hits_before_filter: response.total_hits_before_filter,
    total_hits_after_filter: response.total_hits_after_filter,
    hits,
  };
}
