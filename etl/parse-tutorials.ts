import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import type { AnyNode, Element as DomElement, Text as DomText } from 'domhandler';
import type { ParsedPage } from './parser.js';

const TUTORIALS_SOURCE = 'drupal_tutorials';

// ── Noise-removal selectors ────────────────────────────────────
// These match all navigation menus, sidebars, ads, banners, and
// boilerplate elements that appear on every drupal.org page.
const NOISE_SELECTORS = [
  'script',
  'style',
  'iframe',
  // Top nav bar
  '#nav-header',
  '#navigation-inner',
  '.region-navigation',
  '#block-system-main-menu',
  // GDPR / page-top banners
  '#drupalorg-crosssite-gdpr',
  '.region-page-top',
  // Skip links
  '#skip-link',
  // drupal.org panels: the RIGHT column is "top-right-content" and is
  // navigation/ads-only; the LEFT column holds the actual article.
  '.column-content-region.top-right-content',
  '.column-content-region-inner.top-right-content-inner',
  // Sidebar widgets (ads, section navigation)
  '.pane-drupalorg-carbon-ad-sidebar',
  '.pane-og-menu-og-single-menu-block',
  '.pane-node-links',
  // Breadcrumbs
  '.breadcrumb',
  '[class*="breadcrumb"]',
  // Footer
  '#footer',
  '.region-footer',
  '.region-page-bottom',
  // Search form
  '#search-block-form',
  // "Related content" and "Comments" panes
  '.pane-views-panes',
  '#comments',
  '.comment-wrapper',
  // Generic sidebar helpers
  'aside',
  '.sidebar',
  '.region-sidebar-first',
  '.region-sidebar-second',
].join(', ');

// ── Text extraction ────────────────────────────────────────────

/**
 * Walk a DOM node tree and collect visible text, preserving code
 * blocks and inserting newlines around block elements.
 */
function extractText($: cheerio.CheerioAPI, el: AnyNode): string {
  const parts: string[] = [];

  function walk(node: AnyNode): void {
    if (node.type === 'text') {
      parts.push((node as DomText).data ?? '');
      return;
    }

    if (node.type !== 'tag') return;

    const tagNode = node as DomElement;
    const tag = tagNode.tagName?.toLowerCase() ?? '';

    // Already removed by cheerio, but double-guard
    if (['script', 'style', 'iframe'].includes(tag)) return;

    // Preserve code blocks verbatim
    if (tag === 'pre' || tag === 'code') {
      const code = $(tagNode).text().trim();
      if (code.length > 0) {
        parts.push(`\n\`\`\`\n${code}\n\`\`\`\n`);
      }
      return;
    }

    // Block-level elements get surrounding newlines
    const isBlock = ['p', 'div', 'li', 'blockquote', 'td', 'th', 'dt', 'dd'].includes(tag);

    // Headings get a markdown-style prefix so splitIntoSections can locate them
    const headingPrefix: Record<string, string> = {
      h1: '\n# ',
      h2: '\n## ',
      h3: '\n### ',
      h4: '\n#### ',
      h5: '\n##### ',
      h6: '\n###### ',
    };
    const hPrefix = headingPrefix[tag];

    if (isBlock) parts.push('\n');
    if (hPrefix) parts.push(hPrefix);

    for (const child of tagNode.children ?? []) {
      walk(child);
    }

    if (isBlock || hPrefix) parts.push('\n');
  }

  walk(el);

  return parts
    .join('')
    .replace(/[ \t]+/g, ' ')               // collapse horizontal whitespace
    .replace(/(\n[ \t]*){3,}/g, '\n\n')    // collapse blank/whitespace-only lines
    .replace(/^[ \t]+$/gm, '')             // strip lines that are only spaces
    .trim();
}

// ── Section splitting ──────────────────────────────────────────

function splitIntoSections(text: string): Array<{ title: string; text: string }> {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const headingRe = /^(##|###)\s+(.+)$/gm;
  const matches = [...normalized.matchAll(headingRe)];

  if (matches.length === 0) {
    return [{ title: 'Overview', text: normalized }];
  }

  const sections: Array<{ title: string; text: string }> = [];

  // Content before the first heading → 'Overview'
  const firstStart = matches[0].index ?? 0;
  const preamble = normalized.slice(0, firstStart).trim();
  if (preamble.length > 0) {
    sections.push({ title: 'Overview', text: preamble });
  }

  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const start = current.index ?? 0;
    const end = next?.index ?? normalized.length;
    const title = (current[2] ?? 'Untitled Section').trim();
    const text = normalized.slice(start, end).trim();

    if (text.length > 0) {
      sections.push({ title, text });
    }
  }

  return sections;
}

