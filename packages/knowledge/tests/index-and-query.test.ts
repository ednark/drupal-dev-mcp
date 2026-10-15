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
  for (const version of ['10.6', '11.4', '12.0']) {
    const core = path.join(sources, `drupal-core-${version}`, 'core', 'lib', 'Drupal', 'Core', 'Example');
    await mkdir(core, { recursive: true });
    await writeFile(path.join(core, 'ExampleManager.php'), php(version));
    const module = path.join(sources, `drupal-core-${version}`, 'core', 'modules', 'example');
    await mkdir(module, { recursive: true });
    await writeFile(path.join(module, 'example.services.yml'), `example.manager:\n  class: Drupal\\Core\\Example\\ExampleManager\n`);
    const component = path.join(sources, `drupal-core-${version}`, 'core', 'themes', 'example', 'components', 'pager');
    await mkdir(component, { recursive: true });
    await writeFile(path.join(component, 'pager.component.yml'), `name: Pager\nprops:\n  type: object\n  properties:\n    items:\n      type: string\n      title: Version ${version}\n`);
    const schema = path.join(sources, `drupal-core-${version}`, 'core', 'modules', 'example', 'config', 'schema');
    await mkdir(schema, { recursive: true });
    await writeFile(path.join(schema, 'example.schema.yml'), `example.settings:\n  type: config_object\n  mapping:\n    limit:\n      type: integer\n`);
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
    const component = await provider.getEntity({ identifier: 'pager', kind: 'component', drupalVersion: '11.4' });
    assert.equal(component.status, 'found');
    assert.equal(component.entity?.canonicalName, 'drupal:component:pager');
    const schema = await provider.getEntity({ identifier: 'example.settings', kind: 'config_schema', drupalVersion: '11.4' });
    assert.equal(schema.status, 'found');
    const componentRelations = await provider.exploreRelationships({ entityId: component.entity!.id });
    assert.ok(componentRelations.edges.some(edge => edge.predicate === 'defines_property' && edge.unresolvedTarget?.includes('items:string')));
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

test('batch entity resolution, snippet budgeting, and stable ordering', async () => {
  const { repoRoot, indexRoot } = await fixtureRepo();
  await buildIndex({ repoRoot, indexRoot, withEmbeddings: false, activate: true });
  const provider = await SqliteKnowledgeProvider.open(indexRoot);
  try {
    const v11 = await provider.getEntity({ identifier: 'Drupal\\Core\\Example\\ExampleManager', drupalVersion: '11.4' });
    const v10 = await provider.getEntity({ identifier: 'Drupal\\Core\\Example\\ExampleManager', drupalVersion: '10.6' });
    assert.equal(v10.status, 'found');

    const batch = await provider.getEntities({
      entityIds: [v11.entity!.id, v11.entity!.id, v10.entity!.id, 'ent_missing00000000000000'],
      drupalVersion: 'all',
    });
    assert.deepEqual(batch.results.map(item => item.status), ['found', 'found', 'not_found']);
    assert.equal(batch.results[1].entity?.drupalVersion, '10.6');

    const clipped = await provider.search({ query: 'ExampleManager', drupalVersion: '11.4', mode: 'lexical', snippetMaxChars: 60 });
    assert.ok(clipped.results.length > 0);
    for (const result of clipped.results) {
      if (result.snippet !== undefined) assert.ok(result.snippet.length <= 60, `snippet exceeds budget: ${result.snippet}`);
    }

    // The fixture corpus is degenerate for bm25 (every document matches every token),
    // so ordering assertions run with the score floor disabled; the floor itself is
    // tested relative to observed scores rather than absolute values.
    const first = await provider.search({ query: 'ExampleManager example', drupalVersion: 'all', mode: 'lexical', limit: 25, minScore: 0 });
    const second = await provider.search({ query: 'ExampleManager example', drupalVersion: 'all', mode: 'lexical', limit: 25, minScore: 0 });
    assert.ok(first.results.length > 1);
    assert.deepEqual(second.results.map(result => result.id), first.results.map(result => result.id));

    const midScore = first.results[Math.floor(first.results.length / 2)].score;
    const strict = await provider.search({ query: 'ExampleManager example', drupalVersion: 'all', mode: 'lexical', limit: 25, minScore: midScore });
    assert.ok(strict.results.length > 0 && strict.results.length < first.results.length, 'score floor keeps some but not all results');
    assert.ok(strict.results.every(result => result.score >= midScore));
  } finally { provider.close(); }
});

test('semantic hits carry chunk-level citation URIs that resolve to exact chunk text', async () => {
  const { repoRoot, indexRoot } = await fixtureRepo();
  const embed = async (texts: string[]) => texts.map(text => [text.length % 7, (text.length * 3) % 11]);
  const build = await buildIndex({ repoRoot, indexRoot, withEmbeddings: true, activate: true, embed });
  assert.ok(build.counts.vectors > 0);
  const provider = await SqliteKnowledgeProvider.open(indexRoot, { queryEmbedder: async () => [3, 5] });
  try {
      const search = await provider.search({ query: 'ExampleManager', drupalVersion: '11.4', mode: 'semantic', limit: 5, minScore: 0 });
    assert.equal(search.degradedMode, undefined);
    const chunkHits = search.results.filter(result => result.chunkResourceUri);
    assert.ok(chunkHits.length > 0, 'expected semantic hits carrying chunk-level URIs');
    for (const chunkHit of chunkHits) {
      assert.match(chunkHit!.chunkResourceUri!, /^drupal:\/\/document\/doc_[A-Za-z0-9_-]+#chunk\/chk_[A-Za-z0-9_-]+$/);
      assert.equal(chunkHit!.chunkId, chunkHit!.chunkResourceUri!.split('#chunk/')[1]);
      const chunkResource = await provider.readResource(chunkHit!.chunkResourceUri!);
      assert.ok(chunkResource?.text, 'chunk resource resolves');
    }
    const relevantTexts = await Promise.all(chunkHits.map(async hit => (await provider.readResource(hit.chunkResourceUri!))?.text ?? ''));
    assert.ok(relevantTexts.some(text => text.includes('ExampleManager')), 'a chunk hit resolves to exact indexed ExampleManager text');
    const missingChunk = await provider.readResource(`drupal://document/${chunkHits[0]!.id}#chunk/chk_doesnotexist0000000000`);
    assert.equal(missingChunk, null);
  } finally { provider.close(); }
});
