import { access, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as cheerio from 'cheerio';

const require = createRequire(import.meta.url);
type SqliteDatabase = {
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[];
  };
  close: () => void;
};

const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (filename: string, options?: { readonly?: boolean }) => SqliteDatabase;
};

// ── Shared Types ───────────────────────────────────────────────
export interface SourceMetadata {
  source: string;
  symbol_name: string | null;
  fqcn: string | null;
  file_path: string | null;
  drupal_version: string;
  section: string | null;
  ingested_at: string; // ISO 8601
}

export interface ParsedPage {
  text: string;
  metadata: SourceMetadata;
}

const DOCBLOCK_RE = /\/\*\*[\s\S]*?\*\/\s*((?:(?:public|protected|private|static|abstract|final|readonly)\s+)*(?:function|class|interface|trait|enum)\s+\w+)/g;
const NAMESPACE_RE = /^namespace\s+([\w\\]+)\s*;/m;
const SYMBOL_RE = /\b(function|class|interface|trait|enum)\s+(\w+)/;
const STRIPPED_TAG_RE = /^\s*@(?:param|return|var|throws|see|deprecated|internal|todo)\b\s*/;

async function collectPhpFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectPhpFiles(fullPath);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && fullPath.endsWith('.php')) {
      files.push(fullPath);
    }
  }

  return files;
}

function cleanDocblock(rawDocblock: string): string {
  const withoutMarkers = rawDocblock
    .replace(/^\s*\/\*\*/, '')
    .replace(/\*\/\s*$/, '');

  const lines = withoutMarkers
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .map((line) => line.replace(STRIPPED_TAG_RE, ''));

  return lines.join('\n').trim();
}

function buildText(declaration: string, cleanedDocblock: string): string {
  return `\`\`\`php\n${declaration}\n\`\`\`\n\n${cleanedDocblock}`;
}

/**
 * Returns true if a PHPDoc block+declaration pair is pure boilerplate and
 * should be excluded from the vector index.
 *
 * @param text - The full regex match: the raw `/** … *\/` block plus the
 *               immediately-following declaration line.
 */
