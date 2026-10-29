/**
 * Fetch Drupal core security advisories into the corpus.
 *
 * Design decisions (see docs/plans or the sidecar plan):
 *   - CORE-ONLY: filters the drupal.org/security listing to SA-CORE-* entries.
 *     Contrib advisories are deliberately out of scope for now (volume +
 *     per-project relevance); revisit via the sidecar plan.
 *   - CORPUS-ONLY: writes one markdown file per advisory under
 *     data/sources/security-advisories/ — no sidecar DB, no new server
 *     surface. Freshness is capped at fetch+rebuild cadence; companion doc
 *     drupal-validation-tooling/05 tells agents to check get_index_status.
 *   - REVISION-AWARE: advisories get revised (scope corrections, followup
 *     "bypass" advisories). Unlike the change-records fetcher, an existing
 *     file whose advisory body changed on drupal.org is REWRITTEN, not
 *     skipped. Comparison hashes the full-text section only, so timestamp
 *     noise cannot trigger rewrites.
 *
 * The listing is fetched via the Jina reader (drupal.org blocks direct
 * scraping; same pattern as fetch-change-records.ts). Cron-friendly: default
 * run fetches page 0 of the listing, writes new advisories, refreshes the
 * most recent ones for revisions, exits 0 quietly when nothing changed.
 *
 * Usage:
 *   npx tsx scripts/fetch-security-advisories.ts [--pages=1] [--no-full-text] [--check-only]
 */

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const OUT_DIR = 'data/sources/security-advisories';
const LISTING_URL = 'https://www.drupal.org/security';
const CORE_PATTERN = /sa-core-/i;
const FULL_TEXT_MARKER = '\n## Full text\n';
const FULL_TEXT_CAP = 100_000;
const FETCH_DELAY_MS = 1_500;
const REVISION_REFRESH_COUNT = 20; // refresh the N most recent advisories each run

interface AdvisoryListing {
  advisoryId: string;   // e.g. SA-CORE-2026-004
  title: string;
  url: string;          // canonical alias, e.g. https://www.drupal.org/sa-core-2026-004
  project: string;      // 'drupal' for core
  date: string;
  risk: string;
  cve: string;
  summary: string;      // listing-page description text
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Adaptive politeness: back off (up to 60s) when the reader proxy throttles
// us, return to the base delay after a success. Shared by listing and
// advisory fetches within one run.
let currentDelay = FETCH_DELAY_MS;

function currentFetchDelay(): number {
  return currentDelay;
}

function noteFetchSucceeded(): void {
  currentDelay = FETCH_DELAY_MS;
}

function noteFetchFailed(): void {
  currentDelay = Math.min(currentDelay * 2, 60_000);
}

async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        'User-Agent': 'DrupalDevMCP/1.0 (+https://github.com/example/drupal-dev-mcp)',
        'Accept': 'text/markdown, text/plain, */*',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      noteFetchFailed();
      return null;
    }
    const text = await res.text();
    noteFetchSucceeded();
    return text;
  } catch {
    noteFetchFailed();
    return null;
  }
}

function capFullText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= FULL_TEXT_CAP) return trimmed;
  return `${trimmed.slice(0, FULL_TEXT_CAP)}\n\n[Truncated at ${FULL_TEXT_CAP} characters — read the full advisory at the link above.]`;
}

/**
 * Parses the listing page. Advisory headings look like:
 *   ## [Media Alias Display - Moderately critical - Information disclosure - SA-CONTRIB-2026-292](https://www.drupal.org/sa-contrib-2026-292)
 * followed by Project machine name / Date / Security risk / CVE IDs / description.
 * The heading carries the risk and type; the trailing `- SA-XXXX-YYYY-NNN` is the id.
 */
