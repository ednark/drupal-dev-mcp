import * as lancedb from '@lancedb/lancedb';
import { validateConfig } from '../config.js';

export const TABLE_NAMES = {
  core: 'drupal_core_docs',
  userGuide: 'drupal_user_guide',
  developerGuides: 'drupal_developer_guides',
  changeRecords: 'change_records',
  drupalExamples: 'drupal_examples',
  coreModuleCode: 'core_module_code',
  contribModuleHandbook: 'contrib_module_handbook',
  drupalModuleHandbook: 'drupal_module_handbook',
} as const;

export interface LanceQueryResult {
  id: string;
  text: string;
  vector: number[];
  source: string;
  symbol_name: string;
  fqcn: string;
  file_path: string;
  drupal_version: string;
  section: string;
  chunk_index: number;
  ingested_at: string;
  _distance: number;
}

export interface VectorSearchOptions {
  tableName: string;
  limit?: number;
  drupalVersion?: string;
}

let dbInstance: lancedb.Connection | null = null;

/**
 * Open (or return cached) LanceDB connection.
 */
export async function getDb(dbPath?: string): Promise<lancedb.Connection> {
  if (!dbInstance) {
    const path = dbPath ?? validateConfig().lancedbPath;
    dbInstance = await lancedb.connect(path);
  }
  return dbInstance;
}

const DEFAULT_VECTOR_LIMIT = 10;

function resolveLegacyOptions(
  limit: number | undefined,
  legacySelector?: string,
): VectorSearchOptions {
  let tableName: string = TABLE_NAMES.core;
  let drupalVersion: string | undefined;

  if (!legacySelector) {
    return { tableName, limit };
  }

  if (legacySelector === 'developer' || legacySelector === TABLE_NAMES.developerGuides) {
    tableName = TABLE_NAMES.developerGuides;
  } else if (legacySelector === 'user_guide' || legacySelector === TABLE_NAMES.userGuide) {
    tableName = TABLE_NAMES.userGuide;
  } else if (
    legacySelector === TABLE_NAMES.core
    || legacySelector === TABLE_NAMES.changeRecords
    || legacySelector === TABLE_NAMES.drupalExamples
    || legacySelector === TABLE_NAMES.coreModuleCode
    || legacySelector === TABLE_NAMES.contribModuleHandbook
    || legacySelector === TABLE_NAMES.drupalModuleHandbook
  ) {
    tableName = legacySelector;
  } else if (legacySelector.includes('_')) {
    tableName = legacySelector;
  } else {
    tableName = TABLE_NAMES.core;
    drupalVersion = legacySelector;
  }

  return { tableName, limit, drupalVersion };
}

/**
 * Perform vector similarity search with explicit options.
 * Supports legacy positional parameters for backwards compatibility.
 */
export async function vectorSearch(
  queryVector: number[],
  optionsOrLimit: VectorSearchOptions | number = DEFAULT_VECTOR_LIMIT,
  legacySelector?: string,
): Promise<LanceQueryResult[]> {
  const db = await getDb();

  let options: VectorSearchOptions;
  if (typeof optionsOrLimit === 'number' || optionsOrLimit === undefined) {
    const limitValue = typeof optionsOrLimit === 'number' ? optionsOrLimit : DEFAULT_VECTOR_LIMIT;
    options = resolveLegacyOptions(limitValue, legacySelector);
  } else {
    options = { ...optionsOrLimit };
  }

  const tableName: string = options.tableName ?? TABLE_NAMES.core;
  const limit = options.limit ?? DEFAULT_VECTOR_LIMIT;
  const table = await db.openTable(tableName);
  let query = table.vectorSearch(queryVector).limit(limit);

  if (options.drupalVersion) {
    query = query.where(`drupal_version = '${options.drupalVersion}'`);
  }

  const results = await query.toArray();
  return results as unknown as LanceQueryResult[];
}

/**
 * Reset the cached DB connection (useful for testing).
 */
export function resetDb(): void {
  dbInstance = null;
}
