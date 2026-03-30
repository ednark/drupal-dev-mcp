---
status: planned
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Task 09: ETL Runner

## Depends On
- Task 04: PHPDoc Parser
- Task 05: Docset Parser
- Task 06: User Guide Parser
- Task 07: Chunker
- Task 08: Embedder + LanceDB Loader

## Goal
Implement `etl/run.ts` — the single entry-point that orchestrates the complete ETL pipeline: parse all three source types, chunk the results, embed, and load into LanceDB. LanceDB is fully embedded — no server or Docker required. The runner must support a `--dry-run` flag that stops after chunk (skipping the costly embed/load steps) so developers can verify parsing and chunking without spending OpenAI credits. After this task the full corpus can be ingested with a single `npm run` command, and row counts can be confirmed directly in LanceDB.

## Deliverables
- `etl/run.ts` — full ETL orchestrator with summary output and `--dry-run` support
- `npm run etl:drupal-core-docs:dry-run` completes successfully, printing page + chunk counts
- `npm run etl:drupal-core-docs` completes the full pipeline; LanceDB table row count is between 15,000 and 40,000
- `npm run typecheck` passes

## Implementation Steps

1. **Implement `etl/run.ts`**:
   ```typescript
   import * as dotenv from 'dotenv';
   dotenv.config();

   import * as path from 'path';
   import { parsePHPDocFiles, parseDocset, parseUserGuideMarkdown, ParsedPage } from './parser.js';
   import { chunkPages } from './chunker.js';
   import { embedChunks } from './embedder.js';
   import { loadChunks } from './loader.js';
   import * as lancedb from '@lancedb/lancedb';

   const isDryRun = process.argv.includes('--dry-run');
   const startTime = Date.now();
   const sourcesDir = process.env.ETL_SOURCES_DIR ?? './data/sources';
   const drupalVersion = process.env.ETL_DRUPAL_CORE_BRANCH ?? '11.x';
   const lancedbPath = process.env.LANCEDB_PATH ?? './data/lancedb';

   async function main() {
     console.log('\n=== Drupal Core Docs ETL ===');
     console.log(`Mode:        ${isDryRun ? 'DRY RUN (parse + chunk only, no API calls)' : 'FULL'}`);
     console.log(`Sources dir: ${path.resolve(sourcesDir)}`);
     console.log(`Drupal ver:  ${drupalVersion}`);
     console.log(`LanceDB:     ${lancedbPath} (fully embedded — no server)`);
     console.log('');

     // ── Step 1: Parse ──────────────────────────────────────────────────────────
     console.log('[1/4] Parsing sources...');

     const coreDir    = path.join(sourcesDir, 'drupal-core');
     const docsetPath = path.join(sourcesDir, 'Drupal.docset');
     const guidePath  = path.join(sourcesDir, 'drupal-user-guide.md');

     const [phpdocPages, docsetPages, guidePages] = await Promise.all([
       parsePHPDocFiles(coreDir, drupalVersion).catch(e => {
         console.warn(`  ⚠ PHPDoc parse skipped: ${e.message}`);
         return [] as ParsedPage[];
       }),
       parseDocset(docsetPath, drupalVersion).catch(e => {
         console.warn(`  ⚠ Docset parse skipped (optional): ${e.message}`);
         return [] as ParsedPage[];
       }),
       parseUserGuideMarkdown(guidePath).catch(e => {
         console.warn(`  ⚠ User Guide parse skipped: ${e.message}`);
         return [] as ParsedPage[];
       }),
     ]);

     const pages = [...phpdocPages, ...docsetPages, ...guidePages];
     console.log(`  → PHPDoc pages:     ${phpdocPages.length}`);
     console.log(`  → Docset pages:     ${docsetPages.length}`);
     console.log(`  → User Guide pages: ${guidePages.length}`);
     console.log(`  → Total pages:      ${pages.length}`);

     if (pages.length === 0) {
       console.error('\n❌ No pages parsed — check that sync:sources has been run and sources exist.');
       process.exit(1);
     }

     // ── Step 2: Chunk ──────────────────────────────────────────────────────────
     console.log('\n[2/4] Chunking...');
     const chunks = await chunkPages(pages);
     console.log(`  → ${chunks.length} chunks created`);

     // ── Dry Run Early Exit ─────────────────────────────────────────────────────
     if (isDryRun) {
       printSummary({ phpdocPages: phpdocPages.length, docsetPages: docsetPages.length,
         guidePages: guidePages.length, chunks: chunks.length, upserted: 0, dryRun: true });
       return;
     }

     // ── Step 3: Embed ──────────────────────────────────────────────────────────
     console.log('\n[3/4] Embedding... (this will take several minutes and use OpenAI credits)');
     const estimatedCost = (chunks.length * 400 / 1_000_000 * 0.02).toFixed(4);
     console.log(`  Estimated cost: ~$${estimatedCost} (${chunks.length} chunks × 400 avg tokens × $0.02/1M)`);
     const embedded = await embedChunks(chunks);
     console.log(`  → ${embedded.length} embeddings generated`);

     // ── Step 4: Load ───────────────────────────────────────────────────────────
     console.log('\n[4/4] Loading into LanceDB...');
     await loadChunks(embedded, lancedbPath);

     // Final count verification
     const db = await lancedb.connect(lancedbPath);
     const table = await db.openTable('drupal_core_docs');
     const totalDocs = await table.countRows();

     printSummary({
       phpdocPages: phpdocPages.length,
       docsetPages: docsetPages.length,
       guidePages: guidePages.length,
       chunks: chunks.length,
       upserted: embedded.length,
       dryRun: false,
       totalInDB: totalDocs,
     });
   }

   function printSummary(stats: {
     phpdocPages: number;
     docsetPages: number;
     guidePages: number;
     chunks: number;
     upserted: number;
     dryRun: boolean;
     totalInDB?: number;
   }) {
     const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
     const estimatedCost = (stats.chunks * 400 / 1_000_000 * 0.02).toFixed(4);

     console.log(`
   === ETL Summary ===
   PHPDoc pages parsed:   ${stats.phpdocPages}
   Docset pages parsed:   ${stats.docsetPages}
   User Guide sections:   ${stats.guidePages}
   Total chunks created:  ${stats.chunks}
   Chunks loaded:         ${stats.upserted}
   LanceDB total rows:    ${stats.totalInDB ?? 'N/A (dry run)'}
   Time elapsed:          ${elapsed} minutes
   Estimated API cost:    $${estimatedCost}
   Dry run:               ${stats.dryRun}
     `);

     if (!stats.dryRun && stats.totalInDB !== undefined) {
       if (stats.totalInDB < 10000) {
         console.warn('⚠ Warning: Row count is lower than expected (< 10,000). Check parser output.');
       } else {
         console.log('✅ ETL complete. LanceDB is ready for semantic queries.');
       }
     }
   }

   main().catch(err => {
     console.error('\n❌ ETL failed:', err.message);
     console.error(err.stack);
     process.exit(1);
   });
   ```

