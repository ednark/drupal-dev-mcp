import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import type { ParsedPage, SourceMetadata } from './parser.js';

const SOURCE_NAME = 'php_docs';
const MAX_SECTIONS = 5000;

/** Keywords that indicate a PHP manual section is relevant to Drupal development. */
const DRUPAL_RELEVANT_KEYWORDS: string[] = [
  'array', 'string', 'str_', 'json', 'class', 'interface', 'trait',
  'abstract', 'final', 'static', 'namespace', 'use', 'extends', 'implements',
  'yield', 'generator', 'closure', 'callable', 'type', 'iterator', 'spl',
  'exception', 'error', 'throw', 'try', 'catch', 'finally',
  'preg_', 'regex', 'date', 'datetime', 'time',
  'file', 'directory', 'path',
  'render', 'twig', 'template', 'object', 'stdclass',
  'serialize', 'unserialize', 'hash', 'crypto', 'password',
  'filter', 'sanitize', 'escape', 'html', 'url', 'http', 'curl',
  'stream', 'pdo', 'database', 'sql', 'query',
  'late static', 'autoload', 'composer', 'dependency', 'injection',
  'oop', 'magic',
  '__construct', '__destruct', '__call', '__get', '__set', '__toString', '__invoke',
  'reflection', 'anonymous',
];

/**
 * Returns true if the given PHP manual section title or content is relevant
 * to Drupal development.
 */
function isDrupalRelevantSection(title: string, content: string): boolean {
  const lowerTitle = title.toLowerCase();
  for (const keyword of DRUPAL_RELEVANT_KEYWORDS) {
    if (lowerTitle.includes(keyword)) {
      return true;
    }
  }

  const preview = content.slice(0, 500);
  if (preview.includes('Drupal') || preview.includes('\\Drupal') || preview.includes('drupal_')) {
    return true;
  }

  return false;
}

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectFunctionName(title: string): string | null {
  const fn = title.match(/\b([a-zA-Z_][\w]*)\s*\(\s*\)/);
  if (fn?.[1]) {
    return fn[1];
  }

  const method = title.match(/\b([A-Z][\w]*)::([a-zA-Z_][\w]*)\s*\(\s*\)/);
  if (method?.[0]) {
    return method[0].replace(/\s+/g, '');
  }

  return null;
}

function splitHtmlByHeadings(html: string): string[] {
  const parts = html.split(/(?=<h[23][^>]*>)/i);
  return parts.filter((part) => part.trim().length > 0);
}

export async function parsePHPManual(sourcesDir: string): Promise<ParsedPage[]> {
  const manualPath = path.join(sourcesDir, 'php-manual', 'php_manual_en.html');

  try {
    await access(manualPath);
  }
  catch {
    console.warn(`⚠ PHP manual source file not found at ${manualPath} — skipping`);
    return [];
  }

  const html = await readFile(manualPath, 'utf8');
  const blocks = splitHtmlByHeadings(html).slice(0, MAX_SECTIONS);

  const pages: ParsedPage[] = [];
  let totalSectionsFound = 0;
  let keptSections = 0;

  for (const block of blocks) {
    totalSectionsFound += 1;

    const $ = cheerio.load(block);
    const heading = $('h2, h3').first();
    const headingText = heading.text().replace(/\s+/g, ' ').trim();
    const sectionTitle = headingText || 'Untitled Section';

    const cleanText = stripHtmlTags($.html() ?? block);
    if (cleanText.length < 50) {
      continue;
    }

    // Relevance filter: only keep sections related to Drupal development
    if (!isDrupalRelevantSection(sectionTitle, cleanText)) {
      continue;
    }

    keptSections += 1;

    const functionName = detectFunctionName(sectionTitle);
    pages.push({
      text: cleanText,
      metadata: {
        source: SOURCE_NAME,
        symbol_name: functionName || sectionTitle,
        fqcn: null,
        file_path: 'php_manual_en.html',
        drupal_version: 'php-8.x',
        section: sectionTitle,
        ingested_at: new Date().toISOString(),
      } as SourceMetadata,
    });

    if (pages.length >= MAX_SECTIONS) {
      break;
    }
  }

  console.error(
    `php_docs: kept ${keptSections}/${totalSectionsFound} sections after relevance filter`,
  );
  console.error(`PHP manual parse complete: sections=${totalSectionsFound}, pages=${pages.length}`);
  return pages;
}
