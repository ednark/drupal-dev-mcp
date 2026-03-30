import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import type { AnyNode, Element as DomElement, Text as DomText } from 'domhandler';
import type { ParsedPage, SourceMetadata } from './parser.js';

const SOURCE_NAME = 'api_drupal_org';
const SOURCE_DIR = 'data/sources/api-drupal-org';
const BASE_URL = 'https://api.drupal.org';

/**
 * Reconstruct the canonical api.drupal.org URL from a group-name filename.
 * The HTML files are named {group-name}.html and correspond to:
 * https://api.drupal.org/api/drupal/{module-path}/group/{group-name}/11.x
 *
 * Since we do not store the module path, we use the groups listing URL as fallback.
 */
function buildUrlFromFilename(filename: string): string {
  const groupName = path.basename(filename, '.html');
  return `${BASE_URL}/api/drupal/groups/11.x#${groupName}`;
}

/**
 * Extract visible plain text from a cheerio element tree,
 * keeping code blocks intact and collapsing whitespace.
 */
function extractText($: cheerio.CheerioAPI, el: AnyNode): string {
  const parts: string[] = [];

  function walk(node: AnyNode) {
    if (node.type === 'text') {
      const text = (node as DomText).data ?? '';
      parts.push(text);
      return;
    }

    if (node.type !== 'tag') return;

    const tagNode = node as DomElement;
    const tag = tagNode.tagName?.toLowerCase() ?? '';

    if (['script', 'style', 'nav', 'header', 'footer'].includes(tag)) return;

    if (tag === 'pre' || tag === 'code') {
      const code = $(tagNode).text();
      parts.push(`\n\`\`\`\n${code}\n\`\`\`\n`);
      return;
    }

    if (['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'td', 'th'].includes(tag)) {
      parts.push('\n');
    }

    for (const child of tagNode.children ?? []) {
      walk(child);
    }

    if (['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr'].includes(tag)) {
      parts.push('\n');
    }
  }

  walk(el);

  return parts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse one api.drupal.org group/topic HTML file into structured sections.
 */
function parseHtmlFile(
  html: string,
  filePath: string,
): ParsedPage[] {
  const $ = cheerio.load(html);
  const pages: ParsedPage[] = [];

  // ── Title ──────────────────────────────────────────────────────
  const rawTitle = $('h1').first().text().trim();
  const title = rawTitle || path.basename(filePath, '.html');

  // ── Build canonical URL ─────────────────────────────────────────
  const url = buildUrlFromFilename(filePath);

  // ── Introduction: paragraphs/lists before first h3 ────────────
  const mainContent = $('main, .block-system-main-block, #content, article').first();
  const container = mainContent.length ? mainContent : $('body');

  const introLines: string[] = [];
  let hitH3 = false;

  container.children().each((_i, el) => {
    if (hitH3) return;
    const tagName = (el as DomElement).tagName?.toLowerCase() ?? '';
    if (tagName === 'h3' || tagName === 'h2') {
      hitH3 = true;
      return;
    }
    if (['p', 'ul', 'ol', 'blockquote'].includes(tagName)) {
      const text = extractText($, el);
      if (text.length > 0) {
        introLines.push(text);
      }
    }
  });

  const introText = introLines.join('\n\n').trim();

  // ── Code blocks with surrounding context ──────────────────────
  const codeBlocks: string[] = [];
  $('pre, code').each((_i, el) => {
    const code = $(el).text().trim();
    if (code.length < 10) return;
    const parent = $(el).parent();
    const contextBefore = parent.prev('p').text().trim();
    const block = contextBefore
      ? `${contextBefore}\n\`\`\`\n${code}\n\`\`\``
      : `\`\`\`\n${code}\n\`\`\``;
    codeBlocks.push(block);
  });

  // ── Functions/hooks table ──────────────────────────────────────
  const tableRows: string[] = [];
  $('table').each((_i, table) => {
    $(table)
      .find('tr')
      .each((_j, row) => {
        const cells = $(row).find('td, th');
        if (cells.length >= 2) {
          const name = $(cells[0]).text().trim();
          const summary = $(cells[1]).text().trim();
          if (name && summary) {
            tableRows.push(`${name}: ${summary}`);
          }
        }
      });
  });

  const tableText = tableRows.length > 0
    ? `\nRelated functions/hooks/classes:\n${tableRows.join('\n')}`
    : '';

  // ── Assemble full content ──────────────────────────────────────
  const bodyParts: string[] = [];
  if (introText) bodyParts.push(introText);
  if (codeBlocks.length > 0) bodyParts.push(codeBlocks.join('\n\n'));
  if (tableText) bodyParts.push(tableText);

  const fullContent = bodyParts.join('\n\n').trim();
  if (fullContent.length < 50) return pages;

  const metadata: SourceMetadata = {
    source: SOURCE_NAME,
    symbol_name: title,
    fqcn: null,
    file_path: filePath,
    drupal_version: '11.x',
    section: title,
    ingested_at: new Date().toISOString(),
  };

  // ── Split into sub-sections at h3 boundaries if page is large ─
  // Collect h3 sections for richer, smaller chunks
  const sections: Array<{ heading: string; text: string }> = [];

  let currentHeading = title;
  const currentLines: string[] = [];
  if (introText) currentLines.push(introText);

  container.find('h3, h2').each((_i, headingEl) => {
    // Save whatever we have
    if (currentLines.length > 0) {
      sections.push({ heading: currentHeading, text: currentLines.join('\n\n') });
      currentLines.length = 0;
    }
    currentHeading = $(headingEl).text().trim() || currentHeading;

    // Gather sibling content until next heading
    let sibling = $(headingEl).next();
    while (sibling.length && !['h2', 'h3'].includes(sibling[0]?.tagName?.toLowerCase() ?? '')) {
      const tagName = (sibling[0] as DomElement)?.tagName?.toLowerCase() ?? '';
      if (['p', 'ul', 'ol', 'pre', 'code', 'table', 'blockquote', 'div'].includes(tagName)) {
        const text = extractText($, sibling[0] as AnyNode);
        if (text.trim().length > 0) {
          currentLines.push(text.trim());
        }
      }
      sibling = sibling.next();
    }
  });

  // Flush last section
  if (currentLines.length > 0) {
    sections.push({ heading: currentHeading, text: currentLines.join('\n\n') });
  }

  // Add table rows to the last section or as its own
  if (tableText) {
    sections.push({ heading: `${title} — API Reference`, text: tableText.trim() });
  }

  // If no h3 sections found, fall back to the full content as one page
  if (sections.length === 0) {
    pages.push({
      text: `# ${title}\n\nSource: ${url}\n\n${fullContent}`,
      metadata,
    });
    return pages;
  }

  for (const section of sections) {
    const sectionText = `# ${title} — ${section.heading}\n\nSource: ${url}\n\n${section.text}`;
    if (sectionText.trim().length < 50) continue;

    pages.push({
      text: sectionText,
      metadata: {
        ...metadata,
        section: section.heading,
      },
    });
  }

  return pages;
}

/**
 * Parse a Jina-fetched Markdown file for api.drupal.org into ParsedPage objects.
 * Splits at top-level markdown headings (#, ##) and produces one page per section.
 */
function parseMdFile(md: string, filePath: string): ParsedPage[] {
  const pages: ParsedPage[] = [];

  // Extract title from first # heading or filename
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? path.basename(filePath, '.md');

  // Extract source URL from the snapshot header comment
  const sourceUrlMatch = md.match(/<!--\s*source:\s*(.+?)\s*-->/);
  const url = sourceUrlMatch?.[1]?.trim() ?? `${BASE_URL}/api/drupal/groups/11.x`;

  // Split by markdown headings (# or ##)
  const sections = md.split(/^(?=#{1,2} )/m).filter((s) => s.trim().length > 50);

  if (sections.length === 0) {
    // Fallback: whole file as one page
    if (md.trim().length >= 50) {
      pages.push({
        text: `# ${title}\n\nSource: ${url}\n\n${md.trim()}`,
        metadata: {
          source: SOURCE_NAME,
          symbol_name: title,
          fqcn: null,
          file_path: filePath,
          drupal_version: '11.x',
          section: title,
          ingested_at: new Date().toISOString(),
        } as SourceMetadata,
      });
    }
    return pages;
  }

  for (const section of sections) {
    const headingMatch = section.match(/^#{1,2}\s+(.+)$/m);
    const sectionTitle = headingMatch?.[1]?.trim() ?? title;
    const sectionText = section.trim();

    if (sectionText.length < 50) continue;

    pages.push({
      text: `# ${title} — ${sectionTitle}\n\nSource: ${url}\n\n${sectionText}`,
      metadata: {
        source: SOURCE_NAME,
        symbol_name: sectionTitle,
        fqcn: null,
        file_path: filePath,
        drupal_version: '11.x',
        section: sectionTitle,
        ingested_at: new Date().toISOString(),
      } as SourceMetadata,
    });
  }

  return pages;
}

/**
 * Parse all api.drupal.org topic files (HTML and Markdown) into ParsedPage objects.
 *
 * Files starting with `_` (index pages) are skipped.
 * HTML files are parsed with the Cheerio-based parser.
 * Markdown (.md) files fetched via Jina are parsed as plain markdown.
 */
export async function parseApiDrupalOrgDocs(sourcesDir?: string): Promise<ParsedPage[]> {
  const apiDir = path.resolve(sourcesDir
    ? path.join(sourcesDir, 'api-drupal-org')
    : SOURCE_DIR,
  );

  try {
    await access(apiDir);
  }
  catch {
    console.warn(`⚠ api.drupal.org source directory not found at ${apiDir} — skipping`);
    return [];
  }

  const entries = await readdir(apiDir, { withFileTypes: true });

  const htmlFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.html') &&
        !entry.name.startsWith('_'),
    )
    .map((entry) => path.join(apiDir, entry.name));

  const mdFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.md') &&
        !entry.name.startsWith('_'),
    )
    .map((entry) => path.join(apiDir, entry.name));

  if (htmlFiles.length === 0 && mdFiles.length === 0) {
    console.warn(`⚠ No topic files found in ${apiDir}`);
    return [];
  }

  const pages: ParsedPage[] = [];

  for (const filePath of htmlFiles) {
    try {
      const html = await readFile(filePath, 'utf8');
      const parsed = parseHtmlFile(html, filePath);
      pages.push(...parsed);
    }
    catch (err) {
      console.warn(`⚠ Failed to parse ${filePath}: ${(err as Error).message}`);
    }
  }

  for (const filePath of mdFiles) {
    try {
      const md = await readFile(filePath, 'utf8');
      const parsed = parseMdFile(md, filePath);
      pages.push(...parsed);
    }
    catch (err) {
      console.warn(`⚠ Failed to parse ${filePath}: ${(err as Error).message}`);
    }
  }

  console.error(
    `api.drupal.org parse complete: htmlFiles=${htmlFiles.length}, mdFiles=${mdFiles.length}, pages=${pages.length}`,
  );

  return pages;
}
