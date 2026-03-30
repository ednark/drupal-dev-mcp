---
status: planned
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Task 07: Chunker

## Depends On
- Task 04: PHPDoc Parser (provides `ParsedPage` type and sample data for testing)
- Task 06: User Guide Parser (provides multi-section input to verify splitting behavior)

## Goal
Implement `etl/chunker.ts`. This module takes an array of `ParsedPage` objects from any of the three parsers and splits each page's text into overlapping, token-aware chunks. Each chunk gets a stable SHA-256 ID (used as the LanceDB row `id` field for stable identity across re-runs) and inherits all metadata from its parent page. After this task the chunker can be run in isolation against a small sample and must produce a verifiable, non-zero count of chunks with correct IDs.

## Deliverables
- `etl/chunker.ts` — implements `chunkPages()` using `RecursiveCharacterTextSplitter` with heading-aware separators, 2000-char chunk size, 256-char overlap, and SHA-256 chunk IDs
- `etl/chunker.ts` exports `ChunkMetadata` and `Chunk` types
- Verification script confirms chunk count, ID format, and that IDs are unique across all chunks
- `npm run typecheck` passes with zero errors

## Implementation Steps

1. **Create `etl/chunker.ts`**:
   ```typescript
   import * as crypto from 'crypto';
   import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
   import { ParsedPage, SourceMetadata } from './parser.js';

   // ─── Types ────────────────────────────────────────────────────────────────────

   export interface ChunkMetadata extends SourceMetadata {
     chunk_index: number;  // 0-based index within the parent page
     id: string;           // SHA-256 stable dedup key
   }

   export interface Chunk {
     chunk_text: string;
     metadata: ChunkMetadata;
   }

   // ─── Splitter Configuration ───────────────────────────────────────────────────

   /**
    * RecursiveCharacterTextSplitter configured to prefer heading boundaries,
    * then paragraph breaks, then newlines, then word boundaries.
    *
    * chunkSize: 2000 chars ≈ 500 tokens (at ~4 chars/token)
    * chunkOverlap: 256 chars ≈ 64 tokens — preserves context across boundaries
    */
   const splitter = new RecursiveCharacterTextSplitter({
     chunkSize: 2000,
     chunkOverlap: 256,
     separators: ['\n## ', '\n### ', '\n#### ', '\n\n', '\n', ' ', ''],
   });

   // ─── ID Generation ────────────────────────────────────────────────────────────

   /**
    * Generate a stable SHA-256 chunk ID from the page's unique key and chunk index.
    * Uses file_path + symbol_name as the page key — stable across re-runs as long
    * as the source files don't change.
    */
   function chunkId(metadata: SourceMetadata, chunkIndex: number): string {
     const pageKey = [
       metadata.source,
       metadata.file_path ?? '',
       metadata.symbol_name ?? '',
     ].join('::');
     return crypto
       .createHash('sha256')
       .update(`${pageKey}:${chunkIndex}`)
       .digest('hex');
   }

   // ─── Chunker ─────────────────────────────────────────────────────────────────

   /**
    * Split a single ParsedPage into overlapping text chunks with stable IDs.
    */
   export async function chunkPage(page: ParsedPage): Promise<Chunk[]> {
     const segments = await splitter.splitText(page.text);
     return segments.map((chunk_text, chunk_index) => ({
       chunk_text,
       metadata: {
         ...page.metadata,
         chunk_index,
         id: chunkId(page.metadata, chunk_index),
       },
     }));
   }

   /**
    * Chunk all pages from all parsers. Filters out chunks that are pure whitespace.
    * Logs progress every 500 pages.
    */
   export async function chunkPages(pages: ParsedPage[]): Promise<Chunk[]> {
     const allChunks: Chunk[] = [];
     for (let i = 0; i < pages.length; i++) {
       const chunks = await chunkPage(pages[i]);
       for (const chunk of chunks) {
         if (chunk.chunk_text.trim().length > 0) {
           allChunks.push(chunk);
         }
       }
       if ((i + 1) % 500 === 0) {
         process.stdout.write(`  chunking: ${i + 1}/${pages.length} pages processed...\r`);
       }
     }
     return allChunks;
   }
   ```

