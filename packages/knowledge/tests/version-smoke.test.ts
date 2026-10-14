import test from 'node:test';
import assert from 'node:assert/strict';
import { runVersionSmoke, type VersionSmokeProbe } from '../src/index/version-smoke.js';
import type { EntityResponse, KnowledgeProvider, SearchResponse } from '../src/types.js';

function stubProvider(results: Array<{ drupalVersion: string; title: string; snippet?: string; repositoryPath?: string }>, entities: Record<string, 'found' | 'not_found'>): KnowledgeProvider {
  const search = async (request: { query: string; drupalVersion?: string }): Promise<SearchResponse> => ({
    query: request.query,
    appliedFilters: {},
    index: { ready: true, schemaVersion: 1, defaultDrupalVersion: '11.4', availableDrupalVersions: ['10.6', '11.4', '12.0'], counts: {} },
    results: results
      .filter(item => !request.drupalVersion || item.drupalVersion === request.drupalVersion || item.drupalVersion === 'all')
      .map((item, index) => ({
        id: `id-${index}`, resultType: 'document' as const, title: item.title, snippet: item.snippet,
        score: 1, exactMatch: false, sourceType: 'core_code', authority: 100,
        drupalVersion: item.drupalVersion, compatibility: 'compatible' as const, status: 'active',
        repositoryPath: item.repositoryPath, freshness: '2026-01-01',
        provenance: { sourceKey: 'drupal_core_11', sourceType: 'core_code', authority: 100 },
        resourceUri: `drupal://document/id-${index}`,
      })),
  });
  return {
    search,
    getEntity: async (request): Promise<EntityResponse> => {
      const status = entities[`${request.identifier}@${request.drupalVersion}`] ?? entities[request.identifier ?? ''] ?? 'not_found';
      return status === 'found'
        ? { status: 'found', entity: { id: 'ent_x', kind: 'interface', canonicalName: request.identifier ?? '', shortName: request.identifier ?? '', drupalVersion: request.drupalVersion ?? '11.4', status: 'active', resourceUri: 'drupal://entity/ent_x' } }
        : { status };
    },
    getEntities: async () => ({ results: [] }),
    exploreRelationships: async () => { throw new Error('not implemented in stub'); },
    readResource: async () => null,
    getIndexStatus: async () => ({ ready: true, schemaVersion: 1, defaultDrupalVersion: '11.4', availableDrupalVersions: ['10.6', '11.4', '12.0'], counts: {} }),
  };
}

const probe = (overrides: Partial<VersionSmokeProbe>): VersionSmokeProbe => ({
  id: 'probe-x', description: 'stub probe', kind: 'search', query: 'example', expect: {},
  ...overrides,
});

test('present expectation passes when a term hits the result corpus and fails when it does not', async () => {
  const provider = stubProvider([
    { drupalVersion: '11.4', title: 'Example API', snippet: 'uses ExampleManager' },
  ], {});
  const result = await runVersionSmoke(provider, {
    probes: [probe({ expect: { '11.4': 'present' }, terms: ['examplemanager'] })],
  });
  assert.equal(result.releaseGate, true);
  assert.equal(result.total, 1);
  assert.equal(result.cases[0].observed, 'present');
  const miss = await runVersionSmoke(provider, {
    probes: [probe({ id: 'probe-miss', expect: { '11.4': 'present' }, terms: ['nothing-like-this'] })],
  });
  assert.equal(miss.releaseGate, false);
  assert.equal(miss.cases[0].observed, 'absent');
});

test('absent expectation fails when the term appears and passes on empty results', async () => {
  const provider = stubProvider([{ drupalVersion: '12.0', title: 'Something', snippet: 'mentions RemovedThing' }], {});
  const leaked = await runVersionSmoke(provider, {
    probes: [probe({ expect: { '12.0': 'absent' }, terms: ['removedthing'] })],
  });
  assert.equal(leaked.releaseGate, false);
  assert.equal(leaked.cases[0].observed, 'present');
  const clean = await runVersionSmoke(provider, {
    probes: [probe({ id: 'probe-clean', expect: { '12.0': 'absent' }, terms: ['nothing-like-this'] })],
  });
  assert.equal(clean.releaseGate, true);
});

test('path terms are matched against repositoryPath only and any-of across terms', async () => {
  const provider = stubProvider([
    { drupalVersion: '11.4', title: 'Unrelated', snippet: 'no marker here', repositoryPath: 'core/themes/claro/theme.json' },
  ], {});
  const result = await runVersionSmoke(provider, {
    probes: [probe({ expect: { '11.4': 'present' }, pathTerms: ['themes/claro'] })],
  });
  assert.equal(result.cases[0].observed, 'present');
  const wrongPath = await runVersionSmoke(provider, {
    probes: [probe({ id: 'probe-path-miss', expect: { '11.4': 'present' }, pathTerms: ['modules/aggregator'] })],
  });
  assert.equal(wrongPath.cases[0].observed, 'absent');
});

test('entity probes treat found as present and not_found as absent', async () => {
  const provider = stubProvider([], { 'Drupal\\Core\\Example\\ExampleManagerInterface': 'found' });
  const found = await runVersionSmoke(provider, {
    probes: [probe({ kind: 'entity', identifier: 'Drupal\\Core\\Example\\ExampleManagerInterface', expect: { '11.4': 'present' } })],
  });
  assert.equal(found.releaseGate, true);
  const missing = await runVersionSmoke(provider, {
    probes: [probe({ id: 'probe-entity-miss', kind: 'entity', identifier: 'Drupal\\Core\\Gone', expect: { '11.4': 'absent' } })],
  });
  assert.equal(missing.releaseGate, true);
  assert.equal(missing.cases[0].observed, 'absent');
});

test('expectations are skipped for versions missing from the index and reported, not failed', async () => {
  const provider = stubProvider([], {});
  provider.getIndexStatus = async () => ({ ready: true, schemaVersion: 1, defaultDrupalVersion: '11.4', availableDrupalVersions: ['11.4'], counts: {} });
  const result = await runVersionSmoke(provider, {
    probes: [probe({ expect: { '10.6': 'present', '12.0': 'absent' } })],
  });
  assert.equal(result.total, 0);
  assert.equal(result.releaseGate, false, 'gate fails when nothing was checked');
  assert.equal(result.skipped[0].probeId, 'probe-x');
  assert.match(result.skipped[0].reason, /10\.6, 12\.0/);
});

test('a --version filter restricts which expectations are checked', async () => {
  const provider = stubProvider([
    { drupalVersion: '11.4', title: 'Claro', repositoryPath: 'core/themes/claro/claro.info.yml' },
  ], {});
  const result = await runVersionSmoke(provider, {
    versions: ['11.4'],
    probes: [probe({ expect: { '10.6': 'present', '11.4': 'present', '12.0': 'absent' }, pathTerms: ['themes/claro'] })],
  });
  assert.deepEqual(result.cases.map(item => item.version), ['11.4']);
  assert.equal(result.releaseGate, true);
});
