import * as lancedb from '@lancedb/lancedb';
import OpenAI from 'openai';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface VectorRow extends Record<string, unknown> {
  chunk_id: string;
  vector: number[];
  source_type: string;
  project: string;
  drupal_version: string;
  authority: number;
  content_hash: string;
  embedding_model: string;
}

export interface VectorBuildResult {
  vectorCount: number;
  embeddedCount: number;
  reusedCount: number;
}

export async function buildVectorIndex(options: {
  buildPath: string;
  chunks: Array<{ id: string; text: string; contentHash: string; sourceType: string; project?: string; drupalVersion: string; authority: number }>;
  model: string;
  apiKey?: string;
  cachePath: string;
  embed?: (texts: string[]) => Promise<number[][]>;
}): Promise<VectorBuildResult> {
  if (options.chunks.length === 0) return { vectorCount: 0, embeddedCount: 0, reusedCount: 0 };
  const client = options.embed ? undefined : new OpenAI({ apiKey: options.apiKey });
  const embed = options.embed ?? (async (texts: string[]) => {
    if (!options.apiKey) throw new Error('OPENAI_API_KEY is required to build vector embeddings');
    const response = await client!.embeddings.create({ model: options.model, input: texts });
    return response.data.map(item => item.embedding);
  });
  const cache = new Database(options.cachePath);
  cache.pragma('journal_mode = WAL');
  cache.exec(`CREATE TABLE IF NOT EXISTS embedding_cache (
    model TEXT NOT NULL, content_hash TEXT NOT NULL, vector_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(model, content_hash)
  )`);
  const rows: VectorRow[] = [];
  const embeddingByHash = new Map<string, number[]>();
  const unique = new Map(options.chunks.map(chunk => [chunk.contentHash, chunk.text]));
  const select = cache.prepare('SELECT vector_json FROM embedding_cache WHERE model=? AND content_hash=?');
  for (const hash of unique.keys()) {
    const cached = select.get(options.model, hash) as { vector_json: string } | undefined;
    if (cached) embeddingByHash.set(hash, JSON.parse(cached.vector_json) as number[]);
  }
  const reusedCount = options.chunks.filter(chunk => embeddingByHash.has(chunk.contentHash)).length;
  const missing = [...unique.entries()].filter(([hash]) => !embeddingByHash.has(hash));
  const batchSize = 100;
  const insert = cache.prepare('INSERT OR REPLACE INTO embedding_cache(model, content_hash, vector_json, created_at) VALUES (?, ?, ?, ?)');
  for (let offset = 0; offset < missing.length; offset += batchSize) {
    const batch = missing.slice(offset, offset + batchSize);
    const vectors = await embed(batch.map(([, text]) => text));
    if (vectors.length !== batch.length) throw new Error('Embedding provider returned an unexpected vector count');
    const transaction = cache.transaction(() => batch.forEach(([hash], index) => {
      embeddingByHash.set(hash, vectors[index]);
      insert.run(options.model, hash, JSON.stringify(vectors[index]), new Date().toISOString());
    }));
    transaction();
  }
  for (const chunk of options.chunks) rows.push({
    chunk_id: chunk.id, vector: embeddingByHash.get(chunk.contentHash)!, source_type: chunk.sourceType,
    project: chunk.project ?? '', drupal_version: chunk.drupalVersion, authority: chunk.authority,
    content_hash: chunk.contentHash, embedding_model: options.model,
  });
  cache.close();
  const db = await lancedb.connect(path.join(options.buildPath, 'vectors.lance'));
  await db.createTable('chunk_vectors', rows, { mode: 'overwrite' });
  return { vectorCount: rows.length, embeddedCount: missing.length, reusedCount };
}
