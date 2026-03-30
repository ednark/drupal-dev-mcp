import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { ParsedPage, SourceMetadata } from './parser.js';

const SOURCE_NAME = 'certification_docs';

/**
 * Returns true only for content files that should be ingested.
 *
 * Rules:
 *  - Accept .md, .pdf, .epub (NOT .txt — link-list files like extracted-links.txt add noise)
 *  - Files with "https-" prefixed names ARE the real scraped content from drupal.org
 *  - Skip README.md (index/navigation only, no substantive content)
 */
function isSupportedFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();

  // Skip README — navigation/index file, not substantive content
  if (lower === 'readme.md') {
    return false;
  }

  // Exclude .txt — these are link-list / log metadata files, not content
  return lower.endsWith('.md') || lower.endsWith('.pdf') || lower.endsWith('.epub');
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
      continue;
    }

    if (entry.isFile() && isSupportedFile(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function splitByHeadings(content: string): Array<{ title: string; text: string }> {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const headingRe = /^(#{1,6})\s+(.+)$|^(.+)\n(?:={3,}|-{3,})$/gm;
  const matches = [...normalized.matchAll(headingRe)];

  if (matches.length === 0) {
    return [{ title: 'Overview', text: normalized }];
  }

  const sections: Array<{ title: string; text: string }> = [];
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const start = current.index ?? 0;
    const end = next?.index ?? normalized.length;
    const title = (current[2] ?? current[3] ?? 'Overview').trim();
    const text = normalized.slice(start, end).trim();

    if (text.length > 0) {
      sections.push({ title, text });
    }
  }

  return sections;
}

function detectSourceType(filePath: string, content: string): 'certification' | 'training' | 'best-practice' {
  const haystack = `${filePath}\n${content}`.toLowerCase();
  if (haystack.includes('certification') || haystack.includes('acquia')) {
    return 'certification';
  }
  if (haystack.includes('training') || haystack.includes('course')) {
    return 'training';
  }
  return 'best-practice';
}

function detectTopicArea(content: string): string {
  const haystack = content.toLowerCase();
  if (/\btheme|theming|twig\b/.test(haystack)) return 'theming';
  if (/\bsecurity|secure|xss|csrf\b/.test(haystack)) return 'security';
  if (/\bperformance|cache|caching\b/.test(haystack)) return 'performance';
  if (/\bapi|rest|jsonapi|graphql\b/.test(haystack)) return 'api';
  if (/\bconfiguration|config\b/.test(haystack)) return 'configuration';
  if (/\bmigration|migrate\b/.test(haystack)) return 'migration';
  return 'general';
}

function readPdf(filePath: string): string | null {
  try {
    return execSync(`pdftotext -layout "${filePath}" -`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  }
  catch {
    console.warn(`⚠ pdftotext unavailable or failed for ${filePath}; skipping PDF`);
    return null;
  }
}

function readEpub(filePath: string): string | null {
  try {
    return execSync(`pandoc --to=plain "${filePath}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  }
  catch {
    console.warn(`⚠ pandoc unavailable or failed for ${filePath}; skipping EPUB`);
    return null;
  }
}

async function readSupportedText(filePath: string): Promise<string | null> {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.txt')) {
    return (await readFile(filePath, 'utf8')).trim();
  }
  if (lower.endsWith('.pdf')) {
    return readPdf(filePath)?.trim() ?? null;
  }
  if (lower.endsWith('.epub')) {
    return readEpub(filePath)?.trim() ?? null;
  }
  return null;
}

export async function parseCertificationDocs(sourcesDir: string): Promise<ParsedPage[]> {
  const certDir = path.join(sourcesDir, 'certification');

  try {
    await access(certDir);
  }
  catch {
    console.warn(`⚠ Certification docs directory not found at ${certDir} — skipping`);
    return [];
  }

  const files = await collectFiles(certDir);
  const pages: ParsedPage[] = [];
  let processed = 0;

  for (const filePath of files) {
    const content = await readSupportedText(filePath);
    if (!content || content.length === 0) {
      continue;
    }

    processed += 1;
    const relativeFilePath = path.relative(sourcesDir, filePath);
    const sourceType = detectSourceType(relativeFilePath, content);
    const topicArea = detectTopicArea(content);
    const sections = splitByHeadings(content);

    for (const section of sections) {
      pages.push({
        text: section.text,
        metadata: {
          source: SOURCE_NAME,
          symbol_name: sourceType,
          fqcn: null,
          file_path: relativeFilePath,
          drupal_version: 'general',
          section: `${topicArea}: ${section.title}`,
          ingested_at: new Date().toISOString(),
        } as SourceMetadata,
      });
    }
  }

  // ── Cross-document deduplication ─────────────────────────────────────────────
  // Normalise each chunk's text (lowercase, collapse whitespace, trim) and use the
  // first 200 characters as a fingerprint.  If two chunks from different files share
  // the fingerprint we keep only the first occurrence (the synthesized guide files
  // are sorted before raw-fetched pages because we now skip the latter, but this
  // guard handles any future additions or internal section repeats).
  const seenFingerprints = new Set<string>();
  const dedupedPages: ParsedPage[] = [];
  for (const page of pages) {
    const normalised = page.text.toLowerCase().replace(/\s+/g, ' ').trim();
    const fingerprint = normalised.slice(0, 200);
    if (seenFingerprints.has(fingerprint)) {
      continue;
    }
    seenFingerprints.add(fingerprint);
    dedupedPages.push(page);
  }

  const dropped = pages.length - dedupedPages.length;
  if (dropped > 0) {
    console.error(`  Deduplication removed ${dropped} duplicate chunk(s).`);
  }

  console.error(`Certification docs parse complete: files=${processed}, pages=${dedupedPages.length}`);
  return dedupedPages;
}
