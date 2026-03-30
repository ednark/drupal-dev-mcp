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

/**
 * Perform vector similarity search on the drupal_core_docs table.
 */
export async function vectorSearch(
  queryVector: number[],
  nResults: number = 10,
  drupalVersion?: string,
): Promise<LanceQueryResult[]> {
  const db = await getDb();
  let tableName: string;
  // Determine which table to search. The third parameter historically was
  // overloaded to sometimes contain a table selector (e.g. 'drupal_developer_guides')
  // or a drupal version string (e.g. '11.x'). If callers pass a table name,
  // we should select that table but NOT apply a drupal_version WHERE filter.
  let applyVersionFilter = false;
  if (drupalVersion === 'developer' || drupalVersion === 'drupal_developer_guides') {
    tableName = TABLE_NAMES.developerGuides;
  } else if (drupalVersion === 'user_guide' || drupalVersion === 'drupal_user_guide') {
    tableName = TABLE_NAMES.userGuide;
  } else if (
    drupalVersion === TABLE_NAMES.developerGuides
    || drupalVersion === TABLE_NAMES.userGuide
    || drupalVersion === TABLE_NAMES.core
    || drupalVersion === TABLE_NAMES.changeRecords
    || drupalVersion === TABLE_NAMES.drupalExamples
    || drupalVersion === TABLE_NAMES.coreModuleCode
  ) {
    // Explicit well-known table name supplied; use it as-is, no version filter.
    tableName = drupalVersion;
  } else if (drupalVersion && drupalVersion.includes('_')) {
    // Any other value containing an underscore is treated as a direct table name
    // (e.g. 'api_drupal_org_docs', 'contrib_module_docs', 'contrib_module_code',
    //  'drupal_examples', 'core_module_code', 'php_docs', 'symfony_docs',
    //  'certification_docs', 'drupal_tutorials').
    // Version strings like '11.x' or 'all' never contain underscores, so this
    // heuristic is unambiguous.
    tableName = drupalVersion;
  } else {
    // Treat the param as a drupal version filter (e.g. '11.x' or 'all'), select core by default
    tableName = TABLE_NAMES.core;
    if (drupalVersion) applyVersionFilter = true;
  }
  const table = await db.openTable(tableName);
  let query = table.vectorSearch(queryVector).limit(nResults);

  // Only apply WHERE filter when the caller passed a drupal version (not a table name)
  if (applyVersionFilter && drupalVersion) {
    // Use exact match on drupal_version column
    query = query.where(`drupal_version = '${drupalVersion}'`);
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
