import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedPage, SourceMetadata } from './parser.js';
import { splitPhpFile, splitYamlFile, type SplitChunk } from './php-splitter.js';

const SOURCE_NAME = 'drupal_examples';
const EXAMPLES_DIRNAME = 'drupal-examples';

const SKIP_DIRS = new Set([
  '.git',
  '.github',
  '.idea',
  '.vscode',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  'tmp',
  'temp',
  'tests',
  'test',
]);

const MAX_FILE_BYTES = 300_000;

function isIncludedFile(fileName: string): boolean {
  return (
    fileName.endsWith('.module')
    || fileName.endsWith('.install')
    || fileName.endsWith('.theme')
    || fileName.endsWith('.inc')
    || fileName.endsWith('.php')
    || fileName.endsWith('.info.yml')
    || fileName.endsWith('.services.yml')
    || fileName.endsWith('.routing.yml')
    || fileName.endsWith('.links.menu.yml')
    || fileName.endsWith('.links.task.yml')
    || fileName.endsWith('.permissions.yml')
    || fileName.endsWith('.schema.yml')
  );
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
      continue;
    }

    if (entry.isFile() && isIncludedFile(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizeRelPath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function moduleNameFromPath(relPath: string): string {
  const base = path.basename(relPath);
  const stem = base.replace(/\.(?:services|routing|info|schema|links\.menu|links\.task|permissions)\.yml$/, '')
    .replace(/\.(?:module|install|theme|inc|php)$/, '');

  if (stem && stem !== base) {
    return stem;
  }

  const parts = relPath.split('/').filter(Boolean);
  const modulesIndex = parts.indexOf('modules');
  if (modulesIndex >= 0 && parts[modulesIndex + 1]) {
    return parts[modulesIndex + 1];
  }

  return parts[0] ?? 'examples';
}

function inferSectionKind(fileName: string, chunk: SplitChunk): string {
  if (fileName.endsWith('.services.yml')) return 'services';
  if (fileName.endsWith('.routing.yml')) return 'routing';
  if (fileName.endsWith('.links.menu.yml')) return 'menu links';
  if (fileName.endsWith('.links.task.yml')) return 'local tasks';
  if (fileName.endsWith('.permissions.yml')) return 'permissions';
  if (fileName.endsWith('.schema.yml')) return 'schema';
  if (fileName.endsWith('.info.yml')) return 'module info';

  if (chunk.symbolType === 'class') return 'class implementation';
  if (chunk.symbolType === 'method') return 'method implementation';

  if (fileName.endsWith('.module') || fileName.endsWith('.install') || fileName.endsWith('.theme')) {
    return 'hook implementation';
  }

  if (chunk.symbolType === 'function') return 'function implementation';

  return 'code section';
}

function inferFqcn(chunk: SplitChunk): string | null {
  if (!chunk.namespace) {
    return null;
  }

  if (chunk.symbolType === 'class') {
    return `${chunk.namespace}\\${chunk.symbolName}`;
  }

  if (chunk.symbolType === 'method') {
    const className = chunk.symbolName.split('::')[0];
    return className ? `${chunk.namespace}\\${className}` : null;
  }

  if (chunk.symbolType === 'function') {
    return `${chunk.namespace}\\${chunk.symbolName}`;
  }

  return null;
}

function buildChunkText(fileName: string, chunk: SplitChunk): string {
  const lang = fileName.endsWith('.yml') ? 'yaml' : 'php';
  return `\`\`\`${lang}\n${chunk.text.trim()}\n\`\`\``;
}

export async function parseDrupalExamples(sourcesDir: string): Promise<ParsedPage[]> {
  const root = path.join(sourcesDir, EXAMPLES_DIRNAME);
  try {
    await access(root);
  }
  catch {
    console.warn(`⚠ Drupal Examples source directory not found at ${root} — skipping`);
    return [];
  }

  const files = await collectFiles(root);
  const pages: ParsedPage[] = [];
  const ingestedAt = new Date().toISOString();

  for (const absPath of files) {
    const relPath = normalizeRelPath(root, absPath);
    const moduleName = moduleNameFromPath(relPath);
    const fileName = path.basename(absPath);

    let content: string;
    try {
      content = await readFile(absPath, 'utf8');
    }
    catch {
      continue;
    }

    if (!content.trim()) {
      continue;
    }

    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES && !fileName.endsWith('.module') && !fileName.endsWith('.install')) {
      continue;
    }

    const chunks = fileName.endsWith('.yml')
      ? splitYamlFile(content, relPath, moduleName, fileName)
      : splitPhpFile(content, relPath, moduleName);

    for (const chunk of chunks) {
      const symbolName = chunk.symbolName && chunk.symbolName !== 'unknown'
        ? chunk.symbolName
        : fileName;
      const sectionKind = inferSectionKind(fileName, chunk);

      pages.push({
        text: buildChunkText(fileName, chunk),
        metadata: {
          source: SOURCE_NAME,
          symbol_name: symbolName,
          fqcn: inferFqcn(chunk),
          file_path: relPath,
          drupal_version: 'all',
          section: `${moduleName}: ${sectionKind}`,
          ingested_at: ingestedAt,
        } as SourceMetadata,
      });
    }
  }

  console.error(`  [drupal-examples] Parsed ${pages.length} page(s) from ${files.length} file(s)`);
  return pages;
}
