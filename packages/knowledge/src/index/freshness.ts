import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { contentHash } from '../ids.js';
import { SOURCE_BY_KEY } from '../registry.js';
import { isJunkContent, readGitCommit, SOURCE_FILE_LIMITS, SOURCE_FILE_SELECTION, walkFiles } from './discover.js';
import { getDefaultIndexRoot, resolveActiveBuild } from './manifest.js';
import { openDatabase } from '../storage/schema.js';

/**
 * Source freshness: compares the live `data/sources` working set against
 * what the active index build actually contains, so maintainers can tell
 * which sources changed upstream and need re-processing (`index:fetch` /
 * `index:rebuild`) without rebuilding blindly.
 *
 * Fingerprints deliberately mirror discovery's file-selection rules
 * (extensions, size limits, junk/content gates, locator construction, and
 * per-source content dedupe) so a `fresh` verdict means "rebuild would index
 * byte-identical documents".
 */

export type SourceFreshnessStatus =
  | 'fresh'
  | 'changed'
  | 'missing'
  | 'new'
  | 'unfetched'
  | 'unindexed'
  | 'skipped';

export interface SourceLocation {
  sourceKey: string;
  /** Candidate folders under data/sources; first existing wins. */
  folders: string[];
  drupalVersion: string;
  includeCode: boolean;
  /** Fixed project, per-subdirectory projects (contrib), or first-path-segment. */
  project: string | { mode: 'subdir' } | { mode: 'firstSegment' };
  git: 'root' | 'subdir' | 'none';
}

/** Mirrors the source→directory mapping in discoverDocuments. */
export const SOURCE_LOCATIONS: readonly SourceLocation[] = [
  { sourceKey: 'drupal_core_10', folders: ['drupal-core-10.6'], drupalVersion: '10.6', includeCode: true, project: 'drupal', git: 'root' },
  { sourceKey: 'drupal_core_11', folders: ['drupal-core-11.4', 'drupal-core'], drupalVersion: '11.4', includeCode: true, project: 'drupal', git: 'root' },
  { sourceKey: 'contrib_code', folders: ['contrib-module-code'], drupalVersion: 'all', includeCode: true, project: { mode: 'subdir' }, git: 'subdir' },
  { sourceKey: 'drupal_examples', folders: ['drupal-examples'], drupalVersion: 'all', includeCode: true, project: 'examples', git: 'root' },
  ...(
    [
      ['drupal-developer-guides', 'developer_guides'], ['drupal-module-handbook', 'module_handbook'],
      ['drupal-skills', 'drupal_skills'], ['tutorials', 'tutorials'], ['symfony-docs', 'symfony_docs'],
      ['php-manual', 'php_docs'], ['certification', 'certification'], ['contrib-modules', 'contrib_docs'],
      ['api-drupal-org', 'api_drupal_org'], ['change-records', 'change_records'],
      ['drupal-user-guide', 'drupal_user_guide'], ['drush-docs', 'drush_docs'], ['twig-docs', 'twig_docs'],
      ['drupal-coding-standards', 'drupal_coding_standards'], ['php-fig', 'php_fig'],
      ['drupal-theming-guide', 'drupal_theming_guide'],
      ['drupal-placement-guidance', 'drupal_placement_guidance'],
      ['twelve-factor', 'twelve_factor'], ['fowler', 'fowler'],
      ['ms-cloud-patterns', 'ms_cloud_patterns'], ['eip-patterns', 'eip_patterns'],
      ['gof-patterns', 'gof_patterns'],
    ] as const
  ).map(([folder, sourceKey]): SourceLocation => ({
    sourceKey,
    folders: [folder],
    drupalVersion: 'all',
    includeCode: false,
    project: { mode: 'firstSegment' },
    // drupal-skills and symfony-docs are plain git clones: track commit drift like core.
    git: sourceKey === 'drupal_skills' || sourceKey === 'symfony_docs' ? 'root' : 'none',
  })),
];

export interface ProjectFingerprint {
  files: number;
  digest: string;
}

export interface CurrentSourceState {
  files: number;
  bytes: number;
  latestMtime: string | null;
  digest: string;
  commits: string[];
  projects: Record<string, ProjectFingerprint>;
}

export interface IndexedSourceState {
  documents: number;
  digest: string;
  commits: string[];
  projects: Record<string, ProjectFingerprint>;
}

