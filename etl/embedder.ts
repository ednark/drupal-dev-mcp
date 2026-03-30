import OpenAI from 'openai';
import { validateConfig } from '../src/config.js';
import type { Chunk } from './chunker.js';

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

const BATCH_SIZE = 512;
const MAX_RETRIES = 4;
const EMBEDDING_MODEL = 'text-embedding-3-small';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const config = validateConfig();
    client = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return client;
}

/**
 * Embed a batch of texts with retry on 429 and 5xx errors.
 */
async function embedBatch(texts: string[], attempt: number = 0): Promise<number[][]> {
  try {
    const openai = getClient();
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
    });
    return response.data.map((d) => d.embedding);
  }
  catch (err: unknown) {
    const error = err as { status?: number; message?: string };

    // Don't retry auth errors or bad requests
    if (error.status === 401 || error.status === 400) {
      throw err;
    }

    // Retry on rate limit (429) and server errors (5xx)
    if (attempt < MAX_RETRIES && (error.status === 429 || (error.status && error.status >= 500))) {
      const delay = 2 ** attempt * 1000 + Math.random() * 500;
      console.error(`  ⚠ Embedding API error (${error.status}), retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return embedBatch(texts, attempt + 1);
    }

    throw err;
  }
}

/**
 * Embed all chunks in batches. Returns chunks with embedding vectors attached.
 */
export async function embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
  const embedded: EmbeddedChunk[] = [];
  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);

  console.error(`  Embedding ${chunks.length} chunks in ${totalBatches} batches (model: ${EMBEDDING_MODEL})...`);

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const texts = batch.map((c) => c.text);
    const embeddings = await embedBatch(texts);

    for (let j = 0; j < batch.length; j += 1) {
      embedded.push({
        ...batch[j],
        embedding: embeddings[j],
      });
    }

    console.error(`  Batch ${batchNum}/${totalBatches} complete (${embedded.length}/${chunks.length} chunks embedded)`);
  }

  console.error(`  ✓ All ${embedded.length} chunks embedded`);
  return embedded;
}

