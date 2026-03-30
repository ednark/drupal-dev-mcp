/**
 * Parser for Drupal module handbook pages.
 *
 * Reads all `*.md` files from `data/sources/drupal-module-handbook/`, splits
 * each file by headings, and returns `ParsedPage[]` tagged with
 * `source: 'drupal_module_handbook'`.
 *
 * Topic is derived from the filename by stripping the `.md` extension and
 * replacing hyphens with spaces, e.g.:
 *   creating-custom-modules-hooks-and-alters-guide.md
 *     →  "creating custom modules hooks and alters guide"
 */

import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedPage, SourceMetadata } from './parser.js';

const SOURCE_NAME = 'drupal_module_handbook';
const SOURCE_DIR = path.join(process.cwd(), 'data', 'sources', 'drupal-module-handbook');

/** Minimum content length (chars) for a section to be kept. */
const MIN_SECTION_CHARS = 80;

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
 * Derive a human-readable topic name from a handbook filename.
 *
 * Strategy: strip the `.md` extension and replace all hyphens with spaces.
 *
 * Example:
 *   creating-custom-modules-hooks-and-alters-guide.md
 *     →  "creating custom modules hooks and alters guide"
 */
function topicFromFileName(fileName: string): string {
  return fileName.replace(/\.md$/i, '').replace(/-/g, ' ').trim();
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns `true` when the drupal-module-handbook source directory exists on
 * disk.  Use this to gate processing without throwing.
 */
export async function canAccess(): Promise<boolean> {
  try {
    await access(SOURCE_DIR);
    return true;
  }
  catch {
    return false;
  }
}

/**
 * Reads all `*.md` files from `data/sources/drupal-module-handbook/`,
 * splits each by headings, drops thin sections (< 80 chars), and returns
 * them as `ParsedPage[]`.
 *
 * Returns an empty array when the directory is absent or contains no
 * Markdown files.
 */
export async function parseDrupalModuleHandbook(): Promise<ParsedPage[]> {
  try {
    await access(SOURCE_DIR);
  }
  catch {
    console.error(`⚠ Drupal module handbook directory not found at ${SOURCE_DIR} — skipping parse`);
    return [];
  }

  const entries = await readdir(SOURCE_DIR, { withFileTypes: true });
  const mdFiles = entries
    .filter((e) => e.isFile() && /\.md$/i.test(e.name))
    .map((e) => path.join(SOURCE_DIR, e.name));

  if (mdFiles.length === 0) {
    console.error(`⚠ No .md files found in ${SOURCE_DIR} — skipping parse`);
    return [];
  }

  const pages: ParsedPage[] = [];
  const ingestedAt = new Date().toISOString();
  const sourcesBase = path.join(process.cwd(), 'data', 'sources');

  for (const filePath of mdFiles) {
    const raw = (await readFile(filePath, 'utf8')).trim();
    if (!raw) {
      continue;
    }

    const fileName = path.basename(filePath);
    const topic = topicFromFileName(fileName);
    const relativeFilePath = path.relative(sourcesBase, filePath);
    const sections = splitByHeadings(raw);

    for (const section of sections) {
      // Drop navigation stubs and near-empty sections
      if (section.text.length < MIN_SECTION_CHARS) {
        continue;
      }

      pages.push({
        text: section.text,
        metadata: {
          source: SOURCE_NAME,
          symbol_name: topic,
          fqcn: '',
          file_path: relativeFilePath,
          drupal_version: 'all',
          section: section.title || 'README',
          ingested_at: ingestedAt,
        } as SourceMetadata,
      });
    }
  }

  console.error(
    `Drupal module handbook parse complete: files=${mdFiles.length}, pages=${pages.length}`,
  );
  return pages;
}
