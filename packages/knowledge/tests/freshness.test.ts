import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_REGISTRY } from '../src/registry.js';
import { buildIndex } from '../src/index/builder.js';
import { GIT_SOURCE_SCRIPTS } from '../src/index/fetch.js';
import { statusFromManifest } from '../src/index/manifest.js';
import {
  SOURCE_LOCATIONS,
  checkFreshness,
  compareSourceState,
  fingerprintDirectory,
  type CurrentSourceState,
  type IndexedSourceState,
} from '../src/index/freshness.js';

const TEXT_PROJECT = { mode: 'firstSegment' } as const;

async function textFixture(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'drupal-mcp-fresh-'));
  await writeFile(path.join(directory, 'guide.md'), '# Guide\n\n' + 'Substantive documentation content. '.repeat(20) + '\n');
  await writeFile(path.join(directory, 'other.md'), '# Other\n\n' + 'More documentation content here. '.repeat(20) + '\n');
  return directory;
}

function state(overrides: Partial<CurrentSourceState> & { digest: string }): CurrentSourceState {
  return {
    files: 2, bytes: 100, latestMtime: '2026-01-01T00:00:00.000Z', commits: [],
    projects: { docs: { files: 2, digest: overrides.digest } }, ...overrides,
  };
}

function indexed(overrides: Partial<IndexedSourceState> & { digest: string }): IndexedSourceState {
  return {
    documents: 2, commits: [],
    projects: { docs: { files: 2, digest: overrides.digest } }, ...overrides,
  };
}

test('SOURCE_LOCATIONS covers every registered source', () => {
  const mapped = new Set(SOURCE_LOCATIONS.map(location => location.sourceKey));
  for (const source of SOURCE_REGISTRY) {
    assert.ok(mapped.has(source.key), `missing location mapping for ${source.key}`);
  }
  for (const location of SOURCE_LOCATIONS) {
    assert.ok(location.folders.length > 0);
    assert.ok(location.drupalVersion.length > 0);
  }
});

test('fingerprintDirectory is stable, detects edits, and ignores junk', async () => {
  const directory = await textFixture();
  const options = { directory, sourceKey: 'developer_guides', drupalVersion: 'all', includeCode: false, project: TEXT_PROJECT };
  const first = await fingerprintDirectory(options);
  assert.equal(first.size, 2);
  assert.equal((await fingerprintDirectory(options)).get('guide.md:guide.md'), first.get('guide.md:guide.md'));
  await writeFile(path.join(directory, 'guide.md'), '# Guide\n\nCompletely rewritten content. '.repeat(20) + '\n');
  assert.notEqual((await fingerprintDirectory(options)).get('guide.md:guide.md'), first.get('guide.md:guide.md'));
  // Raw HTML snapshots are junk: discovery drops them, so the fingerprint must too.
  await writeFile(path.join(directory, 'snapshot.md'), '<!DOCTYPE html><html><body>unextracted</body></html>');
  assert.equal((await fingerprintDirectory(options)).size, 2);
});

test('content dedupe is shared across a source subdirectories, mirroring discovery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drupal-mcp-fresh-dedup-'));
  // Byte-identical across modules, like the GPL LICENSE.txt shipped in every
  // contrib checkout: discovery dedupes it source-wide (first traversal wins).
  const license = 'GPL-2.0-or-later. '.repeat(60);
  for (const mod of ['ai', 'date']) {
    await mkdir(path.join(root, mod), { recursive: true });
    await writeFile(path.join(root, mod, 'LICENSE.txt'), license);
    await writeFile(path.join(root, mod, 'README.md'), `# ${mod}\n\n` + 'Module specific documentation. '.repeat(20) + '\n');
  }
  const base = { sourceKey: 'contrib_code', drupalVersion: 'all', includeCode: true, project: { mode: 'subdir' } as const };

  // Independent per-directory sets (the old, broken behavior): both copies survive.
  const aiIndependent = await fingerprintDirectory({ ...base, directory: path.join(root, 'ai'), subdir: 'ai' });
  const dateIndependent = await fingerprintDirectory({ ...base, directory: path.join(root, 'date'), subdir: 'date' });
  assert.ok(aiIndependent.has('ai:LICENSE.txt'));
  assert.ok(dateIndependent.has('date:LICENSE.txt'));

  // One shared set (the fix): 'ai' claims the hash, so 'date' must drop its copy.
  const shared = new Set<string>();
  const aiShared = await fingerprintDirectory({ ...base, directory: path.join(root, 'ai'), subdir: 'ai', seenContent: shared });
  const dateShared = await fingerprintDirectory({ ...base, directory: path.join(root, 'date'), subdir: 'date', seenContent: shared });
  assert.ok(aiShared.has('ai:LICENSE.txt'));
  assert.ok(!dateShared.has('date:LICENSE.txt'));
  assert.ok(dateShared.has('date:README.md'));
});

