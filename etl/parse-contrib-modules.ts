import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedPage, SourceMetadata } from './parser.js';

const SOURCE_NAME = 'contrib_module_docs';

function splitByHeadings(text: string): Array<{ title: string; text: string }> {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const headingRe = /^(#{1,6})\s+(.+)$/gm;
  const matches = [...normalized.matchAll(headingRe)];

  if (matches.length === 0) {
    return [{ title: 'README', text: normalized }];
  }

  const sections: Array<{ title: string; text: string }> = [];
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const start = current.index ?? 0;
    const end = next?.index ?? normalized.length;
    sections.push({
      title: (current[2] ?? 'README').trim() || 'README',
      text: normalized.slice(start, end).trim(),
    });
  }

  return sections.filter((s) => s.text.length > 0);
}

function parseInfoYml(content: string): string {
  const wanted = new Set(['name', 'description', 'type', 'core_version_requirement']);
  const lines = content.split(/\r?\n/);
  const extracted: string[] = [];

  for (const line of lines) {
    if (!line.includes(':')) {
      continue;
    }
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (wanted.has(key) && value.length > 0) {
      extracted.push(`${key}: ${value}`);
    }
  }

  return extracted.join('\n').trim();
}

function isInterestingFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md')) {
    return true;
  }
  if (lower.endsWith('.info.yml')) {
    return true;
  }
  if (lower.endsWith('.txt') && lower.includes('readme')) {
    return true;
  }
  return false;
}

async function walkContribFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkContribFiles(fullPath));
      continue;
    }
    if (entry.isFile() && isInterestingFile(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function moduleNameFromPath(contribDir: string, filePath: string): string {
  const relative = path.relative(contribDir, filePath);
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length > 1) {
    return parts[0] ?? path.basename(filePath, path.extname(filePath));
  }
  return path.basename(filePath, path.extname(filePath));
}

async function collectVendorReadmesFromComposerLock(): Promise<Array<{ packageName: string; readmePath: string; text: string }>> {
  const workspaceRoot = process.cwd();
  const composerLockPath = path.join(workspaceRoot, 'composer.lock');
  const results: Array<{ packageName: string; readmePath: string; text: string }> = [];

  try {
    await access(composerLockPath);
  }
  catch {
    return results;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(composerLockPath, 'utf8'));
  }
  catch {
    return results;
  }

  const lock = parsed as { packages?: Array<{ name?: string; type?: string }>; 'packages-dev'?: Array<{ name?: string; type?: string }> };
  const allPackages = [...(lock.packages ?? []), ...(lock['packages-dev'] ?? [])];
  const targetPackages = allPackages.filter((pkg) => {
    const name = pkg.name ?? '';
    const type = pkg.type ?? '';
    return type === 'drupal-module' || name.startsWith('drupal/');
  });

  for (const pkg of targetPackages) {
    const name = pkg.name;
    if (!name) {
      continue;
    }
    const pkgDir = path.join(workspaceRoot, 'vendor', ...name.split('/'));
    try {
      const entries = await readdir(pkgDir, { withFileTypes: true });
      const readmes = entries.filter((e) => e.isFile() && /^readme(\.|$)/i.test(e.name));
      for (const readme of readmes) {
        const filePath = path.join(pkgDir, readme.name);
        const text = (await readFile(filePath, 'utf8')).trim();
        if (!text) {
          continue;
        }
        results.push({
          packageName: name,
          readmePath: path.relative(workspaceRoot, filePath),
          text,
        });
      }
    }
    catch {
      // ignore missing vendor package directories
    }
  }

  return results;
}

export async function parseContribModules(sourcesDir: string): Promise<ParsedPage[]> {
  const contribDir = path.join(sourcesDir, 'contrib-modules');
  const pages: ParsedPage[] = [];
  let moduleNames = new Set<string>();

  try {
    await access(contribDir);
    const files = await walkContribFiles(contribDir);

    for (const filePath of files) {
      const raw = (await readFile(filePath, 'utf8')).trim();
      if (!raw) {
        continue;
      }

      const moduleName = moduleNameFromPath(contribDir, filePath);
      moduleNames.add(moduleName);
      const relativeFilePath = path.relative(sourcesDir, filePath);
      const text = filePath.endsWith('.info.yml') ? parseInfoYml(raw) : raw;
      const sections = splitByHeadings(text);

      for (const section of sections) {
        pages.push({
          text: section.text,
          metadata: {
            source: SOURCE_NAME,
            symbol_name: moduleName,
            fqcn: null,
            file_path: relativeFilePath,
            drupal_version: '11.x',
            section: section.title || 'README',
            ingested_at: new Date().toISOString(),
          } as SourceMetadata,
        });
      }
    }
  }
  catch {
    console.warn(`⚠ Contrib modules directory not found at ${contribDir} — continuing with composer.lock/vendor scan`);
  }

  const vendorReadmes = await collectVendorReadmesFromComposerLock();
  for (const readme of vendorReadmes) {
    moduleNames.add(readme.packageName.replace(/^drupal\//, ''));
    const sections = splitByHeadings(readme.text);
    for (const section of sections) {
      pages.push({
        text: section.text,
        metadata: {
          source: SOURCE_NAME,
          symbol_name: readme.packageName.replace(/^drupal\//, ''),
          fqcn: null,
          file_path: readme.readmePath,
          drupal_version: '11.x',
          section: section.title || 'README',
          ingested_at: new Date().toISOString(),
        } as SourceMetadata,
      });
    }
  }

  console.error(`Contrib modules parse complete: modules=${moduleNames.size}, pages=${pages.length}`);
  return pages;
}
