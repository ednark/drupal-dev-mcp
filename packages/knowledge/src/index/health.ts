import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { SOURCE_LOCATIONS } from './freshness.js';

/**
 * Corpus health gate — deterministic ingestion-quality checks that search
 * gates structurally cannot express.
 *
 * Motivation (2026-10-29 chrome incident): the retrieval benchmark stayed
 * 28/28 while ~75% of the change-record corpus was drupal.org navigation
 * chrome, because any-term-in-top-5 matching could not see it. This gate
 * measures the corpus directly:
 *
 * - chromeRatio: share of corpus bytes in lines (>60 chars) that appear in
 *   >30% of a source's files. Navigation junk is byte-identical across
 *   pages; real bodies are not. (Short shared lines — metadata labels like
 *   "Project:" — are excluded to avoid false alarms.)
 * - stubRatio: share of eligible files under 200 bytes.
 * - medianSize: informational floor/ceiling per source.
 *
 * Text sources only (includeCode false): code corpora legitimately repeat
 * boilerplate (LICENSE headers, test fixtures) and would false-alarm.
 * The change-records corpus pre-curation measured ~75% chrome; the alarm
 * threshold is 15%.
 */

const CHROME_ALARM_RATIO = 0.15;
const STUB_ALARM_RATIO = 0.3;
const CHROME_LINE_MIN_CHARS = 60;
const CHROME_LINE_SHARE = 0.3;
const STUB_MAX_BYTES = 200;
const MIN_FILES_FOR_CHROME_CHECK = 10;

export interface SourceHealth {
  sourceKey: string;
  files: number;
  totalBytes: number;
  medianSize: number;
  stubRatio: number;
  chromeRatio: number | null;
  alarms: string[];
}

export interface CorpusHealthReport {
  releaseGate: boolean;
  alarmedSources: string[];
  sources: SourceHealth[];
}

async function walkMarkdown(directory: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(current: string): Promise<void> {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && /\.(md|txt|rst)$/i.test(entry.name)) files.push(absolute);
    }
  }
  await visit(directory);
  return files;
}

async function healthForSource(repoRoot: string, location: (typeof SOURCE_LOCATIONS)[number]): Promise<SourceHealth | null> {
  let directory: string | null = null;
  for (const folder of location.folders) {
    try {
      const candidate = path.join(repoRoot, 'data', 'sources', folder);
      if ((await stat(candidate)).isDirectory()) { directory = candidate; break; }
    } catch { /* try next candidate */ }
  }
  if (!directory) return null;

  const files = await walkMarkdown(directory);
  if (files.length === 0) return null;

  const sizes: number[] = [];
  const lineCounts = new Map<string, number>();
  let totalBytes = 0;
  let stubs = 0;

  for (const file of files) {
    let content: string;
    try { content = await readFile(file, 'utf8'); } catch { continue; }
    const bytes = Buffer.byteLength(content, 'utf8');
    sizes.push(bytes);
    totalBytes += bytes;
    if (bytes < STUB_MAX_BYTES) stubs += 1;
    // Per-file unique lines so one file cannot inflate its own junk.
    const seen = new Set<string>();
    for (const raw of content.split('\n')) {
      const line = raw.trim();
      if (line.length < CHROME_LINE_MIN_CHARS || seen.has(line)) continue;
      seen.add(line);
      lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
    }
  }

  const chromeBytes = [...lineCounts.entries()]
    .filter(([line, count]) => count > files.length * CHROME_LINE_SHARE)
    .reduce((sum, [line]) => sum + line.length, 0);

  const sorted = [...sizes].sort((a, b) => a - b);
  const medianSize = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const chromeRatio = files.length >= MIN_FILES_FOR_CHROME_CHECK ? chromeBytes / Math.max(totalBytes, 1) : null;
  const stubRatio = files.length ? stubs / files.length : 0;

  const alarms: string[] = [];
  if (chromeRatio !== null && chromeRatio > CHROME_ALARM_RATIO) {
    alarms.push(`chromeRatio ${(chromeRatio * 100).toFixed(1)}% > ${CHROME_ALARM_RATIO * 100}% — navigation junk in corpus (run index:curate-chrome / check fetcher)`);
  }
  if (stubRatio > STUB_ALARM_RATIO) {
    alarms.push(`stubRatio ${(stubRatio * 100).toFixed(1)}% > ${STUB_ALARM_RATIO * 100}% — too many tiny files`);
  }

  return {
    sourceKey: location.sourceKey,
    files: files.length,
    totalBytes,
    medianSize,
    stubRatio: Math.round(stubRatio * 1000) / 1000,
    chromeRatio: chromeRatio === null ? null : Math.round(chromeRatio * 1000) / 1000,
    alarms,
  };
}

export async function runCorpusHealth(repoRoot: string): Promise<CorpusHealthReport> {
  const sources: SourceHealth[] = [];
  for (const location of SOURCE_LOCATIONS) {
    if (location.includeCode) continue; // code corpora repeat boilerplate legitimately
    const health = await healthForSource(repoRoot, location);
    if (health) sources.push(health);
  }
  const alarmedSources = sources.filter(source => source.alarms.length > 0).map(source => source.sourceKey);
  return { releaseGate: alarmedSources.length === 0, alarmedSources, sources };
}
