/**
 * Parser for Drupal contrib module handbook pages.
 *
 * Reads `*-handbook.md` files from `data/sources/contrib-modules/`, splits
 * each file by headings, and returns `ParsedPage[]` tagged with
 * `source: 'contrib_module_handbook'`.
 *
 * Module name is derived from the filename by stripping the `-handbook.md`
 * suffix and taking the last `-`-delimited segment, e.g.:
 *   contributed-modules-views-handbook.md  →  views
 *   8-modules-token-handbook.md            →  token
 */

import { existsSync } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedPage, SourceMetadata } from './parser.js';

const SOURCE_NAME = 'contrib_module_handbook';
const SOURCE_DIR = path.join(process.cwd(), 'data', 'sources', 'contrib-modules');

// ── Helpers ────────────────────────────────────────────────────────────────

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

/**
 * Derive a short module name from a handbook filename.
 *
 * Strategy: strip the `.md` extension and `-handbook` suffix, then split the
 * remainder by `-` and take the last segment.
 *
 * Examples:
 *   contributed-modules-views-handbook.md  →  views
 *   8-modules-token-handbook.md            →  token
 *   contributed-modules-admin-toolbar-handbook.md  →  toolbar
 */
function moduleNameFromHandbookFile(fileName: string): string {
  // Strip extension and trailing "-handbook" suffix
  const withoutExt = fileName.replace(/\.md$/i, '');
  const withoutHandbook = withoutExt.replace(/-handbook$/i, '');
  const parts = withoutHandbook.split('-').filter(Boolean);
  return parts[parts.length - 1] ?? withoutHandbook;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns `true` when the contrib-modules source directory exists on disk.
 * Use this to gate processing without throwing.
 */
export function canAccess(): boolean {
  return existsSync(SOURCE_DIR);
}

/**
 * Reads all `*-handbook.md` files from `data/sources/contrib-modules/`,
 * splits each by headings, and returns them as `ParsedPage[]`.
 *
 * Returns an empty array when no handbook files are found.
 */
export async function parseContribModuleHandbook(): Promise<ParsedPage[]> {
  try {
    await access(SOURCE_DIR);
  }
  catch {
    console.error(`⚠ Contrib modules directory not found at ${SOURCE_DIR} — skipping handbook parse`);
    return [];
  }

  const entries = await readdir(SOURCE_DIR, { withFileTypes: true });
  const handbookFiles = entries
    .filter((e) => e.isFile() && /^.+-handbook\.md$/i.test(e.name))
    .map((e) => path.join(SOURCE_DIR, e.name));

  if (handbookFiles.length === 0) {
    console.error(`⚠ No handbook files found in ${SOURCE_DIR} — skipping handbook parse`);
    return [];
  }

  const pages: ParsedPage[] = [];
  const ingestedAt = new Date().toISOString();

  for (const filePath of handbookFiles) {
    const raw = (await readFile(filePath, 'utf8')).trim();
    if (!raw) {
      continue;
    }

    const fileName = path.basename(filePath);
    const moduleName = moduleNameFromHandbookFile(fileName);
    const relativeFilePath = path.relative(path.join(process.cwd(), 'data', 'sources'), filePath);
    const sections = splitByHeadings(raw);

    for (const section of sections) {
      pages.push({
        text: section.text,
        metadata: {
          source: SOURCE_NAME,
          symbol_name: moduleName,
          fqcn: null,
          file_path: relativeFilePath,
          drupal_version: 'all',
          section: section.title || 'README',
          ingested_at: ingestedAt,
        } as SourceMetadata,
      });
    }
  }

  console.error(
    `Contrib module handbook parse complete: files=${handbookFiles.length}, pages=${pages.length}`,
  );
  return pages;
}
