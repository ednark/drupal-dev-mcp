---
status: planned
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Task 08: Embedder + LanceDB Loader

## Depends On
- Task 02: LanceDB + OpenAI Smoke Test (`src/lib/lancedb.ts` and `src/lib/openai.ts` in place)
- Task 07: Chunker (provides `Chunk` type and `chunkPages()`)

## Goal
Implement `etl/embedder.ts` and `etl/loader.ts`. The embedder calls the OpenAI `text-embedding-3-small` API in batches with exponential-backoff retry, converting each chunk's text into a 1536-dimension vector. The loader upserts all embedded chunks into the LanceDB `drupal_core_docs` table with full metadata. LanceDB is fully embedded — no server, no Docker required. Together these two modules close the ETL pipeline — after this task, data can reach the vector store and a manual LanceDB query can confirm it arrived correctly.

## Deliverables
- `etl/embedder.ts` — batched embedding with retry; exports `EmbeddedChunk` type and `embedChunks()` function
- `etl/loader.ts` — LanceDB upsert in batches of 1,000 with progress logging; exports `loadChunks()`
- Mini end-to-end test: embed 5 sample User Guide chunks, upsert to LanceDB, query them back — confirms the whole pipeline path works before running the full ETL

## Implementation Steps

1. **Implement `etl/embedder.ts`**:
   ```typescript
   import OpenAI from 'openai';
   import { Chunk } from './chunker.js';

   const BATCH_SIZE = 512; // Conservative — API max is 2048; smaller batches aid debugging

   export interface EmbeddedChunk extends Chunk {
     embedding: number[];  // 1536 dimensions from text-embedding-3-small
   }

   const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

   function sleep(ms: number): Promise<void> {
     return new Promise(resolve => setTimeout(resolve, ms));
   }

   /**
    * Embed a batch of texts with exponential backoff on rate-limit and server errors.
    * Retries up to 4 times (total 5 attempts).
    */
   async function embedBatch(texts: string[], attempt = 0): Promise<number[][]> {
     try {
       const response = await openai.embeddings.create({
         model: 'text-embedding-3-small',
         input: texts,
         encoding_format: 'float',
       });
       return response.data.map(d => d.embedding);
     } catch (err: any) {
       if (attempt >= 4) throw err;
       const isRateLimit = err?.status === 429 || err?.code === 'rate_limit_exceeded';
       const isServerError = err?.status >= 500;
       if (!isRateLimit && !isServerError) throw err; // Non-retryable error

       const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
       console.warn(
         `  ⚠ Embed attempt ${attempt + 1} failed (HTTP ${err.status ?? 'unknown'}). ` +
         `Retrying in ${(delayMs / 1000).toFixed(1)}s...`
       );
       await sleep(delayMs);
       return embedBatch(texts, attempt + 1);
     }
   }

   /**
    * Embed all chunks in batches of BATCH_SIZE.
    * Logs progress after each batch.
    */
   export async function embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
     const results: EmbeddedChunk[] = [];

     for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
       const batch = chunks.slice(i, i + BATCH_SIZE);
       const embeddings = await embedBatch(batch.map(c => c.chunk_text));
       batch.forEach((chunk, j) => {
         results.push({ ...chunk, embedding: embeddings[j] });
       });
       const done = Math.min(i + BATCH_SIZE, chunks.length);
       console.log(`  → Embedded ${done}/${chunks.length} chunks`);
     }

     return results;
   }
   ```

