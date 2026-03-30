---
status: planned
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Task 04: PHPDoc Parser

## Depends On
- Task 01: Repository Scaffold
- Task 03: Source Sync Script (must have run `npm run sync:sources` so `data/sources/drupal-core/` exists)

## Goal
Implement the PHPDoc extraction portion of `etl/parser.ts`. This parser walks Drupal core's PHP source files, extracts every docblock comment alongside its associated class/interface/function/method declaration, and normalizes each into a `ParsedPage` object. Running this in isolation (via a small test script) must print a non-zero count of extracted pages to prove the regex and file-walking logic work correctly before any chunking or embedding is attempted.

## Deliverables
- `etl/parser.ts` — contains `parsePHPDocFiles()` function plus all shared types (`ParsedPage`, `SourceMetadata`)
- A temporary verification script (inline `ts-node` one-liner or small file) that calls `parsePHPDocFiles()` and prints the page count and a sample entry — can be deleted after verification
- Confirmed output: > 5,000 `ParsedPage` objects from `data/sources/drupal-core/core/lib/` and `data/sources/drupal-core/core/modules/`

## Implementation Steps

1. **Create `etl/parser.ts`** with shared types and the PHPDoc extraction function. Start with just the PHPDoc parser — the docset and user-guide parsers will be added in Tasks 05 and 06.

   ```typescript
   import * as fs from 'fs/promises';
   import * as path from 'path';

   // ─── Shared Types ────────────────────────────────────────────────────────────

   export interface SourceMetadata {
     source: 'drupal_phpdoc' | 'drupal_docset' | 'user_guide';
     symbol_name: string | null;
     fqcn: string | null;
     file_path: string | null;
     drupal_version: string;
     section: string | null;
     ingested_at: string;
   }

   export interface ParsedPage {
     text: string;
     metadata: SourceMetadata;
   }

   // ─── PHPDoc Extraction ────────────────────────────────────────────────────────

   /**
    * Matches a PHPDoc block (/** ... *\/) followed immediately by an optional
    * visibility/modifier keyword list and a class/interface/trait/enum/function declaration.
    */
   const DOCBLOCK_RE =
     /\/\*\*[\s\S]*?\*\/\s*((?:(?:public|protected|private|static|abstract|final|readonly)\s+)*(?:function|class|interface|trait|enum)\s+\w+)/g;

   /** Strip docblock syntax characters, leaving clean prose text. */
   function stripDocblockSyntax(docblock: string): string {
     return docblock
       .replace(/^\/\*\*\s?/m, '')
       .replace(/\*\/\s*$/, '')
       .replace(/^\s*\*\s?/gm, '')
       .trim();
   }

   /**
    * Extract the PHP namespace from a file's content.
    * Returns null if no namespace declaration is found.
    */
   function extractNamespace(content: string): string | null {
     const match = content.match(/^namespace\s+([\w\\]+)\s*;/m);
     return match ? match[1] : null;
   }

   /**
    * Async generator that yields all .php file paths under the given directories.
    */
   async function* walkPHP(dir: string): AsyncGenerator<string> {
     let entries: import('fs').Dirent[];
     try {
       entries = await fs.readdir(dir, { withFileTypes: true });
     } catch {
       return; // Directory doesn't exist — skip silently
     }
     for (const entry of entries) {
       const fullPath = path.join(dir, entry.name);
       if (entry.isDirectory()) {
         yield* walkPHP(fullPath);
       } else if (entry.isFile() && entry.name.endsWith('.php')) {
         yield fullPath;
       }
     }
   }

   /**
    * Parse PHPDoc blocks from all .php files under drupal core's lib and modules dirs.
    *
    * @param coreDir  Absolute path to the drupal-core checkout root
    *                 (e.g., "/path/to/data/sources/drupal-core")
    * @param drupalVersion  Version string to embed in metadata (e.g., "11.x")
    */
   export async function parsePHPDocFiles(
     coreDir: string,
     drupalVersion: string,
   ): Promise<ParsedPage[]> {
     const pages: ParsedPage[] = [];

     // Walk both primary source trees
     const searchDirs = [
       path.join(coreDir, 'core', 'lib'),
       path.join(coreDir, 'core', 'modules'),
     ];

     for (const searchDir of searchDirs) {
       for await (const filePath of walkPHP(searchDir)) {
         let content: string;
         try {
           content = await fs.readFile(filePath, 'utf-8');
         } catch {
           continue; // Skip unreadable files
         }

         const namespace = extractNamespace(content);
         DOCBLOCK_RE.lastIndex = 0;

         let match: RegExpExecArray | null;
         while ((match = DOCBLOCK_RE.exec(content)) !== null) {
           const fullMatch = match[0];
           const declaration = match[1].trim();

           // Extract just the symbol name (last word of the declaration)
           const symbolName = declaration.split(/\s+/).pop() ?? null;

           // Build FQCN if we resolved a namespace
           const fqcn =
             namespace && symbolName
               ? `${namespace}\\${symbolName}`
               : null;

           const cleanText = stripDocblockSyntax(fullMatch);
           if (!cleanText || cleanText.length < 10) continue; // Skip trivial/empty docblocks

           pages.push({
             text: `\`\`\`php\n${declaration}\n\`\`\`\n\n${cleanText}`,
             metadata: {
               source: 'drupal_phpdoc',
               symbol_name: symbolName,
               fqcn,
               file_path: path.relative(coreDir, filePath),
               drupal_version: drupalVersion,
               section: null,
               ingested_at: new Date().toISOString(),
             },
           });
         }
       }
     }

     return pages;
   }
   ```

2. **Create a quick verification script** — save as `etl/verify-phpdoc.ts` (delete after verification):
   ```typescript
   import * as dotenv from 'dotenv';
   dotenv.config();

   import * as path from 'path';
   import { parsePHPDocFiles } from './parser.js';

   const sourcesDir = process.env.ETL_SOURCES_DIR ?? './data/sources';
   const drupalVersion = process.env.ETL_DRUPAL_CORE_BRANCH ?? '11.x';
   const coreDir = path.join(sourcesDir, 'drupal-core');

   console.log(`Parsing PHPDoc from: ${coreDir}`);
   const start = Date.now();

   parsePHPDocFiles(coreDir, drupalVersion).then(pages => {
     const elapsed = ((Date.now() - start) / 1000).toFixed(1);
     console.log(`\n✓ Parsed ${pages.length} PHPDoc pages in ${elapsed}s`);

     if (pages.length === 0) {
       console.error('❌ No pages extracted — check coreDir path and that drupal-core is cloned');
       process.exit(1);
     }

     // Print 3 sample pages
     console.log('\n--- Sample pages ---');
     for (const p of pages.slice(0, 3)) {
       console.log(`\nSymbol: ${p.metadata.symbol_name}`);
       console.log(`FQCN:   ${p.metadata.fqcn}`);
       console.log(`File:   ${p.metadata.file_path}`);
       console.log(`Text preview: ${p.text.slice(0, 150).replace(/\n/g, ' ')}...`);
     }

     // Stats breakdown
     const withFqcn = pages.filter(p => p.metadata.fqcn !== null).length;
     console.log(`\n--- Stats ---`);
     console.log(`Total pages:       ${pages.length}`);
     console.log(`With FQCN:         ${withFqcn}`);
     console.log(`Without FQCN:      ${pages.length - withFqcn}`);
     console.log(`Avg text length:   ${Math.round(pages.reduce((s, p) => s + p.text.length, 0) / pages.length)} chars`);
   }).catch(err => {
     console.error('Parse failed:', err);
     process.exit(1);
   });
   ```

3. **Run the verification script**:
   ```bash
   npx ts-node etl/verify-phpdoc.ts
   ```

4. **Typecheck the whole project** to make sure the new types are consistent:
   ```bash
   npm run typecheck
   ```

5. **Commit the parser** (not the verify script — delete it or keep it in a `scratch/` folder):
   ```bash
   rm etl/verify-phpdoc.ts   # or git ignore it
   git add etl/parser.ts
   git commit -m "feat(etl): implement PHPDoc parser"
   ```

## Verification / Done Criteria

```bash
npx ts-node etl/verify-phpdoc.ts
```

Expected output pattern:
```
Parsing PHPDoc from: ./data/sources/drupal-core