export interface SourceFreshness {
  sourceKey: string;
  displayName: string;
  status: SourceFreshnessStatus;
  details: string[];
  current: CurrentSourceState | null;
  indexed: IndexedSourceState | null;
}

export interface FreshnessReport {
  ready: boolean;
  runId?: string;
  builtAt?: string;
  /** True when the active build used --fixture-limit: divergences are inconclusive. */
  fixtureLimited: boolean;
  stale: boolean;
  /** Source keys that need (re-)processing: changed, missing, or new. */
  needsProcessing: string[];
  /** Source keys never fetched and never indexed: informational only. */
  attention: string[];
  sources: SourceFreshness[];
}

function eligibleExtension(file: string, includeCode: boolean): boolean {
  const extension = path.extname(file).toLowerCase();
  if (includeCode && SOURCE_FILE_SELECTION.codeExtensions.has(extension)) return true;
  return SOURCE_FILE_SELECTION.textExtensions.has(extension);
}

function projectFor(relative: string, project: SourceLocation['project'], subdir?: string): string {
  if (typeof project === 'string') return project;
  if (project.mode === 'subdir') return subdir ?? relative.split('/')[0];
  return relative.split('/')[0];
}

/**
 * Fingerprints one source directory with discovery-identical selection:
 * extension gate, size gate, utf8 read, minimum-length and junk gates, then
 * per-source content dedupe. Returns entries keyed by discovery locator.
 *
 * `seenContent` carries the dedupe set across calls: discovery applies its
 * content dedupe source-wide (one pass over every project directory), so a
 * caller fingerprinting a multi-directory source must share one set —
 * otherwise a file byte-identical to one in an earlier directory (e.g. the
 * GPL LICENSE.txt shipped in every contrib module) survives here but was
 * deduped away in the index, and freshness reports a permanent false
 * "changed" for that project.
 */
export async function fingerprintDirectory(options: {
  directory: string;
  sourceKey: string;
  drupalVersion: string;
  includeCode: boolean;
  project: SourceLocation['project'];
  subdir?: string;
  seenContent?: Set<string>;
}): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  const seenContent = options.seenContent ?? new Set<string>();
  for (const file of await walkFiles(options.directory)) {
    if (!eligibleExtension(file, options.includeCode)) continue;
    let info;
    try { info = await stat(file); } catch { continue; }
    if (info.size === 0 || info.size > SOURCE_FILE_LIMITS.maxFileBytes) continue;
    let content: string;
    try { content = await readFile(file, 'utf8'); } catch { continue; }
    if (content.trim().length < SOURCE_FILE_LIMITS.minContentChars) continue;
    if (isJunkContent(content)) continue;
    const hash = contentHash(content);
    const dedupeKey = `${options.sourceKey}:${options.drupalVersion}:${hash}`;
    if (seenContent.has(dedupeKey)) continue;
    seenContent.add(dedupeKey);
    const relative = path.relative(options.directory, file).split(path.sep).join('/');
    entries.set(`${projectFor(relative, options.project, options.subdir)}:${relative}`, hash);
  }
  return entries;
}

function digestEntries(entries: Map<string, string>): string {
  return contentHash([...entries].map(([locator, hash]) => `${locator}:${hash}`).sort().join('\n'));
}

function digestForProject(entries: Map<string, string>, project: string): { files: number; digest: string } {
  const scoped = new Map([...entries].filter(([locator]) => locator.startsWith(`${project}:`)));
  return { files: scoped.size, digest: digestEntries(scoped) };
}

