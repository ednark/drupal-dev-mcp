import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedPage, SourceMetadata } from './parser.js';

const SOURCE_NAME = 'drupal_best_practices';

/**
 * Collect all .md files under a directory, recursively.
 * README.md files are skipped — the root README is handled separately.
 */
async function collectMarkdownFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
      continue;
    }
    // Skip README.md files inside the ai/ subdirectory scan
    if (entry.name.toLowerCase() === 'readme.md') {
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Split markdown content by any heading level (# through ######).
 * Also handles setext-style headings (=== and ---).
 * Returns an array of { title, text } sections.
 */
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

/**
 * Deduplicate pages by a 200-char fingerprint of the normalised text.
 * Keeps the first occurrence when duplicates are found.
 */
function deduplicateByFingerprint(pages: ParsedPage[]): ParsedPage[] {
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

  return dedupedPages;
}

/**
 * Parse the drupal-best-practices repository's docs/ directory
 * into an array of ParsedPage objects suitable for chunking and embedding.
 *
 * @param sourcesDir - Path to the ETL sources directory (e.g. data/sources)
 */
export async function parseBestPractices(sourcesDir: string): Promise<ParsedPage[]> {
  const docsDir = path.join(sourcesDir, 'drupal-best-practices', 'ai');

  try {
    await access(docsDir);
  }
  catch {
    console.error(`⚠ Best practices docs directory not found at ${docsDir} — skipping`);
    return [];
  }

  const pages: ParsedPage[] = [];
  let processed = 0;

  // ── Root README.md ────────────────────────────────────────────────────────────
  // Process the root README explicitly (it lives outside the ai/ scan dir).
  const rootReadmePath = path.join(sourcesDir, 'drupal-best-practices', 'README.md');
  try {
    const rootContent = (await readFile(rootReadmePath, 'utf8')).trim();
    if (rootContent && rootContent.length > 0) {
      const rootRelPath = path.relative(sourcesDir, rootReadmePath);
      const rootSections = splitByHeadings(rootContent);
      processed += 1;

      for (const section of rootSections) {
        if (section.text.length < 50) {
          continue;
        }
        pages.push({
          text: section.text,
          metadata: {
            source: SOURCE_NAME,
            symbol_name: 'overview',
            fqcn: null,
            file_path: rootRelPath,
            drupal_version: 'general',
            section: `overview: ${section.title}`,
            ingested_at: new Date().toISOString(),
          } as SourceMetadata,
        });
      }

      console.error(`  [best-practices] ${rootRelPath} → ${rootSections.length} section(s)`);
    }
  }
  catch {
    console.error(`⚠ Root README.md not found at ${rootReadmePath} — skipping`);
  }

  // ── ai/ subdirectory files ────────────────────────────────────────────────────
  // README.md files inside ai/ are skipped by collectMarkdownFiles.
  const files = await collectMarkdownFiles(docsDir);

  for (const filePath of files) {
    const fileName = path.basename(filePath);

    const content = (await readFile(filePath, 'utf8')).trim();
    if (!content || content.length === 0) {
      continue;
    }

    processed += 1;

    // topic slug = filename without extension (e.g. "caching.md" → "caching")
    const topicSlug = path.basename(fileName, path.extname(fileName));

    // relative file path from sourcesDir (e.g. "drupal-best-practices/ai/caching.md")
    const relativeFilePath = path.relative(sourcesDir, filePath);

    const sections = splitByHeadings(content);

    for (const section of sections) {
      // Skip trivially short sections
      if (section.text.length < 50) {
        continue;
      }

      pages.push({
        text: section.text,
        metadata: {
          source: SOURCE_NAME,
          symbol_name: topicSlug,
          fqcn: null,
          file_path: relativeFilePath,
          drupal_version: 'general',
          section: `${topicSlug}: ${section.title}`,
          ingested_at: new Date().toISOString(),
        } as SourceMetadata,
      });
    }

    console.error(`  [best-practices] ${relativeFilePath} → ${sections.length} section(s)`);
  }

  // ── Cross-document deduplication ─────────────────────────────────────────────
  // Use first 200 chars of normalised text as a fingerprint to drop duplicates.
  const dedupedPages = deduplicateByFingerprint(pages);
  const dropped = pages.length - dedupedPages.length;
  if (dropped > 0) {
    console.error(`  Deduplication removed ${dropped} duplicate chunk(s).`);
  }

  console.error(
    `Best practices parse complete: files=${processed}, pages=${dedupedPages.length}`,
  );

  return dedupedPages;
}
