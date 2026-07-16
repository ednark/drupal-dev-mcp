import OpenAI from 'openai';
import { validateConfig } from '../src/config.js';
import type { Chunk } from './chunker.js';
import { writeFileSync, createReadStream, existsSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

const BATCH_SIZE = 100;
const MAX_RETRIES = 6;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHECKPOINT_DIR = './data/cache/embed-checkpoint';
const CHECKPOINT_FILE = `${CHECKPOINT_DIR}/embedded.jsonl`;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const config = validateConfig();
    client = new OpenAI({
      apiKey: config.openaiApiKey,
      // Use Node 22 native fetch — node-fetch's gunzip has premature-close bugs
      // on large compressed streaming responses from the embeddings endpoint.
      fetch: globalThis.fetch as any,
      timeout: 120_000,
      maxRetries: 0, // we handle retries ourselves in embedBatch()
    });
  }
  return client;
}

function isRetryableError(err: unknown): boolean {
  const error = err as { status?: number; message?: string; type?: string; code?: string };
  // Auth / bad request — never retry
  if (error.status === 401 || error.status === 400) return false;
  // Rate limit and server errors — retry
  if (error.status === 429 || (error.status && error.status >= 500)) return true;
  // Transient network errors without HTTP status (premature close, ECONNRESET, etc.)
  if (!error.status || error.type === 'system') return true;
  // FetchError / network-level failures
  if (error.code && (error.code.startsWith('ERR_') || error.code.includes('ETIMEDOUT') || error.code.includes('ECONNRESET'))) return true;
  return false;
}

/**
 * Embed a batch of texts with retry on 429, 5xx, and transient network errors.
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
    const error = err as { status?: number; message?: string; code?: string };

    if (attempt < MAX_RETRIES && isRetryableError(err)) {
      const delay = Math.min(2 ** attempt * 1000 + Math.random() * 500, 30000);
      console.error(`  ⚠ Embedding error (${error.status ?? error.code ?? 'network'}), retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return embedBatch(texts, attempt + 1);
    }

    throw err;
  }
}

async function loadCheckpoint(): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  if (!existsSync(CHECKPOINT_FILE)) return map;
  const stream = createReadStream(CHECKPOINT_FILE, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.id && obj.embedding) map.set(obj.id, obj.embedding);
    } catch { /* skip malformed line */ }
  }
  console.error(`  📂 Loaded ${map.size} embedded chunks from checkpoint`);
  return map;
}

function appendCheckpoint(id: string, text: string, embedding: number[], metadata: any) {
  if (!existsSync(CHECKPOINT_DIR)) mkdirSync(CHECKPOINT_DIR, { recursive: true });
  const line = JSON.stringify({ id, text, embedding, metadata }) + '\n';
  writeFileSync(CHECKPOINT_FILE, line, { flag: 'a' });
}

/**
 * Embed all chunks in batches. Returns chunks with embedding vectors attached.
 * Checkpoints to disk so partial progress survives network failures.
 */
export async function embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
  const checkpoint = await loadCheckpoint();

  const toEmbed: Chunk[] = [];
  const embedded: EmbeddedChunk[] = [];
  for (const c of chunks) {
    const cached = checkpoint.get(c.metadata.id);
    if (cached) {
      embedded.push({ ...c, embedding: cached });
    } else {
      toEmbed.push(c);
    }
  }

  console.error(`  Embedding ${toEmbed.length}/${chunks.length} chunks in ${Math.ceil(toEmbed.length / BATCH_SIZE)} batches (${embedded.length} cached, model: ${EMBEDDING_MODEL})...`);

  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalToEmbed = Math.ceil(toEmbed.length / BATCH_SIZE);

    const texts = batch.map((c) => c.text);
    const embeddings = await embedBatch(texts);

    for (let j = 0; j < batch.length; j += 1) {
      const chunk = batch[j];
      const emb = embeddings[j];
      embedded.push({ ...chunk, embedding: emb });
      appendCheckpoint(chunk.metadata.id, chunk.text, emb, chunk.metadata);
    }

    console.error(`  Batch ${batchNum}/${totalToEmbed} complete (${embedded.length}/${chunks.length} chunks embedded)`);
  }

  console.error(`  ✓ All ${embedded.length} chunks embedded`);
  return embedded;
}

