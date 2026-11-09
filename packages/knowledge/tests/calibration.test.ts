import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deriveAnchors, resolveSemanticAnchors, measureSemanticCalibration, LEGACY_CALIBRATED_EMBEDDING_MODEL, LEGACY_SEMANTIC_ANCHORS } from '../src/index/calibration.js';
import { buildIndex } from '../src/index/builder.js';
import { resolveActiveBuild } from '../src/index/manifest.js';
import { SqliteKnowledgeProvider } from '../src/query/provider.js';

test('deriveAnchors: excellent=p10 of on-topic distances, irrelevant=median unrelated best, snapped to 0.05 grid', () => {
  // 8 on-topic top-8 distances (sorted): p10 nearest-rank → index ceil(0.1*7)=1 → 0.7.
  const onTopic = [0.62, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0];
  // Unrelated best-hit distances: median of [1.03,1.04,1.05,1.06] = 1.045 → snap up → 1.05.
  const unrelated = [1.06, 1.03, 1.05, 1.04];
  const anchors = deriveAnchors(onTopic, unrelated);
  assert.equal(anchors.excellent, 0.7);
  assert.equal(anchors.irrelevant, 1.05);
});

test('deriveAnchors: requires both distance families', () => {
  assert.throws(() => deriveAnchors([], [1.04]), /both/);
  assert.throws(() => deriveAnchors([0.7], []), /both/);
});

test('resolveSemanticAnchors: manifest calibration wins when the model matches', () => {
  const manifest = {
    embeddingModel: 'local-bge-small',
    semanticCalibration: { embeddingModel: 'local-bge-small', excellent: 0.5, irrelevant: 0.9, measuredAt: '2026-11-09T00:00:00Z', probeQueries: 12, method: 'test' },
  };
  const resolved = resolveSemanticAnchors(manifest);
  assert.deepEqual(resolved, { excellent: 0.5, irrelevant: 0.9, source: 'manifest' });
});

test('resolveSemanticAnchors: model/calibration mismatch refuses to guess (the silent-corruption guard)', () => {
  const manifest = {
    embeddingModel: 'a-different-model',
    semanticCalibration: { embeddingModel: 'local-bge-small', excellent: 0.5, irrelevant: 0.9, measuredAt: '2026-11-09T00:00:00Z', probeQueries: 12, method: 'test' },
  };
  assert.equal(resolveSemanticAnchors(manifest), null);
});

test('resolveSemanticAnchors: legacy hand-calibrated model falls back to 0.8/1.05; unknown model without calibration → null', () => {
  const legacy = resolveSemanticAnchors({ embeddingModel: LEGACY_CALIBRATED_EMBEDDING_MODEL });
  assert.deepEqual(legacy, { ...LEGACY_SEMANTIC_ANCHORS, source: 'legacy-default' });
  assert.equal(resolveSemanticAnchors({ embeddingModel: 'some-unmeasured-model' }), null);
  assert.equal(resolveSemanticAnchors({}), null);
});

/** Same fixture shape as index-and-query.test.ts. */
async function fixtureRepo(): Promise<{ repoRoot: string; indexRoot: string }> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'drupal-mcp-calibration-'));
  const sources = path.join(repoRoot, 'data', 'sources');
  const php = `<?php
namespace Drupal\\Core\\Example;
interface ExampleManagerInterface {}
class ExampleManager implements ExampleManagerInterface {
  public function version(): string { return 'v'; }
}
`;
  for (const version of ['10.6', '11.4', '12.0']) {
    const core = path.join(sources, `drupal-core-${version}`, 'core', 'lib', 'Drupal', 'Core', 'Example');
    await mkdir(core, { recursive: true });
    await writeFile(path.join(core, 'ExampleManager.php'), php);
  }
  return { repoRoot, indexRoot: path.join(repoRoot, 'data', 'index') };
}

/** Deterministic fake embedder: distance from a fixed point, bounded in [0, 1.4]. */
const fakeEmbed = async (texts: string[]): Promise<number[][]> =>
  texts.map(text => {
    const hash = [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 997, 7);
    return [hash / 997, (hash % 97) / 97];
  });

test('builder measures calibration with the same embedder; provider consumes it from the manifest', async () => {
  const { repoRoot, indexRoot } = await fixtureRepo();
  const result = await buildIndex({ repoRoot, indexRoot, withEmbeddings: true, embed: fakeEmbed, activate: true });
  assert.equal(result.verification.passed, true, result.verification.errors.join('; '));
  assert.ok(result.counts.vectors > 0);
  // Rule 1: calibration travels with the build.
  assert.ok(result.semanticCalibration, 'manifest carries semanticCalibration');
  assert.equal(result.semanticCalibration!.embeddingModel, result.embeddingModel);
  assert.ok(result.semanticCalibration!.excellent < result.semanticCalibration!.irrelevant, 'excellent < irrelevant');

  const active = await resolveActiveBuild(indexRoot);
  assert.ok(active?.semanticCalibration, 'active manifest carries calibration');
  const provider = await SqliteKnowledgeProvider.open(indexRoot, {
    // A local query embedder — same embedder that built the vectors. This is
    // the fully-offline path: manifest anchors + local embedder, no API key.
    queryEmbedder: async query => (await fakeEmbed([query]))[0]!,
  });
  try {
    // Rule 2 check, positive path: with manifest calibration present, semantic
    // mode must NOT report degraded (the fixture embedder's anchors are live).
    const search = await provider.search({ query: 'ExampleManager version', drupalVersion: '11.4', mode: 'semantic', limit: 3 });
    assert.equal(search.degradedMode, undefined);
    // The manifest field is surfaced through get_index_status.
    const status = await provider.getIndexStatus();
    assert.equal(status.semanticCalibration?.embeddingModel, result.embeddingModel);
  } finally {
    provider.close();
  }
});

test('measureSemanticCalibration: failures surface as errors, not wrong anchors', async () => {
  const buildPath = await mkdtemp(path.join(os.tmpdir(), 'drupal-mcp-calib-empty-'));
  // No vector table in the build path → LanceDB error, no anchors produced.
  await assert.rejects(
    () => measureSemanticCalibration({ buildPath, embeddingModel: 'x', embed: async () => [[0.1, 0.2]] }),
    /chunk_vectors|no model/,
  );
});

test('builds without embeddings carry no calibration; provider guard applies', async () => {
  const { repoRoot, indexRoot } = await fixtureRepo();
  const result = await buildIndex({ repoRoot, indexRoot, withEmbeddings: false, activate: true });
  assert.equal(result.semanticCalibration, undefined);
  const raw = JSON.parse(await readFile(path.join(indexRoot, 'active.json'), 'utf8'));
  assert.equal(raw.semanticCalibration, undefined);
  // No embedding model + no calibration → null (semantic mode refuses; nothing was ever measured).
  assert.equal(resolveSemanticAnchors(raw), null);
  // Legacy builds (embedding model recorded but no calibration field) keep working
  // via the hand-measured fallback: this is the pre-2026-11-09 build shape.
  const legacyShape = { ...raw, embeddingModel: LEGACY_CALIBRATED_EMBEDDING_MODEL };
  assert.deepEqual(resolveSemanticAnchors(legacyShape), { ...LEGACY_SEMANTIC_ANCHORS, source: 'legacy-default' });
});