✓ Parsed 8432 PHPDoc pages in 12.3s

--- Sample pages ---

Symbol: NodeInterface
FQCN:   Drupal\node\NodeInterface
File:   core/modules/node/src/NodeInterface.php
Text preview: ```php
interface NodeInterface ...

Symbol: EntityStorageInterface
...

--- Stats ---
Total pages:       8432        ← must be > 5,000
With FQCN:         8100
Without FQCN:      332
Avg text length:   420 chars
```

**Done criteria**:
- Script exits 0
- Total pages printed is **> 5,000**
- Sample output shows recognizable Drupal class/interface names (`EntityInterface`, `NodeInterface`, `HookInterface`, etc.)
- `npm run typecheck` exits 0

## Notes / Gotchas

- **Regex performance**: The `DOCBLOCK_RE` regex uses `[\s\S]*?` (non-greedy) to match docblock interiors. On files with many docblocks this can be slow due to backtracking. If parsing takes > 60 seconds, consider switching to a character-scanning approach instead of the regex. In practice, the regex approach should finish all of `core/lib/` and `core/modules/` in under 30 seconds.
- **`DOCBLOCK_RE.lastIndex = 0`**: This reset is **critical**. The regex is defined with the `g` flag, so it maintains state between calls. Without the reset, the regex will skip docblocks on the second and subsequent files.
- **Regex vs AST parsing**: A proper PHP AST parser (e.g., `php-parser` in a child process) would give perfect accuracy, but adds significant complexity. The regex approach misses some edge cases (multi-line `@param` tags, docblocks inside closures) but captures > 95% of the useful docblocks with far less code. This is acceptable for MVP.
- **FQCN resolution**: The `extractNamespace()` function only handles a single top-level `namespace` declaration per file. Files using bracket-style namespaces (`namespace Foo { ... }`) will not have their namespace extracted — they are rare in Drupal core. The `fqcn` field will be `null` for those files.
- **Short docblock filter**: The `cleanText.length < 10` guard skips trivially empty docblocks like `/** {@inheritdoc} */`. This reduces noise in the vector store.
- **Node 22 `fs/promises` glob**: The MVP plan references `glob` from `node:fs/promises` which is only available in Node 22+. The implementation above uses a recursive `readdir` instead, which works on Node 20 LTS.