export async function fingerprintSource(repoRoot: string, location: SourceLocation): Promise<CurrentSourceState | null> {
  const sources = path.join(repoRoot, 'data', 'sources');
  let directory: string | null = null;
  for (const folder of location.folders) {
    try {
      const candidate = path.join(sources, folder);
      if ((await stat(candidate)).isDirectory()) { directory = candidate; break; }
    } catch { /* try next candidate */ }
  }
  if (!directory) return null;

  const combined = new Map<string, string>();
  const commits = new Set<string>();
  let bytes = 0;
  let latestMtimeMs = 0;
  if (typeof location.project !== 'string' && location.project.mode === 'subdir') {
    let subdirs: string[] = [];
    try { subdirs = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name); } catch { return null; }
    // Discovery dedupes identical content source-wide in one pass (first
    // traversal wins), so every subdir must share one dedupe set — otherwise
    // files deduped in the index survive here and the digest diverges.
    const seenContent = new Set<string>();
    for (const subdir of subdirs) {
      const sub = path.join(directory, subdir);
      for (const [locator, hash] of await fingerprintDirectory({ directory: sub, sourceKey: location.sourceKey, drupalVersion: location.drupalVersion, includeCode: location.includeCode, project: location.project, subdir, seenContent })) {
        if (!combined.has(locator)) combined.set(locator, hash);
      }
      if (location.git === 'subdir') {
        const commit = await readGitCommit(sub);
        if (commit) commits.add(commit);
      }
    }
    // Account bytes/mtime across the whole tree for informational signals.
    for (const file of await walkFiles(directory)) {
      try {
        const info = await stat(file);
        if (info.isFile()) { bytes += info.size; latestMtimeMs = Math.max(latestMtimeMs, info.mtimeMs); }
      } catch { /* ignore */ }
    }
  } else {
    for (const [locator, hash] of await fingerprintDirectory({ directory, sourceKey: location.sourceKey, drupalVersion: location.drupalVersion, includeCode: location.includeCode, project: location.project })) {
      if (!combined.has(locator)) combined.set(locator, hash);
    }
    if (location.git === 'root') {
      const commit = await readGitCommit(directory);
      if (commit) commits.add(commit);
    }
    for (const file of await walkFiles(directory)) {
      try {
        const info = await stat(file);
        if (info.isFile()) { bytes += info.size; latestMtimeMs = Math.max(latestMtimeMs, info.mtimeMs); }
      } catch { /* ignore */ }
    }
  }
  if (combined.size === 0) return null;

  const projects: Record<string, ProjectFingerprint> = {};
  for (const locator of combined.keys()) {
    const project = locator.split(':')[0];
    if (!projects[project]) projects[project] = digestForProject(combined, project);
  }
  return {
    files: combined.size,
    bytes,
    latestMtime: latestMtimeMs ? new Date(latestMtimeMs).toISOString() : null,
    digest: digestEntries(combined),
    commits: [...commits],
    projects,
  };
}

export function compareSourceState(current: CurrentSourceState | null, indexed: IndexedSourceState | null): { status: SourceFreshnessStatus; details: string[] } {
  if (!current && !indexed) return { status: 'unfetched', details: ['Source directory is absent and nothing is indexed'] };
  if (!current) return { status: 'missing', details: [`Previously indexed ${indexed!.documents} document(s), but the source directory is gone`] };
  if (!indexed) return { status: 'new', details: [`${current.files} eligible file(s) present with nothing indexed`] };
  if (current.digest === indexed.digest) {
    const details = [`Content digest matches across ${indexed.documents} indexed document(s)`];
    const drifted = current.commits.filter(commit => !indexed.commits.includes(commit));
    if (drifted.length && indexed.commits.length) details.push(`Commit moved (${indexed.commits[0]?.slice(0, 12)} → ${current.commits[0]?.slice(0, 12)}) but indexed content is identical; no re-processing needed`);
    else if (current.commits.length && !indexed.commits.length) details.push('Upstream commit recorded, but indexed content is identical; no re-processing needed');
    return { status: 'fresh', details };
  }
  const details = [`Content digest differs (indexed ${indexed.documents} document(s) vs ${current.files} eligible file(s))`];
  const addedCommits = current.commits.filter(commit => !indexed.commits.includes(commit));
  const removedCommits = indexed.commits.filter(commit => !current.commits.includes(commit));
  if (addedCommits.length || removedCommits.length) {
    details.push(`Commits added: ${formatShortList(addedCommits)}; removed: ${formatShortList(removedCommits)}`);
  }
  const changedProjects = Object.keys(current.projects).filter(project =>
    current.projects[project]?.digest !== indexed.projects[project]?.digest);
  const droppedProjects = Object.keys(indexed.projects).filter(project => !current.projects[project]);
  if (changedProjects.length) details.push(`Diverged projects: ${formatShortList(changedProjects)}`);
  if (droppedProjects.length) details.push(`Removed projects: ${formatShortList(droppedProjects)}`);
  return { status: 'changed', details };
}

/** Caps long identifier lists so human-readable details stay one line. */
function formatShortList(values: string[], limit = 8): string {
  if (!values.length) return 'none';
  const shown = values.slice(0, limit).map(value => value.slice(0, 12));
  return shown.join(', ') + (values.length > limit ? ` (+${values.length - limit} more)` : '');
}

