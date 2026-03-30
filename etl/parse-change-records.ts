import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedPage, SourceMetadata } from './parser.js';

const SOURCE_NAME = 'change_records';

interface ChangeRecord {
  version: string;
  category: string;
  title: string;
  summary: string;
  link: string;
  drupal_version: string;
}

interface ChangeRecordsData {
  metadata?: {
    source: string;
    fetched_at: string;
    versions: string[];
  };
  changes: ChangeRecord[];
}

/**
 * Extract symbol name from change record title if it contains a function/class reference.
 * Examples:
 *   "Deprecated: Third-party settings in node_load()" → "node_load"
 *   "EntityQuery replaced node_load pattern" → "EntityQuery"
 */
function extractSymbolName(title: string): string | null {
  // Pattern 1: function_name() or method_name()
  const funcMatch = title.match(/(\w+)\(\)/);
  if (funcMatch) return funcMatch[1];

  // Pattern 2: ClassName or Namespace\ClassName
  const classMatch = title.match(/([A-Z]\w+(?:\\[A-Z]\w+)*)/);
  if (classMatch) return classMatch[1];

  // Pattern 3: specific keywords like EntityQuery, EntityTypeManager, etc.
  const entityMatch = title.match(/(Entity\w+)/);
  if (entityMatch) return entityMatch[1];

  return null;
}

/**
 * Categorize change record for better discoverability.
 * Returns a standardized category name.
 */
function categorizeRecord(record: ChangeRecord): string {
  const category = record.category.toLowerCase();

  if (category.includes('deprecat')) return 'Deprecation';
  if (category.includes('api') || category.includes('change')) return 'API Change';
  if (category.includes('feature') || category.includes('new')) return 'New Feature';
  if (category.includes('security')) return 'Security';
  if (category.includes('best')) return 'Best Practice';

  return 'General Change';
}

/**
 * Parse change records JSON file into ParsedPage objects.
 * Each change record becomes one ParsedPage chunk.
 *
 * @param sourcesDir - Path to ETL sources directory (e.g., data/sources)
 * @returns Promise<ParsedPage[]> Array of parsed change records
 */
export async function parseChangeRecords(sourcesDir: string): Promise<ParsedPage[]> {
  const inputFile = path.join(sourcesDir, 'change-records', 'change-records-by-version.json');

  let data: ChangeRecordsData;

  try {
    const content = await readFile(inputFile, 'utf-8');
    data = JSON.parse(content) as ChangeRecordsData;
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(`⚠ Change records file not found at ${inputFile} — skipping`);
      return [];
    }
    console.error(`⚠ Failed to parse change records: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  if (!data.changes || !Array.isArray(data.changes) || data.changes.length === 0) {
    console.error('⚠ No change records found in file');
    return [];
  }

  const pages: ParsedPage[] = [];

  // Group records by version for better organization
  const recordsByVersion = new Map<string, ChangeRecord[]>();
  for (const record of data.changes) {
    const version = record.drupal_version || record.version || 'all';
    if (!recordsByVersion.has(version)) {
      recordsByVersion.set(version, []);
    }
    recordsByVersion.get(version)!.push(record);
  }

  let processedCount = 0;

  // Process each version's records
  for (const [version, records] of recordsByVersion.entries()) {
    for (const record of records) {
      const category = categorizeRecord(record);
      const symbolName = extractSymbolName(record.title);

      // Build comprehensive text chunk with context
      const text = `
${record.title}

Category: ${category}
Drupal Version: ${version}

${record.summary}

Reference: ${record.link}
`;

      const section = `${category}: ${record.title}`;

      pages.push({
        text: text.trim(),
        metadata: {
          source: SOURCE_NAME,
          symbol_name: symbolName,
          fqcn: null,
          file_path: `change-records/${version}`,
          drupal_version: version,
          section,
          ingested_at: new Date().toISOString(),
        } as SourceMetadata,
      });

      processedCount += 1;
    }
  }

  console.error(`  [change-records] Parsed ${processedCount} change records across ${recordsByVersion.size} version(s)`);

  for (const [version, records] of recordsByVersion.entries()) {
    console.error(`    ${version}: ${records.length} record(s)`);
  }

  return pages;
}