2. **Implement `etl/loader.ts`**:
   ```typescript
   import * as lancedb from '@lancedb/lancedb';
   import { EmbeddedChunk } from './embedder.js';

   const TABLE_NAME = 'drupal_core_docs';
   const BATCH_SIZE = 1000; // Insert rows in batches to avoid memory pressure

   /**
    * Load all embedded chunks into the LanceDB drupal_core_docs table.
    *
    * On the first run: creates the table.
    * On re-runs: drops and recreates the table (full reload — safe for MVP).
    * The SHA-256 chunk IDs ensure stable identity across re-runs.
    *
    * LanceDB is fully embedded — no server or Docker required.
    *
    * @param embeddedChunks  Output of embedChunks()
    * @param lancedbPath     Path to LanceDB data directory (default: process.env.LANCEDB_PATH)
    */
   export async function loadChunks(
     embeddedChunks: EmbeddedChunk[],
     lancedbPath?: string,
   ): Promise<void> {
     const dbPath = lancedbPath ?? process.env.LANCEDB_PATH ?? './data/lancedb';
     const db = await lancedb.connect(dbPath);

     // Drop existing table to allow full re-run without duplicate rows
     const existingTables = await db.tableNames();
     if (existingTables.includes(TABLE_NAME)) {
       await db.dropTable(TABLE_NAME);
       console.log(`  → Dropped existing '${TABLE_NAME}' table for fresh load`);
     }

     console.log(`  Loading ${embeddedChunks.length} chunks into LanceDB table '${TABLE_NAME}'...`);

     // Build all rows up front for the first batch (LanceDB infers schema from first add)
     const allRows = embeddedChunks.map(c => ({
       id:             c.metadata.id,
       text:           c.chunk_text,
       vector:         c.embedding,               // LanceDB default ANN search field
       source:         c.metadata.source,
       symbol_name:    c.metadata.symbol_name ?? '',
       fqcn:           c.metadata.fqcn ?? '',
       file_path:      c.metadata.file_path ?? '',
       drupal_version: c.metadata.drupal_version,
       section:        c.metadata.section ?? '',
       chunk_index:    c.metadata.chunk_index,
       ingested_at:    c.metadata.ingested_at,
     }));

     // Create the table with the first batch, then append remaining batches
     let table: lancedb.Table | null = null;
     for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
       const batch = allRows.slice(i, i + BATCH_SIZE);
       if (i === 0) {
         table = await db.createTable(TABLE_NAME, batch);
       } else {
         await table!.add(batch);
       }
       const done = Math.min(i + BATCH_SIZE, allRows.length);
       console.log(`  → Loaded ${done}/${allRows.length} chunks`);
     }

     // Report final count
     const total = await table!.countRows();
     console.log(`\n  ✓ Table '${TABLE_NAME}' ready with ${total} rows`);
   }
   ```

3. **Create a mini end-to-end verification** `etl/verify-loader.ts` — uses only ~5 User Guide chunks to confirm the full stub pipeline without triggering a big API cost:
   ```typescript
   import * as dotenv from 'dotenv';
   dotenv.config();

   import * as path from 'path';
   import * as lancedb from '@lancedb/lancedb';
   import { parseUserGuideMarkdown } from './parser.js';
   import { chunkPages } from './chunker.js';
   import { embedChunks } from './embedder.js';
   import { loadChunks } from './loader.js';
   import { embed } from '../src/lib/openai.js';

   const sourcesDir = process.env.ETL_SOURCES_DIR ?? './data/sources';
   const lancedbPath = process.env.LANCEDB_PATH ?? './data/lancedb';
   const SAMPLE_SIZE = 5;

   async function main() {
     console.log('=== Embedder + Loader Verification (sample run) ===\n');

     // 1. Parse a few User Guide sections
     console.log('[1/4] Parsing User Guide...');
     const mdPath = path.join(sourcesDir, 'drupal-user-guide.md');
     const pages = (await parseUserGuideMarkdown(mdPath)).slice(0, SAMPLE_SIZE);
     console.log(`  → Using first ${pages.length} pages`);

     // 2. Chunk
     console.log('[2/4] Chunking...');
     const chunks = await chunkPages(pages);
     console.log(`  → ${chunks.length} chunks`);

     // 3. Embed
     console.log('[3/4] Embedding (will make OpenAI API calls)...');
     const embedded = await embedChunks(chunks);
     console.log(`  → ${embedded.length} embedded chunks`);
     console.log(`  → Embedding dimensions: ${embedded[0].embedding.length}`);

     // 4. Load into LanceDB (fully embedded — no server needed)
     console.log('[4/4] Loading into LanceDB...');
     await loadChunks(embedded);

     // 5. Verify with a semantic query
     console.log('\n[5/5] Verifying with a semantic query...');
     const db = await lancedb.connect(lancedbPath);
     const table = await db.openTable('drupal_core_docs');
     const queryVector = await embed('What is Drupal and what is it used for?');
     const results = await table.vectorSearch(queryVector).limit(3).toArray();

     console.log(`  → Top ${results.length} results:`);
     results.forEach((row: any, i: number) => {
       console.log(`\n  [${i + 1}] ID: ${row.id.slice(0, 16)}...`);
       console.log(`      Section: ${row.section}`);
       console.log(`      Distance: ${(row._distance as number).toFixed(4)}`);
       console.log(`      Preview: ${(row.text as string).slice(0, 100).replace(/\n/g, ' ')}...`);
     });

     console.log('\n✅ Embedder + Loader verification PASSED');
     console.log('   Full ETL pipeline confirmed working end-to-end.');
     console.log('   (LanceDB ran fully in-process — no server or Docker used.)');
   }

   main().catch(err => {
     console.error('\n❌ Verification failed:', err.message);
     process.exit(1);
   });
   ```