function parseListing(markdown: string): { advisories: AdvisoryListing[]; totalHeadings: number } {
  const advisories: AdvisoryListing[] = [];
  const headingPattern = /^## \[([^\]]+)\]\((https:\/\/www\.drupal\.org\/sa-[a-z0-9-]+)\)/gm;
  const headings: Array<{ title: string; url: string; index: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(markdown)) !== null) {
    headings.push({ title: match[1].trim(), url: match[2], index: match.index, end: match.index + match[0].length });
  }
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    const advisoryId = heading.title.match(/([A-Za-z]+(?:-[A-Za-z]+)*-\d{4}-\d{3,4})\s*$/)?.[1] ?? '';
    if (!CORE_PATTERN.test(heading.url) && !/^SA-CORE/i.test(advisoryId)) continue;

    const block = markdown.slice(heading.end, headings[i + 1]?.index ?? markdown.length);
    const FIELD_LABELS = ['Project machine name', 'Date', 'Security risk', 'CVE IDs'] as const;
    const value = (label: string): string => {
      const match = block.match(new RegExp(`^${label}:\\s*$`, 'im'));
      if (!match || match.index === undefined) return '';
      const rest = block.slice(block.indexOf('\n', match.index) + 1);
      const nextField = rest.search(/^(?:Project machine name|Date|Security risk|CVE IDs):/im);
      const fieldBlock = nextField === -1 ? rest : rest.slice(0, nextField);
      return fieldBlock.replace(/`/g, '').trim();
    };
    // Description: everything after the labeled fields, up to the next heading.
    const parts = block.split(/^(?:Project machine name|Date|Security risk|CVE IDs):/im);
    const description = (parts[parts.length - 1] ?? '').trim();
    const title = heading.title.replace(new RegExp(`\\s*[-–]\\s*${advisoryId}\\s*$`), '').trim();

    advisories.push({
      advisoryId,
      title,
      url: heading.url,
      project: value('Project machine name') || 'drupal',
      date: value('Date'),
      risk: value('Security risk'),
      cve: value('CVE IDs'),
      summary: description,
    });
  }
  return { advisories, totalHeadings: headings.length };
}

function advisoryIdFromFilename(filename: string): string | null {
  return filename.match(/^(sa-[a-z]+-\d{4}-\d{3,4})\.md$/i)?.[1] ?? null;
}

function filenameFor(advisoryId: string): string {
  return `${advisoryId.toLowerCase()}.md`;
}

function hashFullText(body: string): string {
  const start = body.indexOf(FULL_TEXT_MARKER);
  const text = start === -1 ? '' : body.slice(start + FULL_TEXT_MARKER.length);
  return createHash('sha256').update(text).digest('hex');
}

function buildBody(advisory: AdvisoryListing, fullText: string | null): string {
  const summaryBody = [
    `# ${advisory.title} - ${advisory.advisoryId}`,
    '',
    `**Source**: ${advisory.url}`,
    `**Advisory ID**: ${advisory.advisoryId}`,
    `**Project**: ${advisory.project}`,
    `**Date**: ${advisory.date}`,
    `**Security risk**: ${advisory.risk}`,
    `**CVE IDs**: ${advisory.cve}`,
    '',
    advisory.summary,
    '',
    `Full advisory: ${advisory.url}`,
    '',
  ].join('\n');
  if (!fullText) return summaryBody;
  return `${summaryBody}${FULL_TEXT_MARKER}\n${fullText}\n`;
}

async function fetchFullText(url: string): Promise<string | null> {
  const markdown = await fetchViaJina(url);
  if (!markdown || markdown.trim().length < 200) return null;
  return capFullText(markdown);
}