function isBoilerplateDocBlock(text: string): boolean {
  // `stripped` is everything that remains after removing the docblock comment
  // itself — i.e. the bare declaration (function/class signature, etc.).
  const stripped = text.replace(/\/\*\*[\s\S]*?\*\//g, '').trim();
  // Consider boilerplate if: declaration is very short (stub), or docblock
  // contains only @inheritdoc with no additional content.
  if (/^\s*\{?@inheritdoc\}?\s*$/im.test(text)) return true;
  return false;
}

export async function parsePHPDocFiles(coreDir: string, drupalVersion: string): Promise<ParsedPage[]> {
  const roots = ['core/lib', 'core/modules'].map((subPath) => path.join(coreDir, subPath));
  const phpFilesArrays = await Promise.all(roots.map((root) => collectPhpFiles(root)));
  const phpFiles = phpFilesArrays.flat();

  const parsedPages: ParsedPage[] = [];
  const ingestedAt = new Date().toISOString();

  for (const filePath of phpFiles) {
    const source = await readFile(filePath, 'utf8');
    const namespaceMatch = source.match(NAMESPACE_RE);
    const namespace = namespaceMatch?.[1] ?? null;

    DOCBLOCK_RE.lastIndex = 0;
    let match: RegExpExecArray | null = DOCBLOCK_RE.exec(source);

    while (match) {
      const fullMatch = match[0];
      const declaration = match[1]?.trim() ?? '';

      const docblockMatch = fullMatch.match(/\/\*\*[\s\S]*?\*\//);
      const rawDocblock = docblockMatch?.[0] ?? '';
      const cleanedDocblock = cleanDocblock(rawDocblock);

      if (cleanedDocblock.length >= 10 && !isBoilerplateDocBlock(fullMatch)) {
        const symbolMatch = declaration.match(SYMBOL_RE);
        const declarationKind = symbolMatch?.[1] ?? null;
        const symbolName = symbolMatch?.[2] ?? null;
        const isClassLike = declarationKind !== 'function';
        const fqcn = isClassLike && namespace && symbolName ? `${namespace}\\${symbolName}` : null;

        parsedPages.push({
          text: buildText(declaration, cleanedDocblock),
          metadata: {
            source: 'drupal_phpdoc',
            symbol_name: symbolName,
            fqcn,
            file_path: path.relative(coreDir, filePath),
            drupal_version: drupalVersion,
            section: null,
            ingested_at: ingestedAt,
          },
        });
      }

      match = DOCBLOCK_RE.exec(source);
    }
  }

  return parsedPages;
}

/**
 * Parse a generic Markdown file into a ParsedPage array.
 * Used by Developer Guides ETL.
 */
export function parseMarkdownFile(content: string): { title: string; content: string } {
  const lines = content.split('\n');
  const titleLine = lines.find((l) => l.startsWith('# '));
  const title = titleLine ? titleLine.replace(/^#\s*/, '').trim() : 'Untitled';
  const body = lines.join('\n').trim();
  return { title, content: body };
}

function normalizeDocsetPath(rawPath: string, anchor?: string | null): string | null {
  let normalizedPath = rawPath.trim();
  if (normalizedPath.length === 0) {
    return null;
  }

  // Newer Dash/Zeal docset schema can prefix paths with metadata like:
  // <dash_entry_titleDescription=...>api.drupal.org!api!...html
  const metadataBoundary = normalizedPath.indexOf('>');
  if (normalizedPath.startsWith('<') && metadataBoundary !== -1) {
    normalizedPath = normalizedPath.slice(metadataBoundary + 1);
  }

  try {
    normalizedPath = decodeURIComponent(normalizedPath);
  }
  catch {
    // keep original path if decoding fails
  }

  if (anchor && !normalizedPath.includes('#')) {
    normalizedPath = `${normalizedPath}#${anchor}`;
  }

  return normalizedPath;
}

export async function parseDocset(
  docsetPath: string,
  drupalVersion: string,
  limit: number = 10000,
): Promise<ParsedPage[]> {
  const dbPath = path.join(docsetPath, 'Contents', 'Resources', 'docSet.dsidx');

  try {
    await access(dbPath);
  }
  catch {
    console.error(`⚠ Drupal Docset not found at ${dbPath} — skipping`);
    return [];
  }

  type DocsetRow = {
    name: string;
    type: string;
    path: string;
    anchor?: string | null;
  };

  const parsedPages: ParsedPage[] = [];
  const seenHtmlFiles = new Set<string>();
  const ingestedAt = new Date().toISOString();
  let db: SqliteDatabase | null = null;

  try {
    db = new DatabaseSync(dbPath, { readonly: true });
    let rows: DocsetRow[];

    try {
      const stmt = db.prepare('SELECT name, type, path FROM searchIndex LIMIT ?');
      rows = stmt.all(limit) as DocsetRow[];
    }
    catch {
      const stmt = db.prepare(`
        SELECT
          t.ZTOKENNAME AS name,
          COALESCE(tt.ZTYPENAME, 'Unknown') AS type,
          fp.ZPATH AS path,
          mi.ZANCHOR AS anchor
        FROM ZTOKEN t
        LEFT JOIN ZTOKENTYPE tt ON tt.Z_PK = t.ZTOKENTYPE
        LEFT JOIN ZTOKENMETAINFORMATION mi ON mi.Z_PK = t.ZMETAINFORMATION
        LEFT JOIN ZFILEPATH fp ON fp.Z_PK = mi.ZFILE
        WHERE fp.ZPATH IS NOT NULL
        LIMIT ?
      `);

      rows = stmt.all(limit) as DocsetRow[];
    }

    for (let i = 0; i < rows.length; i += 1) {
      if (i > 0 && i % 500 === 0) {
        console.error(`Docset parse progress: ${i}/${rows.length}`);
      }

      const row = rows[i];
      const normalizedRowPath = normalizeDocsetPath(row.path, row.anchor);
      if (!normalizedRowPath) {
        continue;
      }

      const htmlFile = normalizedRowPath.split('#')[0];
      if (!htmlFile || seenHtmlFiles.has(htmlFile)) {
        continue;
      }
      seenHtmlFiles.add(htmlFile);

      const htmlPath = path.join(docsetPath, 'Contents', 'Resources', 'Documents', htmlFile);

      try {
        await access(htmlPath);
      }
      catch {
        continue;
      }

      const html = await readFile(htmlPath, 'utf8');
      const $ = cheerio.load(html);

      $('nav, header, footer, .sidebar, script, style, .breadcrumb, .region-breadcrumb').remove();

      const text = $('body').text().replace(/\s+/g, ' ').trim();
      if (text.length < 20) {
        continue;
      }

      parsedPages.push({
        text: `# ${row.name} (${row.type})\n\n${text}`,
          metadata: {
            source: 'drupal_docset',
            symbol_name: row.name,
            fqcn: row.name,
            file_path: normalizedRowPath,
            drupal_version: drupalVersion,
            section: row.type,
            ingested_at: ingestedAt,
        },
      });
    }
  }
  finally {
    db?.close();
  }

  return parsedPages;
}

export async function parseUserGuideMarkdown(mdPath: string): Promise<ParsedPage[]> {
  try {
    await access(mdPath);
  }
  catch {
    console.error(`⚠ User Guide Markdown not found at ${mdPath} — skipping`);
    return [];
  }

  const content = await readFile(mdPath, 'utf-8');
  const sections = content
    .split(/^(?=## )/m)
    .filter((section) => section.startsWith('## ') && section.trim().length > 50);

  const ingestedAt = new Date().toISOString();

  return sections.map((section) => {
    const firstLine = section.split('\n')[0] ?? '';
    const sectionTitle = firstLine.replace(/^##\s*/, '').trim();

    return {
      text: section,
      metadata: {
        source: 'user_guide',
        symbol_name: sectionTitle,
        fqcn: null,
        file_path: 'drupal-user-guide.md',
        drupal_version: 'all',
        section: sectionTitle,
        ingested_at: ingestedAt,
      },
    };
  });
}
