/**
 * Parser for Drupal contrib module source code.
 *
 * Walks `data/sources/contrib-module-code/` and converts PHP and YAML files
 * into `ParsedPage[]` using the PHP-aware splitter.
 *
 * Directory layout expected:
 *   data/sources/contrib-module-code/
 *     views/
 *       src/Plugin/Block/ViewsBlock.php
 *       views.services.yml
 *       views.module
 *       views.api.php          ← hook documentation (fetched by fetch-contrib-api-php.ts)
 *     webform/
 *       ...
 */

import { existsSync } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedPage, SourceMetadata } from './parser.js';
import { splitPhpFile, splitYamlFile } from './php-splitter.js';

// ── Constants ───────────────────────────────────────────────────

const SOURCE_DIR = path.join(process.cwd(), 'data', 'sources', 'contrib-module-code');

/** File extensions (or full suffixes) that should be indexed. */
const INCLUDE_EXTENSIONS = new Set([
  '.php',
  '.module',
  '.install',
  '.theme',
  '.services.yml',
  '.routing.yml',
  '.schema.yml',
  '.info.yml',
  '.api.php',
]);

/** Top-level directory names to skip entirely. */
const SKIP_DIRS = new Set([
  'tests',
  'Tests',
  'test',
  'vendor',
  'node_modules',
  '.git',
]);

// ── File Collection ─────────────────────────────────────────────

/** Returns true when the given file name matches one of the included extensions. */
function isIncludedFile(fileName: string): boolean {
  // Check multi-part suffixes first (longest match wins)
  if (fileName.endsWith('.services.yml')) return true;
  if (fileName.endsWith('.routing.yml')) return true;
  if (fileName.endsWith('.schema.yml')) return true;
  if (fileName.endsWith('.info.yml')) return true;

  const ext = path.extname(fileName);
  return INCLUDE_EXTENSIONS.has(ext);
}

/**
 * Recursively collects file paths under `dir`, skipping directories listed in
 * `SKIP_DIRS`.
 */
