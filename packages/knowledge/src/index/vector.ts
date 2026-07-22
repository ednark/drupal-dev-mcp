import * as lancedb from '@lancedb/lancedb';
import OpenAI from 'openai';
import path from 'node:path';

export interface VectorRow extends Record<string, unknown> {
  chunk_id: string;
  vector: number[];
  source_type: string;
  project: string;
  drupal_version: string;
  authority: number;
}

export async function buildVectorIndex(options: {
  buildPath: string;
  chunks: Array<{ id: string; text: string; sourceType: string; project?: string; drupalVersion: string; authority: number }>;
  model: string;
  apiKey: string;
}): Promise<number> {
  if (options.chunks.length === 0) return 0;
  const client = new OpenAI({ apiKey: options.apiKey });
  const rows: VectorRow[] = [];
  const embeddingByText = new Map<string, number[]>();
  const batchSize = 100;
  for (let offset = 0; offset < options.chunks.length; offset += batchSize) {
    const batch = options.chunks.slice(offset, offset + batchSize);
    const uniqueTexts = [...new Set(batch.map(chunk => chunk.text).filter(text => !embeddingByText.has(text)))];
    if (uniqueTexts.length) {
      const response = await client.embeddings.create({ model: options.model, input: uniqueTexts });
      uniqueTexts.forEach((text, index) => embeddingByText.set(text, response.data[index].embedding));
    }
    for (const chunk of batch) {
      rows.push({ chunk_id: chunk.id, vector: embeddingByText.get(chunk.text)!, source_type: chunk.sourceType, project: chunk.project ?? '', drupal_version: chunk.drupalVersion, authority: chunk.authority });
    }
  }
  const db = await lancedb.connect(path.join(options.buildPath, 'vectors.lance'));
  await db.createTable('chunk_vectors', rows, { mode: 'overwrite' });
  return rows.length;
}
