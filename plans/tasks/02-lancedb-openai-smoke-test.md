---
status: planned
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Task 02: LanceDB + OpenAI Smoke Test

## Depends On
- Task 01: Repository Scaffold

## Goal
Wire up the two core infrastructure libraries — LanceDB (the fully-embedded local vector store) and the OpenAI SDK (for embeddings and chat) — and prove they both work end-to-end before touching any ETL or MCP logic. LanceDB runs entirely in-process with no server, no Docker, and no external process — it stores data to disk as files under `data/lancedb/`, exactly like SQLite. The shared library modules produced here are imported by every other component. Catching API key issues or native-binding problems here prevents time-wasting failures deep in the ETL pipeline.

## Deliverables
- `src/lib/lancedb.ts` — helpers to open the LanceDB database, open/create the `drupal_core_docs` table, and run a vector similarity query
- `src/lib/openai.ts` — helpers to generate a single embedding and to call the chat completion API
- `src/config.ts` — fully implemented config loader and validator (replaces the stub from Task 01)
- `tests/smoke-test.ts` — runnable script that generates an embedding, stores it in LanceDB, queries it back, and prints the result
- The smoke test runs successfully: `npx ts-node tests/smoke-test.ts` exits 0 and prints a similarity-search result

## Implementation Steps

1. **Implement `src/config.ts`** — load and validate environment variables:
   ```typescript
   import * as dotenv from 'dotenv';
   dotenv.config();

   export interface AppConfig {
     openaiApiKey: string;
     lancedbPath: string;
     etlSourcesDir: string;
     drupalCoreBranch: string;
   }

   export function validateConfig(): AppConfig {
     const openaiApiKey = process.env.OPENAI_API_KEY;
     if (!openaiApiKey) {
       console.error('[drupal-architect] FATAL: OPENAI_API_KEY is not set.');
       console.error('[drupal-architect] Create a .env file with OPENAI_API_KEY=sk-...');
       process.exit(1);
     }
     return {
       openaiApiKey,
       lancedbPath: process.env.LANCEDB_PATH ?? './data/lancedb',
       etlSourcesDir: process.env.ETL_SOURCES_DIR ?? './data/sources',
       drupalCoreBranch: process.env.ETL_DRUPAL_CORE_BRANCH ?? '11.x',
     };
   }
   ```

2. **Implement `src/lib/openai.ts`** — thin wrappers around the OpenAI SDK:
   ```typescript
   import OpenAI from 'openai';

   let _client: OpenAI | null = null;

   export function getOpenAIClient(): OpenAI {
     if (!_client) {
       _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
     }
     return _client;
   }

   /** Generate a single 1536-dimension embedding vector for the given text. */
   export async function embed(text: string): Promise<number[]> {
     const client = getOpenAIClient();
     const response = await client.embeddings.create({
       model: 'text-embedding-3-small',
       input: text,
       encoding_format: 'float',
     });
     return response.data[0].embedding;
   }

   /** Call gpt-4o (or specified model) for a chat completion. */
   export async function chat(
     systemPrompt: string,
     userMessage: string,
     model: string = 'gpt-4o',
   ): Promise<string> {
     const client = getOpenAIClient();
     const response = await client.chat.completions.create({
       model,
       messages: [
         { role: 'system', content: systemPrompt },
         { role: 'user', content: userMessage },
       ],
       temperature: 0.2,
       max_tokens: 2048,
     });
     return response.choices[0].message.content ?? '';
   }
   ```

3. **Implement `src/lib/lancedb.ts`** — LanceDB helpers:
   ```typescript
   import * as lancedb from '@lancedb/lancedb';

   export const TABLE_NAME = 'drupal_core_docs';

   let _db: lancedb.Connection | null = null;

   export async function getDB(): Promise<lancedb.Connection> {
     if (!_db) {
       const dbPath = process.env.LANCEDB_PATH ?? './data/lancedb';
       _db = await lancedb.connect(dbPath);
     }
     return _db;
   }

   export interface LanceQueryResult {
     id: string;
     text: string;
     source: string;
     symbol_name: string;
     fqcn: string;
     file_path: string;
     drupal_version: string;
     section: string;
     chunk_index: number;
     _distance: number;
   }

   /**
    * Run a vector similarity search against the drupal_core_docs table.
    *
    * @param queryVector  1536-dimension embedding of the user's question
    * @param nResults     Number of top results to return (default 10)
    * @param drupalVersion  Optional version filter (e.g. "11.x")
    */
   export async function vectorSearch(
     queryVector: number[],
     nResults: number = 10,
     drupalVersion?: string,
   ): Promise<LanceQueryResult[]> {
     const db = await getDB();
     const table = await db.openTable(TABLE_NAME);

     let query = table.vectorSearch(queryVector).limit(nResults);

     if (drupalVersion) {
       query = query.where(`drupal_version = '${drupalVersion}'`);
     }

     const rows = await query.toArray();
     return rows as LanceQueryResult[];
   }
   ```

