import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../src/index/builder.js';
import { verifyBuild } from '../src/index/verify.js';
import { resolveActiveBuild } from '../src/index/manifest.js';
import { SqliteKnowledgeProvider } from '../src/query/provider.js';

async function fixtureRepo(): Promise<{ repoRoot: string; indexRoot: string }> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'drupal-mcp-index-'));
  const sources = path.join(repoRoot, 'data', 'sources');
  const php = (version: string) => `<?php
namespace Drupal\\Core\\Example;
interface ExampleManagerInterface {}
class ExampleManager implements ExampleManagerInterface {
  public function version(): string { return '${version}'; }
}
`;
  for (const version of ['10.6', '11.4']) {
    const core = path.join(sources, `drupal-core-${version}`, 'core', 'lib', 'Drupal', 'Core', 'Example');
    await mkdir(core, { recursive: true });
    await writeFile(path.join(core, 'ExampleManager.php'), php(version));
    const module = path.join(sources, `drupal-core-${version}`, 'core', 'modules', 'example');
    await mkdir(module, { recursive: true });
    await writeFile(path.join(module, 'example.services.yml'), `example.manager:\n  class: Drupal\\Core\\Example\\ExampleManager\n`);
  }
  return { repoRoot, indexRoot: path.join(repoRoot, 'data', 'index') };
}

test('verified builds activate atomically and support lexical queries without OpenAI', async () => {
  const { repoRoot, indexRoot } = await fixtureRepo();
  const result = await buildIndex({ repoRoot, indexRoot, withEmbeddings: false, activate: true });
  assert.equal(result.verification.passed, true, result.verification.errors.join('; '));
  assert.ok(result.counts.documents >= 4);
  assert.equal(result.counts.vectors, 0);
  const active = await resolveActiveBuild(indexRoot);
  assert.equal(active?.runId, result.runId);
  assert.equal(JSON.parse(await readFile(path.join(indexRoot, 'active.json'), 'utf8')).verification.passed, true);
  const verified = await verifyBuild(result.buildPath);
  assert.equal(verified.passed, true, verified.errors.join('; '));

  const provider = await SqliteKnowledgeProvider.open(indexRoot);
  try {
    const search = await provider.search({ query: 'ExampleManager', drupalVersion: '11.4', mode: 'hybrid', limit: 5 });
    assert.equal(search.degradedMode, 'lexical_only');
    assert.ok(search.results.length > 0);
    assert.ok(search.results.every(item => item.drupalVersion === '11.4' || item.drupalVersion === 'all'));
    assert.ok(search.results.every(item => item.resourceUri.startsWith('drupal://')));
    const exact = await provider.getEntity({ identifier: 'Drupal\\Core\\Example\\ExampleManager', drupalVersion: '11.4' });
    assert.equal(exact.status, 'found');
    assert.equal(exact.entity?.drupalVersion, '11.4');
    const graph = await provider.exploreRelationships({ entityId: exact.entity!.id });
    assert.ok(graph.edges.every(edge => edge.confidence >= 0.7));
    assert.ok(graph.edges.some(edge => edge.predicate === 'equivalent_to' && edge.confidence === 1));
    const resource = await provider.readResource(exact.entity!.resourceUri);
    assert.equal(resource?.mimeType, 'application/json');
  } finally { provider.close(); }
});

test('a failed build never replaces the prior active manifest', async () => {
  const { repoRoot, indexRoot } = await fixtureRepo();
  const first = await buildIndex({ repoRoot, indexRoot, activate: true });
  const before = await readFile(path.join(indexRoot, 'active.json'), 'utf8');
  const emptyRoot = await mkdtemp(path.join(os.tmpdir(), 'drupal-mcp-empty-'));
  const failed = await buildIndex({ repoRoot: emptyRoot, indexRoot, activate: true });
  assert.equal(failed.verification.passed, false);
  assert.equal(await readFile(path.join(indexRoot, 'active.json'), 'utf8'), before);
  assert.equal((await resolveActiveBuild(indexRoot))?.runId, first.runId);
});