// ── Complexity / topic detection ───────────────────────────────

function detectComplexity(filePath: string, content: string): 'beginner' | 'intermediate' | 'advanced' {
  const haystack = `${filePath}\n${content}`.toLowerCase();
  if (/getting started|basic|introduction/.test(haystack)) return 'beginner';
  if (/advanced|custom|extend/.test(haystack)) return 'advanced';
  return 'intermediate';
}

function detectTopic(moduleName: string, filePath: string, content: string): string {
  const haystack = `${moduleName}\n${filePath}\n${content}`.toLowerCase();
  if (/theme|theming|twig/.test(haystack)) return 'theming';
  if (/\bhook\b|hooks/.test(haystack)) return 'hooks';
  if (/api|endpoint|rest|jsonapi/.test(haystack)) return 'api';
  if (/config|configuration|settings/.test(haystack)) return 'configuration';
  return 'general';
}

// ── Quality filters ────────────────────────────────────────────

/**
 * Return true if a section chunk has enough substantive prose to be
 * worth embedding.  Rejects chunks that are:
 *   - too short (< 100 chars of non-link text), or
 *   - more than 80 % link syntax (pure navigation lists).
 */
function isSubstantiveChunk(text: string): boolean {
  // Strip markdown link syntax [label](url) → keep label only
  const stripped = text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped.length < 100) return false;

  // If the majority of content is link syntax, it's a nav list
  const linkContentLen = (text.match(/\[([^\]]+)\]\([^)]+\)/g) ?? [])
    .reduce((acc, m) => acc + m.length, 0);
  const totalLen = text.replace(/\s+/g, '').length;

  if (totalLen > 0 && linkContentLen / totalLen > 0.8) return false;

  return true;
}

// ── HTML snapshot parser ───────────────────────────────────────

/**
 * Parse a "Drupal docs snapshot" .md file whose body is:
 *
 *   # Drupal docs snapshot
 *
 *   Source: https://…
 *
 *   ```html
 *   <!DOCTYPE html>…full page…
 *   ```
 *
 * Returns an array of ParsedPage objects (one per extracted section).
 */
function parseDrupalDocSnapshot(
  fileContent: string,
  relativeFilePath: string,
  moduleName: string,
): ParsedPage[] {
  // Extract source URL
  const sourceMatch = fileContent.match(/^Source:\s*(\S+)/m);
  const sourceUrl = sourceMatch?.[1] ?? '';

  // Extract raw HTML from the markdown code block
  const htmlMatch = fileContent.match(/^```html\n([\s\S]*?)\n^```/m)
    ?? fileContent.match(/```html\n([\s\S]*?)\n```/);
  if (!htmlMatch) {
    console.error(`  ⚠ No HTML block found in ${relativeFilePath} — skipping`);
    return [];
  }

  const html = htmlMatch[1];
  const $ = cheerio.load(html);

  // ── Strip all noise ──────────────────────────────────────────
  $(NOISE_SELECTORS).remove();

  // ── Find the main content container ─────────────────────────
  // On drupal.org the article body lives in the LEFT content column.
  // Fallback chain covers other layouts.
  const mainSelectors = [
    '.column-content-region.left-content',
    '.column.left-content',
    '[role="main"]',
    'main',
    '#block-system-main',
    '.layout-content',
    '#content',
    '.pane-node-body',
  ];

  let containerNode: AnyNode | undefined;
  for (const sel of mainSelectors) {
    const found = $(sel).first().get(0);
    if (found) {
      containerNode = found as AnyNode;
      break;
    }
  }
  if (!containerNode) {
    containerNode = $('body').get(0) as AnyNode;
  }

  // ── Get page title ───────────────────────────────────────────
  const pageTitle = $('h1').first().text().trim()
    || $('title').text().replace(/\s*\|.*$/, '').trim()
    || moduleName;

  // ── Extract clean text ───────────────────────────────────────
  if (!containerNode) return [];

  const rawText = extractText($, containerNode);
  if (rawText.length < 100) {
    console.error(`  ⚠ Too little content extracted from ${relativeFilePath} — skipping`);
    return [];
  }

  // ── Split into sections ──────────────────────────────────────
  const complexity = detectComplexity(relativeFilePath, rawText);
  const topic = detectTopic(moduleName, relativeFilePath, rawText);
  const sections = splitIntoSections(rawText);

  const pages: ParsedPage[] = [];

  for (const section of sections) {
    if (!isSubstantiveChunk(section.text)) continue;

    const sectionText = [
      `Title: ${pageTitle}`,
      `Module: ${moduleName}`,
      `Complexity: ${complexity}`,
      `Topic: ${topic}`,
      sourceUrl ? `Source: ${sourceUrl}` : '',
      '',
      section.text,
    ]
      .filter(Boolean)
      .join('\n');

    pages.push({
      text: sectionText,
      metadata: {
        source: TUTORIALS_SOURCE,
        symbol_name: moduleName,
        fqcn: `${topic}:${complexity}`,
        file_path: relativeFilePath,
        drupal_version: 'all',
        section: section.title,
        ingested_at: new Date().toISOString(),
      },
    });
  }

  return pages;
}