4. **Create `tests/smoke-test.ts`** — end-to-end verification:
   ```typescript
   /**
    * Smoke test: embed a short text, store it in LanceDB, query it back.
    * Run with: npx ts-node tests/smoke-test.ts
    *
    * Prerequisites:
    *   - OPENAI_API_KEY set in .env
    *   - No server or Docker required — LanceDB is fully embedded
    */
   import * as dotenv from 'dotenv';
   dotenv.config();

   import * as lancedb from '@lancedb/lancedb';
   import { embed } from '../src/lib/openai.js';

   const LANCEDB_PATH = process.env.LANCEDB_PATH ?? './data/lancedb';
   const SMOKE_TABLE = 'smoke_test';

   async function main() {
     console.log('=== Drupal Architect MCP — Smoke Test ===\n');

     // 1. Open LanceDB (fully embedded — no server needed)
     console.log('[1/5] Opening LanceDB database...');
     const db = await lancedb.connect(LANCEDB_PATH);
     console.log(`  ✓ LanceDB connected at ${LANCEDB_PATH} (in-process, no server)`);

     // 2. Generate embedding
     console.log('\n[2/5] Generating embedding for test text...');
     const testText = 'How do I implement a custom access checker in Drupal?';
     const embedding = await embed(testText);
     console.log(`  ✓ Embedding generated: ${embedding.length} dimensions`);
     console.log(`  First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(6)).join(', ')}]`);

     // 3. Create smoke table and insert a record
     console.log('\n[3/5] Creating smoke table and inserting test record...');
     // Drop table if it exists from a previous run
     const existingTables = await db.tableNames();
     if (existingTables.includes(SMOKE_TABLE)) {
       await db.dropTable(SMOKE_TABLE);
     }
     const records = [
       {
         id: 'smoke-001',
         text: testText,
         vector: embedding,
         source: 'drupal_phpdoc',
         symbol_name: 'AccessCheckInterface',
         fqcn: 'Drupal\\Core\\Access\\AccessCheckInterface',
         file_path: 'core/lib/Drupal/Core/Access/AccessCheckInterface.php',
         drupal_version: '11.x',
         section: 'Interface',
         chunk_index: 0,
         ingested_at: new Date().toISOString(),
       },
     ];
     await db.createTable(SMOKE_TABLE, records);
     console.log('  ✓ Smoke table created and record inserted');

     // 4. Query it back
     console.log('\n[4/5] Running vector similarity query...');
     const queryEmbedding = await embed('Drupal custom access checker service tagged');
     const table = await db.openTable(SMOKE_TABLE);
     const results = await table.vectorSearch(queryEmbedding).limit(1).toArray();

     if (!results.length) {
       throw new Error('Query returned no results — LanceDB vector search failed.');
     }

     const hit = results[0];
     console.log('  ✓ Query result:');
     console.log(`    id:           ${hit.id}`);
     console.log(`    symbol_name:  ${hit.symbol_name}`);
     console.log(`    _distance:    ${(hit._distance as number).toFixed(6)}`);
     console.log(`    text:         ${(hit.text as string).slice(0, 80)}...`);

     // 5. Cleanup
     console.log('\n[5/5] Dropping smoke table...');
     await db.dropTable(SMOKE_TABLE);
     console.log('  ✓ Smoke table dropped');

     console.log('\n✅ Smoke test PASSED — LanceDB and OpenAI are working correctly.');
     console.log('   (No Docker or server was required — LanceDB ran fully in-process.)');
   }

   main().catch(err => {
     console.error('\n❌ Smoke test FAILED:', err.message);
     if (err.message?.includes('OPENAI_API_KEY') || err.message?.includes('401')) {
       console.error('\n   Is OPENAI_API_KEY set in your .env file?');
     }
     process.exit(1);
   });
   ```

5. **Run the smoke test**:
   ```bash
   npx ts-node tests/smoke-test.ts
   ```

6. **Rebuild** to ensure everything compiles:
   ```bash
   npm run build
   ```

## Verification / Done Criteria

```bash
npx ts-node tests/smoke-test.ts
```

Expected output:
```
=== Drupal Architect MCP — Smoke Test ===

[1/5] Opening LanceDB database...
  ✓ LanceDB connected at ./data/lancedb (in-process, no server)

[2/5] Generating embedding for test text...
  ✓ Embedding generated: 1536 dimensions
  First 5 values: [0.012345, -0.034567, ...]

[3/5] Creating smoke table and inserting test record...
  ✓ Smoke table created and record inserted

[4/5] Running vector similarity query...
  ✓ Query result:
    id:           smoke-001
    symbol_name:  AccessCheckInterface
    _distance:    0.012345
    text:         How do I implement a custom access checker in Drupal?...

[5/5] Dropping smoke table...
  ✓ Smoke table dropped

✅ Smoke test PASSED — LanceDB and OpenAI are working correctly.
   (No Docker or server was required — LanceDB ran fully in-process.)
```

Also verify:
```bash
npm run build
# Expected: exits 0, zero TypeScript errors
```

## Notes / Gotchas

- **No server, no Docker**: LanceDB is a fully embedded vector database. The `@lancedb/lancedb` npm package runs entirely in-process. There is nothing to start, stop, or configure beyond the npm install. Data lands in `data/lancedb/` as flat files on disk.
- **`apache-arrow` must be installed**: LanceDB requires `apache-arrow` as a peer dependency. Ensure it is listed alongside `@lancedb/lancedb` in `package.json` `dependencies`.
- **LanceDB native bindings**: LanceDB ships native Rust-compiled Node bindings. On macOS, Xcode Command Line Tools are required (`xcode-select --install`). The bindings are pre-compiled for common platforms and downloaded during `npm install` — no manual compilation needed.
- **`vector` field name**: LanceDB uses the field named `vector` for ANN (approximate nearest neighbour) search by default. The `vectorSearch()` call automatically uses this field.
- **`_distance`**: LanceDB adds a `_distance` field to each result row. Lower distance = more similar. With the default metric (L2/Euclidean) the value represents squared Euclidean distance. For cosine similarity, configure the index metric explicitly.
- **Real API calls**: The smoke test makes 2 OpenAI embedding calls — negligible cost (< $0.001 total). Ensure `OPENAI_API_KEY` is set in `.env`.
- **`createTable` with `mode: 'overwrite'`**: When re-creating a table that already exists, pass `{ mode: 'overwrite' }` as the third argument to `db.createTable()`. In the smoke test we use `db.dropTable()` first for clarity, but `overwrite` mode is more concise for ETL code.