async function main(): Promise<void> {
  const pagesArg = process.argv.find(arg => arg.startsWith('--pages='));
  // Core advisories are sparse (~6-8/year) inside a mixed listing: the cron
  // default scans a few months; backfills pass a larger --pages.
  const pages = pagesArg ? Number(pagesArg.split('=')[1]) : 4;
  const noFullText = process.argv.includes('--no-full-text');
  const checkOnly = process.argv.includes('--check-only');

  await mkdir(OUT_DIR, { recursive: true });
  const existingFiles = new Set(await readdir(OUT_DIR).catch(() => [] as string[]));
  const existingHashes = new Map<string, string>();
  for (const name of existingFiles) {
    const id = advisoryIdFromFilename(name);
    if (!id) continue;
    existingHashes.set(id, hashFullText(await readFile(path.join(OUT_DIR, name), 'utf8').catch(() => '')));
  }

  const all: AdvisoryListing[] = [];
  let failedPages = 0;
  let stopReason = 'page budget reached';
  for (let page = 0; page < pages; page += 1) {
    process.stdout.write(`  ↓ listing page ${page} ... `);
    const markdown = await fetchViaJina(page === 0 ? LISTING_URL : `${LISTING_URL}?page=${page}`);
    if (!markdown) {
      console.log('✗ (fetch failed)');
      failedPages += 1;
      if (failedPages >= 3) { console.log('  Too many failed pages; stopping early.'); break; }
      continue;
    }
    const { advisories, totalHeadings } = parseListing(markdown);
    if (totalHeadings === 0) {
      console.log('✓ (0 advisories — end of listing, stopping)');
      stopReason = 'end of listing';
      break;
    }
    all.push(...advisories);
    console.log(`✓ ${advisories.length} core of ${totalHeadings} advisories`);
    // Everything core on this page is already in the corpus: we have walked
    // past new territory, and revision refresh only covers recent items.
    if (page > 0 && advisories.length > 0 && advisories.every(advisory => existingHashes.has(advisory.advisoryId))) {
      console.log('  (all core advisories on this page already known — stopping scan)');
      stopReason = 'reached already-known advisories';
      break;
    }
    await sleep(currentFetchDelay());
  }

  const unique = new Map(all.map(advisory => [advisory.advisoryId, advisory]));
  let written = 0;
  let rewritten = 0;
  let failed = 0;

  for (const advisory of unique.values()) {
    const filename = filenameFor(advisory.advisoryId);
    const isNew = !existingFiles.has(filename);
    // Revision refresh: only re-fetch full text for recent advisories, so a
    // cron run costs at most REVISION_REFRESH_COUNT advisory fetches.
    const withinRefreshWindow = [...unique.keys()].indexOf(advisory.advisoryId) < REVISION_REFRESH_COUNT;
    if (!isNew && !withinRefreshWindow) continue;

    process.stdout.write(`  ↓ ${advisory.advisoryId} (${isNew ? 'new' : 'revision check'}) ... `);
    const fullText = noFullText ? null : await fetchFullText(advisory.url);
    if (!noFullText && !fullText) {
      console.log('✗ (full-text fetch failed; will retry next run)');
      failed += 1;
      await sleep(currentFetchDelay());
      continue;
    }
    // Degradation guard: a rate-limited or truncated fetch must never
    // replace good corpus content. A genuine revision is the same advisory
    // page — roughly the same size. Refuse rewrites that shrink the stored
    // text by more than 40%.
    if (!isNew && fullText) {
      const existingBody = await readFile(path.join(OUT_DIR, filename), 'utf8').catch(() => '');
      const existingStart = existingBody.indexOf(FULL_TEXT_MARKER);
      const existingText = existingStart === -1 ? '' : existingBody.slice(existingStart + FULL_TEXT_MARKER.length);
      if (existingText && fullText.length < existingText.length * 0.6) {
        console.log('⚠ degraded fetch suspected (new text much shorter) — keeping existing');
        failed += 1;
        await sleep(currentFetchDelay());
        continue;
      }
    }
    const body = buildBody(advisory, fullText);
    const newHash = hashFullText(body);
    if (!isNew && existingHashes.get(advisory.advisoryId) === newHash) {
      console.log('= (unchanged)');
      await sleep(currentFetchDelay());
      continue;
    }
    if (checkOnly) {
      console.log(`${isNew ? '+ new' : '~ revised'} (check-only, not written)`);
    } else {
      await writeFile(path.join(OUT_DIR, filename), body, 'utf8');
      console.log(`${isNew ? '✓ written' : '↻ rewritten (revised on drupal.org)'}`);
    }
    if (isNew) written += 1; else rewritten += 1;
    await sleep(currentFetchDelay());
  }

  console.log(`\n=== Security advisory fetch complete ===`);
  console.log(`  Stop reason        : ${stopReason}`);
  console.log(`  Core listings seen : ${unique.size}`);
  console.log(`  New                : ${written}`);
  console.log(`  Revised (rewritten): ${rewritten}`);
  console.log(`  Failed             : ${failed} (resumable — re-run to continue)`);
  if (checkOnly) console.log('  Mode               : check-only (nothing written)');
  console.log(`  Output             : ${OUT_DIR}`);
}

void main();