// ── Plain markdown parser (fallback for non-HTML files) ────────

function parsePlainMarkdown(
  content: string,
  relativeFilePath: string,
  moduleName: string,
): ParsedPage[] {
  // Extract optional Source URL from snapshot header (Jina-fetched files)
  const sourceMatch = content.match(/^Source:\s*(\S+)/m);
  const sourceUrl = sourceMatch?.[1] ?? '';

  const complexity = detectComplexity(relativeFilePath, content);
  const topic = detectTopic(moduleName, relativeFilePath, content);
  const sections = splitIntoSections(content);
  const pages: ParsedPage[] = [];

  for (const section of sections) {
    if (!isSubstantiveChunk(section.text)) continue;

    const sectionText = [
      `Module: ${moduleName}`,
      `Complexity: ${complexity}`,
      `Topic: ${topic}`,
      sourceUrl ? `Source: ${sourceUrl}` : '',
      '',
      section.text,
    ]
      .filter(Boolean)
      .join('\n');

    pages.push({
      text: sectionText,
      metadata: {
        source: TUTORIALS_SOURCE,
        symbol_name: moduleName,
        fqcn: `${topic}:${complexity}`,
        file_path: relativeFilePath,
        drupal_version: 'all',
        section: section.title,
        ingested_at: new Date().toISOString(),
      },
    });
  }

  return pages;
}

// ── File collection ────────────────────────────────────────────

function isMarkdownFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.md') || lower === 'readme';
}

async function collectMarkdownFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && isMarkdownFile(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

// ── Public entry point ─────────────────────────────────────────

export async function parseTutorials(sourcesDir: string): Promise<ParsedPage[]> {
  const tutorialsDir = path.join(sourcesDir, 'tutorials');

  try {
    await access(tutorialsDir);
  } catch {
    console.error(`⚠ Tutorials directory not found at ${tutorialsDir} — skipping`);
    return [];
  }

  const entries = await readdir(tutorialsDir, { withFileTypes: true });
  const moduleDirs = entries.filter((entry) => entry.isDirectory());

  if (moduleDirs.length === 0) {
    console.error(`⚠ No module/tutorial directories found in ${tutorialsDir}`);
    return [];
  }

  const pages: ParsedPage[] = [];
  let filesProcessed = 0;
  let htmlSnapshots = 0;
  let plainMarkdown = 0;

  for (const moduleDir of moduleDirs) {
    const moduleName = moduleDir.name;
    const modulePath = path.join(tutorialsDir, moduleName);
    const markdownFiles = await collectMarkdownFiles(modulePath);

    for (const filePath of markdownFiles) {
      const content = (await readFile(filePath, 'utf8')).trim();
      if (!content) continue;

      filesProcessed += 1;
      const relativeFilePath = path.relative(sourcesDir, filePath);

      // Detect "Drupal docs snapshot" format: file contains an embedded HTML
      // code block. Files from Jina AI start with the same header but contain
      // plain markdown — those fall through to parsePlainMarkdown.
      const isDrupalDocSnapshot = /```html\n/.test(content);

      let filePagesCount: number;

      if (isDrupalDocSnapshot) {
        const parsed = parseDrupalDocSnapshot(content, relativeFilePath, moduleName);
        pages.push(...parsed);
        filePagesCount = parsed.length;
        htmlSnapshots += 1;
      } else {
        const parsed = parsePlainMarkdown(content, relativeFilePath, moduleName);
        pages.push(...parsed);
        filePagesCount = parsed.length;
        plainMarkdown += 1;
      }

      console.error(
        `  [tutorials] ${relativeFilePath} → ${filePagesCount} section(s)`,
      );
    }
  }

  console.error(
    `Tutorials parse complete: files=${filesProcessed} ` +
    `(html_snapshots=${htmlSnapshots}, plain_md=${plainMarkdown}), ` +
    `pages=${pages.length}`,
  );

  return pages;
}
