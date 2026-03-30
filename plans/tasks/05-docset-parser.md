---
status: planned
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Task 05: Docset Parser (SQLite + HTML)

## Depends On
- Task 01: Repository Scaffold
- Task 03: Source Sync Script (optional — Docset must be manually downloaded; see Notes)

## Goal
Add the `parseDocset()` function to `etl/parser.ts`. This parser reads the Drupal Dash/Zeal SQLite docset database, iterates over each indexed symbol, reads the corresponding HTML documentation file, strips navigation chrome, converts to plain text, and returns a `ParsedPage` per symbol. This is an **optional but high-value** source — it provides structured API symbol entries (classes, interfaces, functions) with clean text extracted from pre-rendered HTML, complementing the raw PHPDoc approach from Task 04.

## Deliverables
- `etl/parser.ts` updated with `parseDocset()` function added below the existing PHPDoc code
- Verification script output showing > 1,000 docset pages extracted (if the Docset has been downloaded)
- Graceful skip (0 pages, no crash) when `data/sources/Drupal.docset/` does not exist
- `npm run typecheck` passes

## Implementation Steps

1. **Ensure the Drupal Docset is downloaded** (manual step, see Task 03 Notes):
   ```bash
   ls data/sources/Drupal.docset/Contents/Resources/
   # Expected: docSet.dsidx  Documents/
   ```
   If not present, you can still complete and verify this task with the graceful-skip behavior (the function returns `[]` without crashing).

2. **Add `parseDocset()` to `etl/parser.ts`** — append after the PHPDoc section:
   ```typescript
   import Database from 'better-sqlite3';
   import * as cheerio from 'cheerio';

   // ─── Docset (SQLite + HTML) Parser ───────────────────────────────────────────

   interface DocsetRow {
     name: string;
     type: string;
     path: string;
   }

   /**
    * Parse the Drupal Dash/Zeal SQLite docset.
    * Reads the searchIndex table, then loads the corresponding HTML file for each
    * symbol, strips navigation chrome, and extracts plain text.
    *
    * @param docsetPath  Absolute path to the .docset bundle directory
    *                    (e.g., "/path/to/data/sources/Drupal.docset")
    * @param drupalVersion  Version string to embed in metadata (e.g., "11.x")
    * @param limit  Max rows to read from searchIndex (default 10000 — covers full Drupal docset)
    */
   export async function parseDocset(
     docsetPath: string,
     drupalVersion: string,
     limit: number = 10000,
   ): Promise<ParsedPage[]> {
     const dbPath = path.join(docsetPath, 'Contents', 'Resources', 'docSet.dsidx');
     const docsPath = path.join(docsetPath, 'Contents', 'Resources', 'Documents');

     // Check existence before attempting to open
     try {
       await fs.access(dbPath);
     } catch {
       return []; // Docset not downloaded — skip gracefully
     }

     const db = new Database(dbPath, { readonly: true });
     const rows = db
       .prepare(`SELECT name, type, path FROM searchIndex LIMIT ${limit}`)
       .all() as DocsetRow[];
     db.close();

     const pages: ParsedPage[] = [];

     for (const row of rows) {
       // path may contain a fragment (#AnchorName) — strip it for file lookup
       const htmlRelPath = row.path.split('#')[0];
       const htmlFile = path.join(docsPath, htmlRelPath);

       let html: string;
       try {
         html = await fs.readFile(htmlFile, 'utf-8');
       } catch {
         continue; // Missing HTML file — skip this symbol
       }

       const $ = cheerio.load(html);

       // Remove navigation, sidebars, scripts, and styles — keep article body
       $('nav, header, footer, .sidebar, .navigation, #sidebar, script, style, [role="navigation"]').remove();

       // Extract text from the remaining body content
       const rawText = $('body').text();
       // Collapse excessive whitespace (multiple blank lines → single blank line)
       const text = rawText.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

       if (!text || text.length < 20) continue; // Skip near-empty pages

       pages.push({
         text: `# ${row.name} (${row.type})\n\n${text}`,
         metadata: {
           source: 'drupal_docset',
           symbol_name: row.name,
           fqcn: row.name,          // Docset names are already FQCNs
           file_path: row.path,
           drupal_version: drupalVersion,
           section: row.type,       // e.g. "Class", "Interface", "Function"
           ingested_at: new Date().toISOString(),
         },
       });
     }

     return pages;
   }
   ```

3. **Create a verification script** `etl/verify-docset.ts` (delete after use):
   ```typescript
   import * as dotenv from 'dotenv';
   dotenv.config();

   import * as path from 'path';
   import { parseDocset } from './parser.js';

   const sourcesDir = process.env.ETL_SOURCES_DIR ?? './data/sources';
   const drupalVersion = process.env.ETL_DRUPAL_CORE_BRANCH ?? '11.x';
   const docsetPath = path.join(sourcesDir, 'Drupal.docset');

   console.log(`Parsing Docset from: ${docsetPath}`);
   const start = Date.now();

   parseDocset(docsetPath, drupalVersion).then(pages => {
     const elapsed = ((Date.now() - start) / 1000).toFixed(1);

     if (pages.length === 0) {
       console.warn(`\n⚠ No pages extracted. Is the Docset downloaded at ${docsetPath}?`);
       console.warn('  This is OK — docset is optional. ETL will skip it gracefully.');
       return;
     }

     console.log(`\n✓ Parsed ${pages.length} docset pages in ${elapsed}s`);

     // Sample output
     console.log('\n--- Sample pages ---');
     for (const p of pages.slice(0, 3)) {
       console.log(`\nSymbol: ${p.metadata.symbol_name}`);
       console.log(`Type:   ${p.metadata.section}`);
       console.log(`File:   ${p.metadata.file_path}`);
       console.log(`Text:   ${p.text.slice(0, 120).replace(/\n/g, ' ')}...`);
     }

     // Source type breakdown
     const byType: Record<string, number> = {};
     for (const p of pages) {
       const t = p.metadata.section ?? 'unknown';
       byType[t] = (byType[t] ?? 0) + 1;
     }
     console.log('\n--- By type ---');
     Object.entries(byType)
       .sort((a, b) => b[1] - a[1])
       .slice(0, 10)
       .forEach(([type, count]) => console.log(`  ${type.padEnd(20)} ${count}`));
   }).catch(err => {
     console.error('Parse failed:', err);
     process.exit(1);
   });
   ```

4. **Run the verification**:
   ```bash
   npx ts-node etl/verify-docset.ts
   ```

5. **Run typecheck**:
   ```bash
   npm run typecheck
   ```

6. **Commit**:
   ```bash
   rm etl/verify-docset.ts
   git add etl/parser.ts
   git commit -m "feat(etl): add docset SQLite+HTML parser"
   ```

## Verification / Done Criteria

**If the Docset IS downloaded:**
```bash
npx ts-node etl/verify-docset.ts
```
Expected:
```
Parsing Docset from: ./data/sources/Drupal.docset