2. **Create a verification script** `etl/verify-chunker.ts` (delete after use):
   ```typescript
   import * as dotenv from 'dotenv';
   dotenv.config();

   import * as path from 'path';
   import { parsePHPDocFiles, parseUserGuideMarkdown } from './parser.js';
   import { chunkPages } from './chunker.js';

   const sourcesDir = process.env.ETL_SOURCES_DIR ?? './data/sources';
   const drupalVersion = process.env.ETL_DRUPAL_CORE_BRANCH ?? '11.x';

   async function main() {
     console.log('=== Chunker Verification ===\n');

     // Use User Guide only for a fast test (no file-walking needed)
     console.log('[1/2] Parsing User Guide for chunker input...');
     const mdPath = path.join(sourcesDir, 'drupal-user-guide.md');
     const pages = await parseUserGuideMarkdown(mdPath);
     console.log(`  → ${pages.length} pages`);

     console.log('[2/2] Chunking...');
     const start = Date.now();
     const chunks = await chunkPages(pages);
     const elapsed = ((Date.now() - start) / 1000).toFixed(2);

     console.log(`\n✓ ${chunks.length} chunks produced in ${elapsed}s`);

     // Verify IDs are unique
     const ids = new Set(chunks.map(c => c.metadata.id));
     if (ids.size !== chunks.length) {
       const dupes = chunks.length - ids.size;
       console.error(`❌ ${dupes} duplicate IDs detected!`);
       process.exit(1);
     }
     console.log(`✓ All ${ids.size} chunk IDs are unique`);

     // Verify ID format
     const sampleId = chunks[0].metadata.id;
     if (!/^[0-9a-f]{64}$/.test(sampleId)) {
       console.error(`❌ ID format wrong: "${sampleId}" (expected 64-char hex)`);
       process.exit(1);
     }
     console.log(`✓ ID format correct: ${sampleId.slice(0, 16)}...`);

     // Sample output
     console.log('\n--- Sample chunks ---');
     for (const c of chunks.slice(0, 3)) {
       console.log(`\nID:       ${c.metadata.id.slice(0, 16)}...`);
       console.log(`Source:   ${c.metadata.source}`);
       console.log(`Section:  ${c.metadata.section}`);
       console.log(`Index:    ${c.metadata.chunk_index}`);
       console.log(`Length:   ${c.chunk_text.length} chars`);
       console.log(`Preview:  ${c.chunk_text.slice(0, 100).replace(/\n/g, ' ')}...`);
     }

     // Stats
     const lengths = chunks.map(c => c.chunk_text.length);
     console.log('\n--- Stats ---');
     console.log(`Total chunks:    ${chunks.length}`);
     console.log(`Avg chunk size:  ${Math.round(lengths.reduce((a, b) => a + b) / lengths.length)} chars`);
     console.log(`Min chunk size:  ${Math.min(...lengths)} chars`);
     console.log(`Max chunk size:  ${Math.max(...lengths)} chars`);
     console.log(`Avg chunks/page: ${(chunks.length / pages.length).toFixed(1)}`);
   }

   main().catch(err => {
     console.error('Chunker verification failed:', err);
     process.exit(1);
   });
   ```

3. **Run the verification**:
   ```bash
   npx ts-node etl/verify-chunker.ts
   ```

4. **Also test with PHPDoc input** (larger, more representative):
   ```bash
   # One-liner to confirm PHPDoc chunking works at scale
   npx ts-node -e "
   require('dotenv').config();
   const path = require('path');
   const { parsePHPDocFiles } = require('./etl/parser');
   const { chunkPages } = require('./etl/chunker');
   const coreDir = path.join(process.env.ETL_SOURCES_DIR ?? './data/sources', 'drupal-core');
   parsePHPDocFiles(coreDir, '11.x').then(pages => {
     console.log('Pages:', pages.length);
     return chunkPages(pages);
   }).then(chunks => {
     console.log('Chunks:', chunks.length);
     const ids = new Set(chunks.map(c => c.metadata.id));
     console.log('Unique IDs:', ids.size, ids.size === chunks.length ? '✓' : '❌ DUPLICATES');
   });
   "
   ```

5. **Run typecheck**:
   ```bash
   npm run typecheck
   ```

6. **Commit**:
   ```bash
   rm etl/verify-chunker.ts
   git add etl/chunker.ts
   git commit -m "feat(etl): implement chunker with SHA-256 stable IDs"
   ```

## Verification / Done Criteria

```bash
npx ts-node etl/verify-chunker.ts
```

Expected output:
```
=== Chunker Verification ===

[1/2] Parsing User Guide for chunker input...
  → 147 pages

[2/2] Chunking...

✓ 389 chunks produced in 0.42s       ← must be > 0
✓ All 389 chunk IDs are unique        ← no duplicates
✓ ID format correct: a3f2d9e1b04c8...  ← 64-char hex

--- Sample chunks ---

ID:       a3f2d9e1b04c8a72...
Source:   user_guide
Section:  Understanding Drupal
Index:    0
Length:   1842 chars
Preview:  ## Understanding Drupal  Drupal is content management software...

--- Stats ---
Total chunks:    389
Avg chunk size:  1,241 chars
Min chunk size:  54 chars
Max chunk size:  2,000 chars            ← near limit means splitter is working
Avg chunks/page: 2.6
```

**Done criteria**:
- Script exits 0
- Chunk count > 0 and > number of input pages (i.e., splitting is actually happening)
- **Zero duplicate IDs**
- All IDs match `/^[0-9a-f]{64}$/`
- `npm run typecheck` exits 0

## Notes / Gotchas

- **Chunk size in chars vs tokens**: The splitter uses character count (2000 chars), not token count. At ~4 chars/token for English text and PHP code, 2000 chars ≈ 500 tokens. OpenAI `text-embedding-3-small` has an 8191-token limit — our chunks are well within that. This approach avoids importing a tokenizer into the chunker at the cost of some imprecision.
- **`separators` order matters**: `RecursiveCharacterTextSplitter` tries each separator in order and uses the first one that produces chunks within the size limit. By listing `'\n## '` first, sections will split at heading boundaries before falling back to paragraph splits. This keeps heading + content together.
- **Chunk overlap preserves context**: The 256-char overlap means each chunk shares ~256 characters with the next. For a RAG system this is important — it ensures a sentence that ends one chunk and begins the next won't have its context lost when only one chunk is retrieved.
- **Duplicate ID scenario**: Duplicate IDs can occur if two different source pages have the same `source + file_path + symbol_name` combination. This would be a bug in the parsers — the verification script catches it. If duplicates appear, check for duplicate entries in the parser output.
- **`RecursiveCharacterTextSplitter` is async**: Even though the implementation is synchronous internally, the `@langchain/textsplitters` API is async (`splitText()` returns a Promise). Always `await` it.
- **Empty chunk filtering**: Some very short docblocks (e.g., `/** @inheritdoc */`) may produce a chunk that is only whitespace after splitting. The `chunk_text.trim().length > 0` guard removes these.
