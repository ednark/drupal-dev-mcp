import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedPage, SourceMetadata } from './parser.js';
import { splitPhpFile, splitYamlFile, type SplitChunk } from './php-splitter.js';

const SOURCE_NAME = 'core_module_code';

const SKIP_DIRS = new Set([
  '.git',
  '.github',
  'tests',
  'test',
  'node_modules',
  'vendor',
  'assets',
  'css',
  'js',
  'images',
]);

const MAX_FILE_BYTES = 350_000;

function normalizeRelPath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function isRootModuleYaml(fileName: string): boolean {
  return (
    fileName.endsWith('.info.yml')
    || fileName.endsWith('.services.yml')
    || fileName.endsWith('.routing.yml')
    || fileName.endsWith('.permissions.yml')
    || fileName.endsWith('.schema.yml')
    || fileName.endsWith('.links.menu.yml')
    || fileName.endsWith('.links.action.yml')
    || fileName.endsWith('.links.task.yml')
    || fileName.endsWith('.links.contextual.yml')
  );
}

function isTargetedSrcPhp(relFromCoreModules: string): boolean {
  if (!relFromCoreModules.includes('/src/')) {
    return false;
  }

  const normalized = relFromCoreModules.replace(/\\/g, '/');
  return /\/src\/(Controller|Form|Plugin|EventSubscriber|Access|RouteEnhancer)\//.test(normalized)
    || normalized.includes('/RouteEnhancer')
    || normalized.endsWith('RouteEnhancer.php');
}

function shouldIncludeFile(relFromCoreModules: string, absolutePath: string): boolean {
  const fileName = path.basename(absolutePath);

  if (fileName.endsWith('.module') || fileName.endsWith('.install')) {
    return true;
  }

  if (isRootModuleYaml(fileName)) {
    const pathParts = relFromCoreModules.split('/');
    return pathParts.length === 2;
  }

  if (fileName.endsWith('.php') && isTargetedSrcPhp(relFromCoreModules)) {
    return true;
  }

  return false;
}

async function collectTargetFiles(coreModulesDir: string, currentDir: string = coreModulesDir): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectTargetFiles(coreModulesDir, fullPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relFromCoreModules = normalizeRelPath(coreModulesDir, fullPath);
    if (shouldIncludeFile(relFromCoreModules, fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function moduleNameFromRelativePath(relFromCoreModules: string): string {
  return relFromCoreModules.split('/')[0] ?? 'core';
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

function inferSectionKind(fileName: string, chunk: SplitChunk, relFromCoreModules: string): string {
  if (fileName.endsWith('.services.yml')) return 'services';
  if (fileName.endsWith('.routing.yml')) return 'routing';
  if (fileName.endsWith('.permissions.yml')) return 'permissions';
  if (fileName.endsWith('.schema.yml')) return 'schema';
  if (fileName.endsWith('.info.yml')) return 'module info';
  if (fileName.endsWith('.links.menu.yml')) return 'menu links';
  if (fileName.endsWith('.links.task.yml')) return 'local tasks';
  if (fileName.endsWith('.links.action.yml')) return 'action links';
  if (fileName.endsWith('.links.contextual.yml')) return 'contextual links';
  if (fileName.endsWith('.module') || fileName.endsWith('.install')) return 'hook implementation';

  if (relFromCoreModules.includes('/src/Controller/')) return 'controller class';
  if (relFromCoreModules.includes('/src/Form/')) return 'form class';
  if (relFromCoreModules.includes('/src/Plugin/')) return 'plugin class';
  if (relFromCoreModules.includes('/src/EventSubscriber/')) return 'event subscriber';
  if (relFromCoreModules.includes('/src/Access/')) return 'access check';
  if (relFromCoreModules.includes('/src/RouteEnhancer/')) return 'route enhancer';

  if (chunk.symbolType === 'class') return 'class implementation';
  if (chunk.symbolType === 'method') return 'method implementation';
  if (chunk.symbolType === 'function') return 'function implementation';

  return 'code section';
}

function buildChunkText(fileName: string, chunk: SplitChunk): string {
  const lang = fileName.endsWith('.yml') ? 'yaml' : 'php';
  return `\`\`\`${lang}\n${chunk.text.trim()}\n\`\`\``;
}

export async function parseCoreModuleCode(coreDir: string, drupalVersion: string): Promise<ParsedPage[]> {
  const coreModulesDir = path.join(coreDir, 'core', 'modules');

  try {
    await access(coreModulesDir);
  }
  catch {
    console.warn(`⚠ Core modules directory not found at ${coreModulesDir} — skipping`);
    return [];
  }

  const files = await collectTargetFiles(coreModulesDir);
  const pages: ParsedPage[] = [];
  const ingestedAt = new Date().toISOString();

  for (const absPath of files) {
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

    const fileName = path.basename(absPath);
    const fileSize = Buffer.byteLength(content, 'utf8');
    if (fileSize > MAX_FILE_BYTES && fileName.endsWith('.php') && !fileName.endsWith('.module') && !fileName.endsWith('.install')) {
      continue;
    }

    const relFromCoreModules = normalizeRelPath(coreModulesDir, absPath);
    const filePathFromCoreRoot = normalizeRelPath(coreDir, absPath);
    const moduleName = moduleNameFromRelativePath(relFromCoreModules);

    const chunks = fileName.endsWith('.yml')
      ? splitYamlFile(content, relFromCoreModules, moduleName, fileName)
      : splitPhpFile(content, relFromCoreModules, moduleName);

    for (const chunk of chunks) {
      const symbolName = chunk.symbolName && chunk.symbolName !== 'unknown'
        ? chunk.symbolName
        : fileName;

      pages.push({
        text: buildChunkText(fileName, chunk),
        metadata: {
          source: SOURCE_NAME,
          symbol_name: symbolName,
          fqcn: inferFqcn(chunk),
          file_path: filePathFromCoreRoot,
          drupal_version: drupalVersion,
          section: `${moduleName}: ${inferSectionKind(fileName, chunk, relFromCoreModules)}`,
          ingested_at: ingestedAt,
        } as SourceMetadata,
      });
    }
  }

  console.error(`  [core-module-code] Parsed ${pages.length} page(s) from ${files.length} file(s)`);
  return pages;
}
