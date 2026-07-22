import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as lancedb from '@lancedb/lancedb';
import { buildVectorIndex } from '../src/index/vector.js';

test('unified vector table reuses embeddings by model and content hash', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drupal-mcp-vector-'));
  const cachePath = path.join(root, 'embedding-cache.sqlite');
  const chunks = [
    { id: 'chk_one', text: 'one', contentHash: 'hash-one', sourceType: 'core_code', project: 'drupal', drupalVersion: '11.4', authority: 100 },
    { id: 'chk_two', text: 'two', contentHash: 'hash-two', sourceType: 'api', project: 'drupal', drupalVersion: '10.6', authority: 100 },
  ];
  let embedded = 0;
  const embed = async (texts: string[]) => { embedded += texts.length; return texts.map((_, index) => [index + 0.1, index + 0.2]); };
  const firstPath = path.join(root, 'build-one');
  await mkdir(firstPath);
  const first = await buildVectorIndex({ buildPath: firstPath, chunks, model: 'fixture-model', cachePath, embed });
  assert.deepEqual(first, { vectorCount: 2, embeddedCount: 2, reusedCount: 0 });
  const secondPath = path.join(root, 'build-two');
  await mkdir(secondPath);
  const second = await buildVectorIndex({ buildPath: secondPath, chunks, model: 'fixture-model', cachePath, embed });
  assert.deepEqual(second, { vectorCount: 2, embeddedCount: 0, reusedCount: 2 });
  assert.equal(embedded, 2);
  const db = await lancedb.connect(path.join(secondPath, 'vectors.lance'));
  assert.deepEqual(await db.tableNames(), ['chunk_vectors']);
  const table = await db.openTable('chunk_vectors');
  assert.equal(await table.countRows(), 2);
});
