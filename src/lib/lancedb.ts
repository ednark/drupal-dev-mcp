import * as lancedb from '@lancedb/lancedb';
import { validateConfig } from '../config.js';

export const TABLE_NAMES = {
  core: 'drupal_core_docs',
  developerGuides: 'drupal_developer_guides',
  changeRecords: 'change_records',
  drupalExamples: 'drupal_examples',
  coreModuleCode: 'core_module_code',
  contribModuleHandbook: 'contrib_module_handbook',
  drupalModuleHandbook: 'drupal_module_handbook',
  apiDrupalOrg: 'api_drupal_org_docs',
  contribModuleCode: 'contrib_module_code',
  symfonyDocs: 'symfony_docs',
  drupalTutorials: 'drupal_tutorials',
  contribModuleDocs: 'contrib_module_docs',
  drupalBestPractices: 'drupal_best_practices',
  drupalSkills: 'drupal_skills',
  phpDocs: 'php_docs',
  certificationDocs: 'certification_docs',
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
  } else if (legacySelector === 'user_guide') {
    tableName = TABLE_NAMES.core; // user guide content is merged into core_docs
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

// ---------------------------------------------------------------------------
// DB readiness helpers
// ---------------------------------------------------------------------------

/** Tables that must exist and have rows for the DB to be considered ready */
export const REQUIRED_TABLES = [TABLE_NAMES.core, TABLE_NAMES.developerGuides] as const;

/**
 * Thrown when a tool attempts to query the vector DB before it has been
 * initialized.  The message instructs the caller to run the bootstrap tool.
 */
export class DbNotReadyError extends Error {
  override name = 'DbNotReadyError';

  constructor() {
    super(
      'The Drupal documentation database has not been initialized. No required LanceDB tables were found.\n\n'
      + 'To initialize, either:\n'
      + '  1. Run from CLI: npm run etl\n'
      + '  2. Call the initialize_drupal_docs MCP tool with confirm=true\n',
    );
  }
}

/**
 * Snapshot of the current DB state returned by {@link checkDbReady}.
 */
export interface DbStatus {
  /** True when every required table is present and non-empty. */
  ready: boolean;
  /** Names of required tables that were found and non-empty. */
  tablesFound: string[];
  /** Names of required tables that were absent or empty. */
  tablesMissing: string[];
  /** Sum of all table row counts. */
  totalRows: number;
  /** Per-table row counts for detailed reporting. */
  tableCounts: Record<string, number>;
}

/**
 * Inspect the on-disk LanceDB to determine whether it is ready for queries.
 *
 * A DB is considered ready when ALL tables in {@link REQUIRED_TABLES}
 * exist and contain at least one row.
 *
 * Safe to call at any time – any connection / IO failure returns
 * `{ ready: false, tablesFound: [], tablesMissing: [...all], totalRows: 0, tableCounts: {} }`.
 */
export async function checkDbReady(dbPath?: string): Promise<DbStatus> {
  const allTableValues = Object.values(TABLE_NAMES);
  const requiredTableNames = REQUIRED_TABLES as readonly string[];
  const emptyStatus: DbStatus = {
    ready: false,
    tablesFound: [],
    tablesMissing: [...requiredTableNames],
    totalRows: 0,
    tableCounts: {},
  };

  try {
    const db = await getDb(dbPath);
    const existingNames: string[] = await db.tableNames();
    const existingSet = new Set(existingNames);

    const tableCounts: Record<string, number> = {};
    const tablesFound: string[] = [];
    const tablesMissing: string[] = [];

    for (const tableName of allTableValues) {
      if (!existingSet.has(tableName)) {
        if (requiredTableNames.includes(tableName)) {
          tablesMissing.push(tableName);
        }
        continue;
      }
      try {
        const tbl = await db.openTable(tableName);
        const count = await tbl.countRows();
        tableCounts[tableName] = count;
        if (requiredTableNames.includes(tableName)) {
          if (count > 0) {
            tablesFound.push(tableName);
          } else {
            tablesMissing.push(tableName);
          }
        }
      } catch {
        if (requiredTableNames.includes(tableName)) {
          tablesMissing.push(tableName);
        }
      }
    }

    const totalRows = Object.values(tableCounts).reduce((sum, n) => sum + n, 0);

    // The DB is ready when ALL required tables exist and have rows.
    const ready = tablesMissing.length === 0 && tablesFound.length === requiredTableNames.length;

    return { ready, tablesFound, tablesMissing, totalRows, tableCounts };
  } catch {
    return emptyStatus;
  }
}

/**
 * Cached result of the last {@link refreshDbStatus} call.
 * `null` means the status has never been checked in this process.
 */
let _cachedStatus: DbStatus | null = null;

/**
 * Zero-cost synchronous check – safe to call on every hot-path request.
 * Returns `false` until {@link refreshDbStatus} has been awaited at least once.
 */
export function isDbReady(): boolean {
  return _cachedStatus?.ready ?? false;
}

/**
 * Perform a full readiness check, update the in-process cache, and return
 * the detailed {@link DbStatus}.  Call this once at server startup and after
 * any ETL run.
 */
export async function refreshDbStatus(): Promise<DbStatus> {
  const status = await checkDbReady();
  _cachedStatus = status;
  return status;
}

/**
 * Return the last cached {@link DbStatus}, or `null` if never checked.
 */
export function getCachedStatus(): DbStatus | null {
  return _cachedStatus;
}