✓ Parsed 4823 docset pages in 8.2s

--- Sample pages ---

Symbol: Drupal\Core\Access\AccessCheckInterface
Type:   Interface
File:   Drupal/Core/Access/AccessCheckInterface.html
Text:   # Drupal\Core\Access\AccessCheckInterface (Interface)  Interface AccessCheckInterface...

--- By type ---
  Function             2341
  Class                1205
  Interface             892
  ...
```
- Must exit 0
- Page count must be **> 1,000**
- `npm run typecheck` exits 0

**If the Docset is NOT downloaded:**
```
⚠ No pages extracted. Is the Docset downloaded at ./data/sources/Drupal.docset?
  This is OK — docset is optional. ETL will skip it gracefully.
```
- Exit 0 (no crash)
- `npm run typecheck` exits 0

## Notes / Gotchas

- **Docset is optional**: The ETL runner (Task 09) wraps `parseDocset()` in a `.catch()` that returns `[]` and logs a warning if the docset is missing. The MVP works fine without it — PHPDoc + User Guide coverage is sufficient.
- **`cheerio` HTML parsing**: Cheerio is a fast jQuery-like HTML parser for Node.js. It runs fully synchronously in this context (loading HTML text, not fetching URLs). The `.text()` call extracts all visible text content with whitespace preserved.
- **Fragment stripping**: Docset `path` values like `Drupal/Core/Access/AccessCheckInterface.html#method_applies` reference a specific anchor within an HTML file. We strip the fragment (`#...`) before reading the file — we load the whole HTML page, not just the anchor section. This means some pages may include text from the whole class rather than just the specific method. This is acceptable for MVP — the chunker will split long pages.
- **`better-sqlite3` is synchronous**: Unlike most Node.js database libraries, `better-sqlite3` uses a synchronous API. The `.all()` call blocks the event loop briefly. For the ETL use case (single-process, batch operation) this is perfectly fine.
- **Docset HTML structure**: The HTML files inside a Dash/Zeal docset are generated from api.drupal.org. Their structure may change between Docset versions. If the `.text()` extraction looks wrong (gibberish or no content), try adjusting the cheerio selector used to strip navigation.
- **Limit parameter**: The default `LIMIT 10000` in the SQL query covers the entire Drupal docset (typically ~5,000–8,000 rows). Increasing or removing the limit is safe.