async function readIndexedStates(indexRoot: string): Promise<{ runId?: string; builtAt?: string; fixtureLimit?: number; states: Map<string, IndexedSourceState> } | null> {
  const active = await resolveActiveBuild(indexRoot);
  if (!active) return null;
  const db = openDatabase(path.join(active.buildPath, 'knowledge.sqlite'), true);
  try {
    const states = new Map<string, IndexedSourceState>();
    const rows = db.prepare('SELECT source_key, project, repository_path, content_hash FROM documents').all() as Array<{ source_key: string; project: string | null; repository_path: string | null; content_hash: string }>;
    const bySource = new Map<string, Array<{ locator: string; hash: string }>>();
    for (const row of rows) {
      const project = row.project ?? row.repository_path?.split('/')[0] ?? 'unknown';
      const locator = `${project}:${row.repository_path ?? row.content_hash}`;
      const list = bySource.get(row.source_key) ?? [];
      list.push({ locator, hash: row.content_hash });
      bySource.set(row.source_key, list);
    }
    const commitRows = db.prepare('SELECT DISTINCT source_key, commit_sha FROM source_snapshots WHERE commit_sha IS NOT NULL').all() as Array<{ source_key: string; commit_sha: string }>;
    const commitsBySource = new Map<string, string[]>();
    for (const row of commitRows) {
      const list = commitsBySource.get(row.source_key) ?? [];
      if (!list.includes(row.commit_sha)) list.push(row.commit_sha);
      commitsBySource.set(row.source_key, list);
    }
    for (const [sourceKey, list] of bySource) {
      const entries = new Map(list.map(item => [item.locator, item.hash] as const));
      const projects: Record<string, ProjectFingerprint> = {};
      for (const { locator } of list) {
        const project = locator.split(':')[0];
        if (!projects[project]) projects[project] = digestForProject(entries, project);
      }
      states.set(sourceKey, {
        documents: list.length,
        digest: digestEntries(entries),
        commits: commitsBySource.get(sourceKey) ?? [],
        projects,
      });
    }
    return { runId: active.runId, builtAt: active.builtAt, fixtureLimit: active.fixtureLimit, states };
  } finally { db.close(); }
}

export async function checkFreshness(repoRoot: string, indexRoot = getDefaultIndexRoot(repoRoot)): Promise<FreshnessReport> {
  const indexed = await readIndexedStates(indexRoot);
  const fixtureLimit = indexed?.fixtureLimit;
  const fixtureLimited = Boolean(fixtureLimit && fixtureLimit > 0);
  const sources: SourceFreshness[] = [];
  for (const location of SOURCE_LOCATIONS) {
    const source = SOURCE_BY_KEY.get(location.sourceKey);
    if (!source) continue;
    const current = await fingerprintSource(repoRoot, location);
    const indexedState = indexed?.states.get(location.sourceKey) ?? null;
    let result = indexed
      ? compareSourceState(current, indexedState)
      : current
        ? { status: 'unindexed' as const, details: [`${current.files} eligible file(s) present; no active index build to compare against`] }
        : { status: 'unfetched' as const, details: ['Source directory is absent and there is no active index build'] };
    // Fixture-limited builds index an arbitrary per-directory subset, so a
    // digest mismatch is inconclusive (only an exact match proves freshness).
    if (fixtureLimited && (result.status === 'changed' || result.status === 'new')) {
      result = {
        status: 'skipped',
        details: [`Fixture-limited build (fixtureLimit=${fixtureLimit}): comparison is inconclusive; rebuild without --fixture-limit for a trustworthy check`],
      };
    }
    sources.push({ sourceKey: location.sourceKey, displayName: source.displayName, status: result.status, details: result.details, current, indexed: indexedState });
  }
  const needsProcessing = sources.filter(item => item.status === 'changed' || item.status === 'missing' || item.status === 'new').map(item => item.sourceKey);
  const attention = sources.filter(item => item.status === 'unfetched').map(item => item.sourceKey);
  return {
    ready: Boolean(indexed),
    runId: indexed?.runId,
    builtAt: indexed?.builtAt,
    fixtureLimited,
    stale: sources.some(item => item.status === 'changed' || item.status === 'missing'),
    needsProcessing,
    attention,
    sources,
  };
}