async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && isIncludedFile(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

// ── Module Version Detection ────────────────────────────────────

/**
 * Attempts to read `{module}.info.yml` from the module root directory and
 * extract the `core_version_requirement` value.  Falls back to `'all'`.
 */
async function detectDrupalVersion(moduleDir: string): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(moduleDir);
  }
  catch {
    return 'all';
  }

  const infoFile = entries.find((f) => f.endsWith('.info.yml'));
  if (!infoFile) return 'all';

  try {
    const content = await readFile(path.join(moduleDir, infoFile), 'utf8');
    const m = content.match(/^core_version_requirement:\s*(.+)$/m);
    return m?.[1]?.trim().replace(/['"]/g, '') ?? 'all';
  }
  catch {
    return 'all';
  }
}

// ── ParsedPage Construction ─────────────────────────────────────

/**
 * Builds the prose preamble prepended to every PHP code chunk so embedding
 * models can use the module + symbol context for semantic retrieval.
 */
function buildPhpChunkText(
  moduleName: string,
  symbolName: string,
  symbolType: string,
  relFilePath: string,
  chunkText: string,
): string {
  return (
    `// ${moduleName}: ${symbolName} (${symbolType})\n`
    + `// File: ${relFilePath}\n\n`
    + `\`\`\`php\n${chunkText}\n\`\`\``
  );
}

/**
 * Builds the prose preamble prepended to every YAML chunk.
 */
function buildYamlChunkText(
  moduleName: string,
  symbolName: string,
  symbolType: string,
  relFilePath: string,
  chunkText: string,
): string {
  return (
    `# ${moduleName}: ${symbolName} (${symbolType})\n`
    + `# File: ${relFilePath}\n\n`
    + `\`\`\`yaml\n${chunkText}\n\`\`\``
  );
}

// ── .api.php Docblock Extractor ─────────────────────────────────

interface ApiPhpChunk {
  functionName: string;
  text: string;
}

/**
 * Parses a `.api.php` file and extracts each `hook_*` or `callback_*` function
 * along with its preceding docblock comment. Each hook becomes one chunk.
 */
function parseApiPhpDocblocks(content: string): ApiPhpChunk[] {
  const chunks: ApiPhpChunk[] = [];

  // Match optional docblock + function declaration for hook_* / callback_* functions
  const hookPattern =
    /((?:\/\*\*[\s\S]*?\*\/\s*)?)function\s+((?:hook_|callback_)\w+)\s*\([^)]*\)\s*\{/g;

  let match: RegExpExecArray | null;
  while ((match = hookPattern.exec(content)) !== null) {
    const docblock = match[1]?.trim() ?? '';
    const funcName = match[2];
    const startIdx = match.index;

    // Find the end of this function body using brace counting
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let i = match.index + match[0].length - 1; // position of opening brace

    for (; i < content.length; i++) {
      const ch = content[i];

      if (inString) {
        if (ch === stringChar && content[i - 1] !== '\\') {
          inString = false;
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        continue;
      }

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }

    const funcBody = content.slice(startIdx, i).trim();
    const chunkText = docblock ? `${docblock}\n${funcBody}` : funcBody;
    chunks.push({ functionName: funcName, text: chunkText });
  }

  return chunks;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Returns `true` when the contrib-module-code source directory exists on disk.
 * Use this to gate processing without throwing.
 */
export function canAccess(): boolean {
  return existsSync(SOURCE_DIR);
}

/**
 * Walks `data/sources/contrib-module-code/`, splits all supported PHP and YAML
 * files into semantic chunks, and returns them as `ParsedPage[]`.
 *
 * Returns an empty array when the source directory does not exist.
 */
export async function parseContribModuleCode(): Promise<ParsedPage[]> {
  try {
    await access(SOURCE_DIR);
  }
  catch {
    console.warn(`⚠  Contrib module code directory not found at ${SOURCE_DIR} — skipping`);
    return [];
  }

  // Enumerate top-level entries — each is one module directory
  let topLevelEntries: import('node:fs').Dirent[];
  try {
    const { readdir: readdirSync } = await import('node:fs/promises');
    topLevelEntries = await readdirSync(SOURCE_DIR, { withFileTypes: true });
  }
  catch {
    console.warn(`⚠  Could not read ${SOURCE_DIR}`);
    return [];
  }

  const moduleNames = topLevelEntries
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const pages: ParsedPage[] = [];
  const ingestedAt = new Date().toISOString();
  let processedFiles = 0;

  for (const moduleName of moduleNames) {
    const moduleDir = path.join(SOURCE_DIR, moduleName);
    const drupalVersion = await detectDrupalVersion(moduleDir);
    const files = await collectFiles(moduleDir);

    for (const absoluteFilePath of files) {
      const fileName = path.basename(absoluteFilePath);

      // Relative path from the SOURCE_DIR root, e.g. views/src/Plugin/Block/ViewsBlock.php
      const filePath = path
        .relative(SOURCE_DIR, absoluteFilePath)
        .split(path.sep)
        .join('/');

      // Relative path within the module dir, e.g. src/Plugin/Block/ViewsBlock.php
      const relFilePathWithinModule = path
        .relative(moduleDir, absoluteFilePath)
        .split(path.sep)
        .join('/');

      let content: string;
      try {
        content = await readFile(absoluteFilePath, 'utf8');
      }
      catch {
        console.warn(`⚠  Could not read ${absoluteFilePath}`);
        continue;
      }

      // Skip test modules masquerading as real modules
      if (fileName.endsWith('.info.yml') && content.includes('package: Testing')) {
        continue;
      }

      processedFiles++;

      const isYaml = fileName.endsWith('.yml');
      const isApiPhp = fileName.endsWith('.api.php');
      const isRootServicesYml =
        fileName === `${moduleName}.services.yml` &&
        path.dirname(absoluteFilePath) === moduleDir;
      const gitUrl =
        `https://git.drupalcode.org/project/${moduleName}/-/blob/HEAD/${relFilePathWithinModule}`;

      if (isApiPhp) {
        // ── .api.php: extract hook/callback docblocks as individual chunks ──
        const hookChunks = parseApiPhpDocblocks(content);
        for (const hook of hookChunks) {
          const text =
            `// ${moduleName}: ${hook.functionName} (hook definition)\n`
            + `// File: ${filePath}\n\n`
            + `\`\`\`php\n${hook.text}\n\`\`\``;
          pages.push({
            text,
            metadata: {
              source: 'contrib_module_code',
              symbol_name: hook.functionName,
              fqcn: null,
              file_path: filePath,
              drupal_version: drupalVersion,
              section: `${moduleName}: hook definition`,
              ingested_at: ingestedAt,
            } satisfies SourceMetadata,
          });
        }

        // Fall back to single chunk if no hook functions matched pattern
        if (hookChunks.length === 0) {
          const text =
            `// ${moduleName}: ${fileName} (api documentation)\n`
            + `// File: ${filePath}\n\n`
            + `\`\`\`php\n${content.trim()}\n\`\`\``;
          pages.push({
            text,
            metadata: {
              source: 'contrib_module_code',
              symbol_name: fileName,
              fqcn: null,
              file_path: filePath,
              drupal_version: drupalVersion,
              section: `${moduleName}: api documentation`,
              ingested_at: ingestedAt,
            } satisfies SourceMetadata,
          });
        }
      }
      else if (isRootServicesYml) {
        // ── Root-level {module}.services.yml: single chunk as-is ──
        const text =
          `// ${moduleName}: services.yml\n`
          + `// File: ${filePath}\n\n`
          + `\`\`\`yaml\n${content.trim()}\n\`\`\``;
        pages.push({
          text,
          metadata: {
            source: 'contrib_module_code',
            symbol_name: `${moduleName}.services.yml`,
            fqcn: null,
            file_path: filePath,
            drupal_version: drupalVersion,
            section: `${moduleName}: services`,
            ingested_at: ingestedAt,
          } satisfies SourceMetadata,
        });
      }
      else if (isYaml) {
        const chunks = splitYamlFile(content, filePath, moduleName, fileName);
        for (const chunk of chunks) {
          const text = buildYamlChunkText(
            moduleName,
            chunk.symbolName,
            chunk.symbolType,
            filePath,
            chunk.text,
          );
          pages.push({
            text,
            metadata: {
              source: 'contrib_module_code',
              symbol_name: chunk.symbolName,
              fqcn: null,
              file_path: filePath,
              drupal_version: drupalVersion,
              section: `${moduleName}: ${chunk.symbolType}`,
              ingested_at: ingestedAt,
            } satisfies SourceMetadata,
          });
        }
      }
      else {
        // PHP / .module / .install / .theme
        const chunks = splitPhpFile(content, filePath, moduleName);
        for (const chunk of chunks) {
          // Build FQCN for OOP symbols
          const fqcn: string | null =
            chunk.namespace && chunk.symbolType !== 'function'
              ? `${chunk.namespace}\\${chunk.symbolName}`
              : null;

          const text = buildPhpChunkText(
            moduleName,
            chunk.symbolName,
            chunk.symbolType,
            filePath,
            chunk.text,
          );
          pages.push({
            text,
            metadata: {
              source: 'contrib_module_code',
              symbol_name: chunk.symbolName,
              fqcn,
              file_path: filePath,
              drupal_version: drupalVersion,
              section: `${moduleName}: ${chunk.symbolType}`,
              ingested_at: ingestedAt,
            } satisfies SourceMetadata,
          });
        }
      }

      // Silence unused variable lint warning — gitUrl is available for callers
      void gitUrl;
    }
  }

  console.error(
    `Contrib module code parse complete: modules=${moduleNames.length}, files=${processedFiles}, pages=${pages.length}`,
  );
  return pages;
}
