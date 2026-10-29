/**
 * Strip drupal.org navigation chrome from fetched full-text sections.
 *
 * The change-records and security-advisories fetchers store the complete
 * Jina-rendered page under `## Full text`: ~10KB of site navigation,
 * cookie-banner, and footer junk ahead of (and after) a few KB of actual
 * record body. Left in place, that chrome pollutes FTS and chunks (every
 * record scores on "eCommerce", "Healthcare", menu link text...).
 *
 * Both page templates have the same shape:
 *
 *   ## Full text
 *   Title: ... / URL Source: ... / Markdown Content:   <- Jina header
 *   [nav junk: menus, cookie banner]                   <- cut
 *   [body anchor: metadata block ("Change record status:", "Description:",
 *    "Project:", ...) or the record's own H1]          <- keep from here
 *   [body]
 *   #### <footer heading> + legal links + trademark    <- cut (only when a
 *                                                         trademark line
 *                                                         sits near EOF)
 *
 * Advisory credit lists (security-team members) are body content and are
 * preserved: the footer cut only triggers on a trademark line near the end
 * of the file, which advisory pages without that footer simply don't have.
 *
 * Idempotent: cleaned files no longer contain `Markdown Content:` and are
 * skipped on re-run. Re-run after every fetch pass that adds full text.
 *
 * Usage:
 *   npx tsx scripts/curate-chrome.ts
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TARGETS = [
  'data/sources/change-records/records',
  'data/sources/security-advisories',
] as const;

const FULL_TEXT_MARKER = '\n## Full text\n';
const JINA_HEADER = 'Markdown Content:';

// Body-start anchors, in page order. Metadata labels cover both templates;
// `# ` covers change-record pages whose title H1 precedes the metadata.
const BODY_ANCHOR = /^(?:Change record status:|Description:|Project:|Date:|Security risk:|CVE IDs:|Versions affected:|Solution:|Impacts:|# )/m;

function isTrademarkFooter(lines: string[], trademarkIdx: number): boolean {
  return trademarkIdx >= lines.length - 15;
}

async function curateFile(filePath: string): Promise<{ changed: boolean; bytesSaved: number }> {
  const original = await readFile(filePath, 'utf8');
  const split = original.indexOf(FULL_TEXT_MARKER);
  if (split === -1) return { changed: false, bytesSaved: 0 };
  const head = original.slice(0, split);
  let tail = original.slice(split + FULL_TEXT_MARKER.length);

  const jinaIdx = tail.indexOf(JINA_HEADER);
  if (jinaIdx === -1) return { changed: false, bytesSaved: 0 }; // already curated

  const afterJina = tail.slice(jinaIdx + JINA_HEADER.length);
  const anchorMatch = afterJina.match(BODY_ANCHOR);
  if (!anchorMatch || anchorMatch.index === undefined) return { changed: false, bytesSaved: 0 };
  let body = afterJina.slice(anchorMatch.index);

  // Footer cut: only a trademark line near EOF, trimmed back to the footer
  // heading that introduces it.
  const lines = body.split('\n');
  const trademarkIdx = lines.findIndex(line => line.includes('registered trademark'));
  if (trademarkIdx !== -1 && isTrademarkFooter(lines, trademarkIdx)) {
    let cutFrom = trademarkIdx;
    for (let i = trademarkIdx; i >= 0; i -= 1) {
      if (/^#{2,4} /.test(lines[i])) { cutFrom = i; break; }
    }
    body = lines.slice(0, cutFrom).join('\n').trimEnd() + '\n';
  }

  const cleaned = `${head}${FULL_TEXT_MARKER}\n${body.trimStart()}`;
  if (cleaned === original) return { changed: false, bytesSaved: 0 };
  await writeFile(filePath, cleaned, 'utf8');
  return { changed: true, bytesSaved: original.length - cleaned.length };
}

async function main(): Promise<void> {
  for (const dir of TARGETS) {
    let files: string[];
    try {
      files = (await readdir(dir)).filter(f => f.endsWith('.md'));
    } catch {
      console.log(`${dir}: absent, skipping`);
      continue;
    }
    let changed = 0;
    let bytesSaved = 0;
    for (const name of files) {
      try {
        const result = await curateFile(path.join(dir, name));
        if (result.changed) {
          changed += 1;
          bytesSaved += result.bytesSaved;
        }
      } catch (error) {
        console.log(`  ⚠ ${name}: ${error instanceof Error ? error.message : error}`);
      }
    }
    const kb = Math.round(bytesSaved / 102.4) / 10;
    console.log(`${dir}: ${changed}/${files.length} files cleaned, ${kb}KB chrome removed`);
  }
}

void main();
