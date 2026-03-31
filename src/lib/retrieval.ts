import { embed } from './openai.js';
import { LanceQueryResult, vectorSearch, VectorSearchOptions } from './lancedb.js';

export type DatasetName =
  | 'drupal_core_docs'
  | 'api_drupal_org_docs'
  | 'drupal_developer_guides'
  | 'drupal_module_handbook'
  | 'contrib_module_code'
  | 'drupal_examples'
  | 'core_module_code'
  | 'change_records'
  | 'symfony_docs'
  | 'drupal_tutorials'
  | 'contrib_module_docs'
  | 'contrib_module_handbook'
  | 'drupal_best_practices'
  | 'php_docs';

export interface RetrievalOptions {
  query: string;
  drupalVersion?: string;
  datasets?: DatasetName[];
  perDatasetLimit?: number;
  overallLimit?: number;
  strategy?: 'tiered' | 'flat';
  datasetMaxDistance?: Partial<Record<DatasetName, number>>;
  includeText?: boolean;
}

export interface RetrievalHit {
  id: string;
  dataset: DatasetName;
  source: string;
  text: string;
  symbol_name: string;
  fqcn: string;
  file_path: string;
  drupal_version: string;
  section: string;
  chunk_index: number;
  distance: number;
  score: number;
  tier?: number;
  rank: number;
}

export interface RetrievalResponse {
  query: string;
  drupal_version?: string;
  strategy: 'tiered' | 'flat';
  datasets_requested: DatasetName[];
  datasets_searched: DatasetName[];
  thresholds_applied: Partial<Record<DatasetName, number>>;
  total_hits_before_filter: number;
  total_hits_after_filter: number;
  hits: RetrievalHit[];
}

type DatasetConfig = {
  name: DatasetName;
  tier: 1 | 2 | 3;
  defaultLimit: number;
  defaultMaxDistance?: number;
};

const DATASET_CONFIGS: Record<DatasetName, DatasetConfig> = {
  drupal_core_docs: {
    name: 'drupal_core_docs',
    tier: 1,
    defaultLimit: 6,
  },
  api_drupal_org_docs: {
    name: 'api_drupal_org_docs',
    tier: 1,
    defaultLimit: 6,
  },
  drupal_developer_guides: {
    name: 'drupal_developer_guides',
    tier: 1,
    defaultLimit: 6,
  },
  drupal_module_handbook: {
    name: 'drupal_module_handbook',
    tier: 1,
    defaultLimit: 6,
  },
  contrib_module_code: {
    name: 'contrib_module_code',
    tier: 1,
    defaultLimit: 6,
  },
  drupal_examples: {
    name: 'drupal_examples',
    tier: 1,
    defaultLimit: 6,
  },
  core_module_code: {
    name: 'core_module_code',
    tier: 1,
    defaultLimit: 6,
  },
  change_records: {
    name: 'change_records',
    tier: 1,
    defaultLimit: 6,
  },
  symfony_docs: {
    name: 'symfony_docs',
    tier: 2,
    defaultLimit: 3,
    defaultMaxDistance: 1.3,
  },
  drupal_tutorials: {
    name: 'drupal_tutorials',
    tier: 2,
    defaultLimit: 3,
    defaultMaxDistance: 1.3,
  },
  contrib_module_docs: {
    name: 'contrib_module_docs',
    tier: 2,
    defaultLimit: 3,
    defaultMaxDistance: 1.25,
  },
  contrib_module_handbook: {
    name: 'contrib_module_handbook',
    tier: 2,
    defaultLimit: 3,
    defaultMaxDistance: 1.25,
  },
  drupal_best_practices: {
    name: 'drupal_best_practices',
    tier: 2,
    defaultLimit: 3,
    defaultMaxDistance: 1.2,
  },
  php_docs: {
    name: 'php_docs',
    tier: 3,
    defaultLimit: 3,
    defaultMaxDistance: 1.3,
  },
};

