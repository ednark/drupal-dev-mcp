import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocalModel, createLocalEmbedder } from '../src/index/local-embed.js';

test('resolveLocalModel: default preset is bge-small-en-v1.5 with the retrieval instruction on queries only', () => {
  const preset = resolveLocalModel();
  assert.equal(preset.modelId, 'Xenova/bge-small-en-v1.5');
  assert.match(preset.queryPrefix, /Represent this sentence for searching relevant passages/);
  assert.equal(preset.documentPrefix, '');
  assert.equal(preset.dims, 384);
});

test('resolveLocalModel: nomic preset carries the search_query/search_document contract', () => {
  const preset = resolveLocalModel('nomic-embed-text-v1.5');
  assert.equal(preset.queryPrefix, 'search_query: ');
  assert.equal(preset.documentPrefix, 'search_document: ');
  assert.equal(preset.dims, 768);
});

test('resolveLocalModel: ad-hoc HuggingFace ids pass through without invented prefixes', () => {
  const preset = resolveLocalModel('Xenova/some-experimental-model');
  assert.equal(preset.modelId, 'Xenova/some-experimental-model');
  assert.equal(preset.queryPrefix, '');
  assert.equal(preset.documentPrefix, '');
});

test('createLocalEmbedder: lazy — nothing loads until first use; empty batch short-circuits', async () => {
  const embedder = createLocalEmbedder();
  assert.equal(embedder.initialized, false, 'transformers.js must not load at creation (default paths never touch it)');
  assert.deepEqual(await embedder.embed([]), []);
  assert.equal(embedder.initialized, false, 'empty batch must not instantiate the pipeline');
});

test('createLocalEmbedder: prefixes are overridable', () => {
  const embedder = createLocalEmbedder({ prefixes: { query: 'Q: ', document: 'D: ' } });
  assert.equal(embedder.preset.queryPrefix, 'Q: ');
  assert.equal(embedder.preset.documentPrefix, 'D: ');
});

// Real-model integration: downloads ~35MB on first run, then cached and fully
// offline. Opt-in so routine test runs (and CI) never touch the network:
//   RUN_LOCAL_EMBED_TESTS=1 npx tsx --test packages/knowledge/tests/local-embed.test.ts
const RUN_REAL = process.env.RUN_LOCAL_EMBED_TESTS === '1';

test('local embedder end-to-end: real model, normalized vectors, query/document prefixes', { skip: !RUN_REAL }, async () => {
  const embedder = createLocalEmbedder();
  const vectors = await embedder.embed([
    'Cache tags allow precise invalidation of rendered output when entities change.',
    'The service locator anti-pattern hides dependencies and prevents static analysis.',
  ]);
  assert.equal(vectors.length, 2);
  assert.equal(vectors[0]!.length, 384, 'bge-small-en-v1.5 produces 384-dim vectors');
  for (const vector of vectors) {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    assert.ok(Math.abs(norm - 1) < 0.01, `normalized vector (norm=${norm.toFixed(4)})`);
  }
  const queryVector = await embedder.embedQuery('how do I invalidate a block when content changes');
  assert.equal(queryVector.length, 384);
  assert.notDeepEqual(queryVector, vectors[0], 'query prefix produces a distinct vector');
});