test('compareSourceState classifies fresh, changed, missing, new, and unfetched', () => {
  assert.equal(compareSourceState(null, null).status, 'unfetched');
  assert.equal(compareSourceState(null, indexed({ digest: 'a' })).status, 'missing');
  assert.equal(compareSourceState(state({ digest: 'a' }), null).status, 'new');
  assert.equal(compareSourceState(state({ digest: 'a' }), indexed({ digest: 'a' })).status, 'fresh');
  const moved = compareSourceState(
    state({ digest: 'a', commits: ['b'.repeat(40)] }),
    indexed({ digest: 'a', commits: ['a'.repeat(40)] }),
  );
  assert.equal(moved.status, 'fresh');
  assert.ok(moved.details.some(detail => detail.includes('Commit moved')));
  const changed = compareSourceState(state({ digest: 'b' }), indexed({ digest: 'a' }));
  assert.equal(changed.status, 'changed');
  assert.ok(changed.details.some(detail => detail.includes('Diverged projects')));
});

test('checkFreshness tracks build, edits, and newly added sources', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'drupal-mcp-fresh-repo-'));
  const indexRoot = path.join(repoRoot, 'data', 'index');
  const core = path.join(repoRoot, 'data', 'sources', 'drupal-core-11.4', 'core', 'lib');
  await mkdir(core, { recursive: true });
  await writeFile(path.join(core, 'Example.php'), '<?php\n// Example core class with enough content to pass the length gate.\nclass Example {}\n');
  const guides = path.join(repoRoot, 'data', 'sources', 'drupal-developer-guides', 'docs');
  await mkdir(guides, { recursive: true });
  await writeFile(path.join(guides, 'guide.md'), '# Guide\n\n' + 'Substantive documentation content. '.repeat(20) + '\n');

  const built = await buildIndex({ repoRoot, indexRoot, withEmbeddings: false, activate: true });
  assert.equal(built.verification.passed, true, built.verification.errors.join('; '));

  const fresh = await checkFreshness(repoRoot, indexRoot);
  assert.equal(fresh.ready, true);
  assert.deepEqual(fresh.needsProcessing, []);
  assert.equal(fresh.sources.find(item => item.sourceKey === 'drupal_core_11')?.status, 'fresh');
  assert.equal(fresh.sources.find(item => item.sourceKey === 'developer_guides')?.status, 'fresh');
  assert.equal(fresh.sources.find(item => item.sourceKey === 'drupal_core_10')?.status, 'unfetched');

  await writeFile(path.join(guides, 'guide.md'), '# Guide\n\n' + 'Rewritten documentation content. '.repeat(20) + '\n');
  const tutorials = path.join(repoRoot, 'data', 'sources', 'tutorials', 'docs');
  await mkdir(tutorials, { recursive: true });
  await writeFile(path.join(tutorials, 'intro.md'), '# Intro\n\n' + 'Tutorial content for a new source. '.repeat(20) + '\n');

  const stale = await checkFreshness(repoRoot, indexRoot);
  assert.equal(stale.stale, true);
  assert.equal(stale.sources.find(item => item.sourceKey === 'developer_guides')?.status, 'changed');
  assert.equal(stale.sources.find(item => item.sourceKey === 'drupal_core_11')?.status, 'fresh');
  assert.equal(stale.sources.find(item => item.sourceKey === 'tutorials')?.status, 'new');
  assert.ok(stale.needsProcessing.includes('developer_guides'));
  assert.ok(stale.needsProcessing.includes('tutorials'));
});

test('fixture-limited builds record the limit and skip inconclusive comparisons', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'drupal-mcp-fixture-repo-'));
  const indexRoot = path.join(repoRoot, 'data', 'index');
  const core = path.join(repoRoot, 'data', 'sources', 'drupal-core-11.4', 'core', 'lib');
  await mkdir(core, { recursive: true });
  await writeFile(path.join(core, 'Example.php'), '<?php\n// Example core class with enough content to pass the length gate.\nclass Example {}\n');
  const guides = path.join(repoRoot, 'data', 'sources', 'drupal-developer-guides', 'docs');
  await mkdir(guides, { recursive: true });
  await writeFile(path.join(guides, 'guide.md'), '# Guide\n\n' + 'Substantive documentation content. '.repeat(20) + '\n');
  await writeFile(path.join(guides, 'other.md'), '# Other\n\n' + 'More documentation content here. '.repeat(20) + '\n');

  const built = await buildIndex({ repoRoot, indexRoot, withEmbeddings: false, activate: true, fixtureLimit: 1 });
  assert.equal(built.verification.passed, true, built.verification.errors.join('; '));
  assert.equal(built.fixtureLimit, 1);
  assert.equal(statusFromManifest(built).fixtureLimit, 1);

  const report = await checkFreshness(repoRoot, indexRoot);
  assert.equal(report.fixtureLimited, true);
  assert.equal(report.stale, false);
  assert.deepEqual(report.needsProcessing, []);
  // Single-file core source is fully covered by the limit: exact match still proves fresh.
  assert.equal(report.sources.find(item => item.sourceKey === 'drupal_core_11')?.status, 'fresh');
  // Two-file guides source exceeds the limit: mismatch is inconclusive, not changed.
  assert.equal(report.sources.find(item => item.sourceKey === 'developer_guides')?.status, 'skipped');
});

test('every git refresh script resolves to a real file', async () => {
  const scriptsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  assert.equal(GIT_SOURCE_SCRIPTS.length, 5);
  for (const script of GIT_SOURCE_SCRIPTS) {
    await access(path.join(scriptsRoot, script));
  }
});