const DEFAULT_DATASET_ORDER: DatasetName[] = [
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

const DEFAULT_STRATEGY: 'tiered' | 'flat' = 'tiered';
const DEFAULT_OVERALL_LIMIT = 12;

interface DatasetRequest {
  config: DatasetConfig;
  limit: number;
}

/**
 * Shared retrieval entry point.
 */
export async function retrieve(options: RetrievalOptions): Promise<RetrievalResponse> {
  if (!options.query || typeof options.query !== 'string') {
    throw new Error('RetrievalOptions.query is required');
  }

  const strategy = options.strategy ?? DEFAULT_STRATEGY;
  const includeText = options.includeText ?? true;
  const datasetsRequested = (options.datasets ?? DEFAULT_DATASET_ORDER).slice();

  const heuristics = classifyQuery(options.query);
  const datasetRequests = buildDatasetRequests({
    datasetsRequested,
    options,
    heuristics,
  });

  const thresholdsApplied = datasetRequests.reduce<Partial<Record<DatasetName, number>>>((acc, request) => {
    const threshold = resolveMaxDistance(request.config.name, options.datasetMaxDistance);
    if (threshold !== undefined) {
      acc[request.config.name] = threshold;
    }
    return acc;
  }, {});

  const vector = await embed(options.query);

  const searchPromises = datasetRequests.map(async ({ config, limit }) => {
    const searchOptions: VectorSearchOptions = {
      tableName: config.name,
      limit,
      drupalVersion: options.drupalVersion,
    };

    try {
      const results = await vectorSearch(vector, searchOptions);
      return results.map(result => ({
        raw: result,
        dataset: config.name,
        tier: config.tier,
      }));
    } catch (error) {
      console.error(`[retrieval] vectorSearch failed for dataset ${config.name}:`, error);
      return [] as Array<{ raw: LanceQueryResult; dataset: DatasetName; tier: number }>;
    }
  });

  const perDatasetHits = await Promise.all(searchPromises);
  const flattened = perDatasetHits.flat();
  const totalBeforeFilter = flattened.length;

  const filtered = applyThresholds(flattened, options.datasetMaxDistance);
  const deduped = deduplicateHits(filtered);

  const totalAfterFilter = deduped.length;

  const sorted = sortHits(deduped, strategy);
  const limited = applyOverallLimit(sorted, options.overallLimit ?? DEFAULT_OVERALL_LIMIT);

  const hits = limited.map((item, index) => normalizeHit(item, index, includeText));

  return {
    query: options.query,
    drupal_version: options.drupalVersion,
    strategy,
    datasets_requested: datasetsRequested,
    datasets_searched: datasetRequests.map(request => request.config.name),
    thresholds_applied: thresholdsApplied,
    total_hits_before_filter: totalBeforeFilter,
    total_hits_after_filter: totalAfterFilter,
    hits,
  };
}

/** Convenience alias for callers that expect a context-oriented helper name. */
export async function retrieveContext(options: RetrievalOptions): Promise<RetrievalResponse> {
  return retrieve(options);
}

interface ClassifiedQuery {
  isHook: boolean;
  isEntity: boolean;
  isTutorial: boolean;
}

function classifyQuery(query: string): ClassifiedQuery {
  const lower = query.toLowerCase();
  return {
    isHook: isHookRelatedQuery(lower),
    isEntity: isEntityQuery(lower),
    isTutorial: isTutorialQuery(lower),
  };
}

function isHookRelatedQuery(lowerQuery: string): boolean {
  return lowerQuery.includes('hook_') || /\bhook\b/.test(lowerQuery);
}

function isEntityQuery(lowerQuery: string): boolean {
  return (
    lowerQuery.includes('entityquery')
    || lowerQuery.includes('entity_query')
    || lowerQuery.includes('loadbyproperties')
    || lowerQuery.includes('load_by_properties')
    || lowerQuery.includes('entitytypemanager')
    || lowerQuery.includes('entity_type.manager')
    || lowerQuery.includes('entitystorageinterface')
    || /\bload\s+entit/.test(lowerQuery)
    || /\bentity\s+query\b/.test(lowerQuery)
  );
}

function isTutorialQuery(lowerQuery: string): boolean {
  return (
    lowerQuery.includes('example')
    || lowerQuery.includes('how do i')
    || lowerQuery.includes('how to')
    || lowerQuery.includes('tutorial')
    || lowerQuery.includes('step by step')
    || lowerQuery.includes('show me')
    || lowerQuery.includes('walkthrough')
    || lowerQuery.includes('getting started with')
    || lowerQuery.includes('sample code')
  );
}

interface BuildDatasetRequestArgs {
  datasetsRequested: DatasetName[];
  options: RetrievalOptions;
  heuristics: ClassifiedQuery;
}

function buildDatasetRequests({
  datasetsRequested,
  options,
  heuristics,
}: BuildDatasetRequestArgs): DatasetRequest[] {
  const explicitDatasets = options.datasets;
  let candidates = explicitDatasets ?? DEFAULT_DATASET_ORDER;

  if (!explicitDatasets && heuristics.isHook) {
    candidates = candidates.filter(dataset => dataset !== 'php_docs');
  }

  const seen = new Set<DatasetName>();
  const requests: DatasetRequest[] = [];
  for (const dataset of candidates) {
    if (seen.has(dataset)) continue;
    const config = DATASET_CONFIGS[dataset];
    if (!config) continue;
    seen.add(dataset);

    let limit = config.defaultLimit;
    if (options.perDatasetLimit !== undefined) {
      limit = Math.min(options.perDatasetLimit, limit);
    }

    if (heuristics.isEntity && dataset === 'api_drupal_org_docs') {
      limit = Math.max(limit, 8);
    }

    if (heuristics.isTutorial && dataset === 'drupal_tutorials') {
      limit = Math.max(limit, 5);
    }

    requests.push({ config, limit });
  }

  if (!explicitDatasets && heuristics.isHook) {
    console.error('[retrieval] Hook-related query detected — php_docs dataset suppressed');
  }

  if (!explicitDatasets && heuristics.isEntity) {
    console.error('[retrieval] Entity-related query detected — boosting api_drupal_org_docs limit');
  }

  if (!explicitDatasets && heuristics.isTutorial) {
    console.error('[retrieval] Tutorial-related query detected — boosting drupal_tutorials limit');
  }

  return requests;
}

function resolveMaxDistance(
  dataset: DatasetName,
  overrides?: Partial<Record<DatasetName, number>>,
): number | undefined {
  if (overrides && overrides[dataset] !== undefined) {
    return overrides[dataset];
  }
  return DATASET_CONFIGS[dataset]?.defaultMaxDistance;
}

type IntermediateHit = {
  raw: LanceQueryResult;
  dataset: DatasetName;
  tier: number;
};

function applyThresholds(
  hits: IntermediateHit[],
  overrides?: Partial<Record<DatasetName, number>>,
): IntermediateHit[] {
  return hits.filter((hit) => {
    const threshold = resolveMaxDistance(hit.dataset, overrides);
    if (threshold === undefined) return true;
    return hit.raw._distance <= threshold;
  });
}

function deduplicateHits(hits: IntermediateHit[]): IntermediateHit[] {
  const primaryMap = new Map<string, IntermediateHit>();
  const fallbackIndex = new Map<string, string>();

  for (const hit of hits) {
    const raw = hit.raw;
    const primaryKey = `${hit.dataset}:${raw.id}`;
    const fallbackKey = raw.file_path ? `${hit.dataset}:${raw.file_path}:${raw.chunk_index ?? ''}` : undefined;

    const existingPrimary = primaryMap.get(primaryKey)
      ?? (fallbackKey ? primaryMap.get(fallbackIndex.get(fallbackKey) ?? '') : undefined);

    if (existingPrimary) {
      if (raw._distance < existingPrimary.raw._distance) {
        primaryMap.set(primaryKey, hit);
        if (fallbackKey) fallbackIndex.set(fallbackKey, primaryKey);
      }
      continue;
    }

    primaryMap.set(primaryKey, hit);
    if (fallbackKey) fallbackIndex.set(fallbackKey, primaryKey);
  }

  return Array.from(primaryMap.values());
}

function sortHits(hits: IntermediateHit[], strategy: 'tiered' | 'flat'): IntermediateHit[] {
  const sorted = [...hits];
  if (strategy === 'flat') {
    sorted.sort((a, b) => a.raw._distance - b.raw._distance);
    return sorted;
  }

  sorted.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.raw._distance - b.raw._distance;
  });

  return sorted;
}

function applyOverallLimit(hits: IntermediateHit[], overallLimit: number): IntermediateHit[] {
  if (overallLimit <= 0) return hits;
  return hits.slice(0, overallLimit);
}

function normalizeHit(hit: IntermediateHit, index: number, includeText: boolean): RetrievalHit {
  const raw = hit.raw;
  const distance = raw._distance;
  const score = 1 / (1 + distance);

  return {
    id: raw.id,
    dataset: hit.dataset,
    source: raw.source,
    text: includeText ? raw.text : '',
    symbol_name: raw.symbol_name,
    fqcn: raw.fqcn,
    file_path: raw.file_path,
    drupal_version: raw.drupal_version,
    section: raw.section,
    chunk_index: raw.chunk_index,
    distance,
    score,
    tier: hit.tier,
    rank: index + 1,
  };
}