4. **Run the verification** (costs ~$0.001 in API credits for 5 chunks):
   ```bash
   npx ts-node etl/verify-loader.ts
   ```

5. **Typecheck**:
   ```bash
   npm run typecheck
   ```

6. **Commit**:
   ```bash
   rm etl/verify-loader.ts
   git add etl/embedder.ts etl/loader.ts
   git commit -m "feat(etl): implement embedder and LanceDB loader"
   ```

## Verification / Done Criteria

```bash
npx ts-node etl/verify-loader.ts
```

Expected output:
```
=== Embedder + Loader Verification (sample run) ===

[1/4] Parsing User Guide...
  → Using first 5 pages

[2/4] Chunking...
  → 13 chunks

[3/4] Embedding (will make OpenAI API calls)...
  → Embedded 13 chunks
  → Embedding dimensions: 1536

[4/4] Loading into LanceDB...
  Loading 13 chunks into LanceDB table 'drupal_core_docs'...
  → Loaded 13/13 chunks

  ✓ Table 'drupal_core_docs' ready with 13 rows

[5/5] Verifying with a semantic query...
  → Top 3 results:

  [1] ID: a3f2d9e1b04c8...
      Section: Understanding Drupal
      Distance: 0.0823
      Preview: ## Understanding Drupal  Drupal is content management software...

  ...

✅ Embedder + Loader verification PASSED
   Full ETL pipeline confirmed working end-to-end.
   (LanceDB ran fully in-process — no server or Docker used.)
```

**Done criteria**:
- Exits 0
- Embedding dimensions printed = `1536`
- Table row count > 0 after load
- Semantic query returns 3 results with distances < 0.5
- `npm run typecheck` exits 0

## Notes / Gotchas

- **LanceDB is fully embedded**: No server, no Docker, no `docker run` commands needed. The `@lancedb/lancedb` package runs entirely in-process. Data files land in `data/lancedb/` on disk.
- **`vector` is the magic field name**: LanceDB performs ANN search on the field named `vector` by default. Always use this exact field name in your row objects. (The `vectorSearch()` method looks for this field automatically.)
- **`_distance` in results**: LanceDB appends a `_distance` field to each result row. Lower = more similar. The default metric is L2 (Euclidean). Cosine distance can be configured when creating an IVF-PQ index.
- **Full reload strategy for MVP**: The loader drops and recreates the table on every ETL run. This is the safest approach for MVP — it guarantees no stale or duplicate rows. The SHA-256 chunk IDs provide stable identity if you later switch to a merge/upsert strategy.
- **Schema inference**: LanceDB infers the table schema from the first batch of rows passed to `createTable()`. Ensure every field is present and has the correct type in the first batch — missing or mistyped fields in the first batch will cause issues.
- **Batch size 1,000**: Inserting in batches of 1,000 rows avoids memory pressure for large corpora. LanceDB handles batching efficiently on disk.
- **Exponential backoff**: The retry logic in the embedder handles OpenAI rate limits (HTTP 429) and transient server errors (HTTP 5xx). It does NOT retry on authentication errors (HTTP 401) or invalid request errors (HTTP 400).
- **Cost of the full ETL**: Embedding ~25,000 chunks at ~400 tokens/chunk using `text-embedding-3-small` at $0.02/1M tokens costs roughly **$0.20**. The verification script uses only 5 pages (~13 chunks) and costs < $0.001.
