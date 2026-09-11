/**
 * Split the single-file PHP manual (data/sources/php-manual/php_manual_en.html,
 * ~65 MB) into per-reference markdown files under data/sources/php-manual/sections/.
 *
 * The knowledge builder's discovery walks that directory, but the monolithic
 * HTML file exceeds its 500 KB size cap and is raw HTML, so it was silently
 * skipped (php_docs: 0 documents). This script performs one-time extraction:
 *
 *   - Splits the manual at <div class="refnamediv"> boundaries (each reference
 *     entry: function, class, language section).
 *   - Converts each entry to lightweight markdown (headings, paragraphs, code
 *     blocks, lists) with plain string operations — no DOM dependency, since
 *     parsing 65 MB with cheerio is impractical.
 *   - Filters entries for Drupal relevance (array/string/OOP/regex/date/PDO/
 *     exception keywords...), mirroring the keyword list from the legacy
 *     etl/parse-php-manual.ts. The full manual (~10K entries) would mostly be
 *     noise for Drupal work; the filtered set is what a Drupal backend dev needs.
 *
 * Usage:
 *   npx tsx scripts/split-php-manual.ts
 */

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const MANUAL = 'data/sources/php-manual/php_manual_en.html';
const OUT_DIR = 'data/sources/php-manual/sections';

const DRUPAL_RELEVANT_KEYWORDS = [
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
  'superglobal', 'variable', 'constant', 'operator', 'foreach', 'function',
];

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&rarr;/g, '->')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/** Converts a block of manual HTML to markdown-ish plain text. */
function htmlToMarkdown(html: string): string {
  const codeBlocks: string[] = [];
  // Preserve code samples verbatim before generic tag stripping.
  let working = html.replace(/<(pre|div class="phpcode"|div class="example-contents")((?:(?!<\/\1)[\s\S])*?)<\/\1>/g, (_, tag: string, inner: string) => {
    const code = decodeEntities(inner.replace(/<[^>]+>/g, '')).trim();
    if (!code) return '';
    codeBlocks.push(code);
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });

  working = working
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/g, (_, t: string) => `\n# ${t.trim()}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, (_, t: string) => `\n## ${t.trim()}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/g, (_, t: string) => `\n### ${t.trim()}\n`)
    .replace(/<h[45][^>]*>([\s\S]*?)<\/h[45]>/g, (_, t: string) => `\n#### ${t.trim()}\n`)
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/g, '**$2**')
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/g, '*$2*')
    .replace(/<var[^>]*>([\s\S]*?)<\/var>/g, '`$1`')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/g, '`$1`')
    .replace(/<li[^>]*>/g, '\n- ')
    .replace(/<\/?(p|div|ul|ol|dl|dd|dt|table|tr|td|th|tbody|section)[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '');

  working = decodeEntities(working)
    .split('\n').map(line => line.trimEnd()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  // Restore code blocks as fenced markdown.
  working = working.replace(/\u0000CODE(\d+)\u0000/g, (_, index: string) => `\n\`\`\`php\n${codeBlocks[Number(index)]}\n\`\`\`\n`);
  return working;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_:.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'untitled';
}

function isRelevant(title: string): boolean {
  const lower = title.toLowerCase();
  return DRUPAL_RELEVANT_KEYWORDS.some(keyword => lower.includes(keyword));
}

async function main(): Promise<void> {
  const html = await readFile(MANUAL, 'utf8');
  await mkdir(OUT_DIR, { recursive: true });

  // Each reference entry begins at its refnamediv; the entry runs until the next one.
  const parts = html.split('<div class="refnamediv">');
  console.log(`Manual split into ${parts.length - 1} reference entries`);

  const existing = new Set(await readdir(OUT_DIR).catch(() => [] as string[]));
  let written = 0;
  let skippedIrrelevant = 0;
  let skippedTiny = 0;
  const usedNames = new Set<string>(existing);

  for (let i = 1; i < parts.length; i += 1) {
    const entryHtml = parts[i];
    const title = (entryHtml.match(/<h1 class="refname">([\s\S]*?)<\/h1>/)?.[1] ?? '')
      .replace(/<[^>]+>/g, '').trim();
    if (!title) continue;
    if (!isRelevant(title)) { skippedIrrelevant += 1; continue; }

    const markdown = htmlToMarkdown(entryHtml);
    if (markdown.length < 200) { skippedTiny += 1; continue; }

    let slug = slugify(title);
    while (usedNames.has(`${slug}.md`)) slug = `${slug}-alt`;
    usedNames.add(`${slug}.md`);

    const header = `# ${title}\n\nSource: PHP Manual (php.net)\n\n`;
    await writeFile(path.join(OUT_DIR, `${slug}.md`), header + markdown, 'utf8');
    written += 1;
  }

  console.log(`Written      : ${written}`);
  console.log(`Irrelevant   : ${skippedIrrelevant} (filtered by Drupal relevance)`);
  console.log(`Too tiny     : ${skippedTiny}`);
  console.log(`Output       : ${OUT_DIR}`);
}

void main();