2. **Verify dry-run works** (no API calls, no LanceDB writes — no server needed):
   ```bash
   npm run etl:drupal-core-docs:dry-run
   ```

3. **Run the full ETL** (LanceDB is embedded — no server startup needed):
   ```bash
   npm run etl:drupal-core-docs
   ```
   This will take **15–45 minutes** depending on network speed and OpenAI rate limits. Leave it running.

4. **After completion, verify LanceDB row count**:
   ```bash
   npx ts-node -e "
   require('dotenv').config();
   const lancedb = require('@lancedb/lancedb');
   async function check() {
     const db = await lancedb.connect(process.env.LANCEDB_PATH ?? './data/lancedb');
     const table = await db.openTable('drupal_core_docs');
     const n = await table.countRows();
     console.log('LanceDB row count:', n);
     if (n < 10000) console.warn('WARNING: lower than expected!');
     else console.log('✓ Count looks healthy');
   }
   check();
   "
   ```

5. **Spot-check a sample**:
   ```bash
   npx ts-node -e "
   require('dotenv').config();
   const lancedb = require('@lancedb/lancedb');
   const { embed } = require('./src/lib/openai');
   async function spotCheck() {
     const db = await lancedb.connect(process.env.LANCEDB_PATH ?? './data/lancedb');
     const table = await db.openTable('drupal_core_docs');
     const v = await embed('Drupal entity presave hook');
     const rows = await table.vectorSearch(v).limit(3).toArray();
     rows.forEach(r => {
       console.log('---');
       console.log('Symbol:', r.symbol_name, '| Source:', r.source, '| Dist:', r._distance.toFixed(4));
       console.log('Text:', r.text.slice(0, 120));
     });
   }
   spotCheck();
   "
   ```

6. **Typecheck**:
   ```bash
   npm run typecheck
   ```

7. **Commit**:
   ```bash
   git add etl/run.ts
   git commit -m "feat(etl): implement ETL runner with dry-run support"
   ```

## Verification / Done Criteria

**Dry run** (fast — no API calls):
```bash
npm run etl:drupal-core-docs:dry-run
```
Expected:
```
=== Drupal Core Docs ETL ===
Mode:        DRY RUN (parse + chunk only, no API calls)
...

[1/4] Parsing sources...
  → PHPDoc pages:     8432
  → Docset pages:     0   (or >1000 if Docset downloaded)
  → User Guide pages: 147
  → Total pages:      8579

[2/4] Chunking...
  → 22,841 chunks created

=== ETL Summary ===
Total chunks created:  22,841   ← must be > 5,000
Dry run:               true
```

**Full run** — after completion:
```bash
# Check count
# Expected: LanceDB row count: 20,000–35,000
```

**Done criteria**:
- Dry run exits 0, chunk count > 5,000
- Full run exits 0 (may take 15–45 min)
- LanceDB table row count is **between 15,000 and 40,000**
- Spot-check returns results for "Drupal entity presave hook" with recognizable Drupal symbol names
- `npm run typecheck` exits 0

## Notes / Gotchas

- **LanceDB is fully embedded**: No server, no Docker. The ETL runner connects to LanceDB directly in-process. Data lands in `data/lancedb/` on disk.
- **Full ETL runtime**: Embedding 20,000–30,000 chunks in batches of 512 at OpenAI's rate takes 15–45 minutes depending on your tier's TPM (tokens per minute) limit. If you hit rate limits, the exponential backoff in the embedder will slow things down further. This is normal — let it run.
- **Re-running the ETL is safe**: The loader drops and recreates the `drupal_core_docs` table on each run. This guarantees no duplicate rows and no stale data.
- **`--dry-run` does not touch LanceDB**: The dry-run path exits before any LanceDB writes. This is useful for verifying parser + chunker output without any disk I/O to the vector store.
- **`Promise.all()` for parsing**: The three parsers run concurrently. PHPDoc parsing (file-walking) is I/O bound and benefits from concurrency. If any parser throws, its error is caught individually and logged as a warning — the others continue.
- **Expected row count range**: 15,000–40,000 is wide because: PHPDoc yield varies by Drupal version and regex coverage; Docset may or may not be present; chunking produces variable numbers of chunks per page depending on text length.
