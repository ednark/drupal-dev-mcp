---
status: planned
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Task 06: User Guide Markdown Parser

## Depends On
- Task 01: Repository Scaffold
- Task 03: Source Sync Script (must have run `npm run sync:sources` so `data/sources/drupal-user-guide.md` exists)

## Goal
Add the `parseUserGuideMarkdown()` function to `etl/parser.ts`. This parser reads the pandoc-converted Drupal User Guide Markdown file, splits it into per-section `ParsedPage` objects at `##` heading boundaries, and returns them with appropriate metadata. User Guide content provides conceptual and procedural coverage that complements the API-level PHPDoc and Docset content — answering "how do I ..." questions rather than "what does this class do."

## Deliverables
- `etl/parser.ts` updated with `parseUserGuideMarkdown()` function appended
- Verification script output showing > 100 guide sections extracted with meaningful headings
- `npm run typecheck` passes

## Implementation Steps

1. **Confirm the User Guide Markdown exists**:
   ```bash
   ls -lh data/sources/drupal-user-guide.md
   # Expected: file > 3 MB
   head -5 data/sources/drupal-user-guide.md
   # Expected: Markdown headings about the Drupal User Guide
   ```

2. **Add `parseUserGuideMarkdown()` to `etl/parser.ts`** — append after the Docset parser section:
   ```typescript
   // ─── User Guide Markdown Parser ──────────────────────────────────────────────

   /**
    * Parse the pandoc-converted Drupal User Guide Markdown file.
    * Splits on H2 (##) headings — each top-level section becomes its own ParsedPage.
    * The H1 title preamble (before the first ##) is discarded as it is typically
    * boilerplate (title, copyright, etc.).
    *
    * @param mdPath  Absolute path to the converted Markdown file
    *                (e.g., "/path/to/data/sources/drupal-user-guide.md")
    */
   export async function parseUserGuideMarkdown(mdPath: string): Promise<ParsedPage[]> {
     let content: string;
     try {
       content = await fs.readFile(mdPath, 'utf-8');
     } catch (err: any) {
       throw new Error(`Cannot read User Guide Markdown at ${mdPath}: ${err.message}`);
     }

     // Split on H2 headings (## ), keeping the heading in each chunk
     // The first element (before any ##) is the H1 preamble — discard it
     const rawSections = content.split(/^(?=## )/m);

     // Filter out the preamble (no ## at start) and very short sections
     const sections = rawSections.filter(s => s.startsWith('## ') && s.trim().length > 50);

     const ingested_at = new Date().toISOString();

     return sections.map((section) => {
       // Extract heading text (first line, strip the ## prefix)
       const firstNewline = section.indexOf('\n');
       const headingLine = firstNewline >= 0 ? section.slice(0, firstNewline) : section;
       const sectionTitle = headingLine.replace(/^##\s+/, '').trim();

       return {
         text: section.trim(),
         metadata: {
           source: 'user_guide' as const,
           symbol_name: null,
           fqcn: null,
           file_path: 'drupal-user-guide.md',
           drupal_version: 'all',   // User Guide applies to all current versions
           section: sectionTitle,
           ingested_at,
         },
       };
     });
   }
   ```

3. **Create a verification script** `etl/verify-user-guide.ts` (delete after use):
   ```typescript
   import * as dotenv from 'dotenv';
   dotenv.config();

   import * as path from 'path';
   import { parseUserGuideMarkdown } from './parser.js';

   const sourcesDir = process.env.ETL_SOURCES_DIR ?? './data/sources';
   const mdPath = path.join(sourcesDir, 'drupal-user-guide.md');

   console.log(`Parsing User Guide from: ${mdPath}`);
   const start = Date.now();

   parseUserGuideMarkdown(mdPath).then(pages => {
     const elapsed = ((Date.now() - start) / 1000).toFixed(1);
     console.log(`\n✓ Parsed ${pages.length} User Guide sections in ${elapsed}s`);

     if (pages.length === 0) {
       console.error('❌ No sections found — check that the Markdown file exists and has ## headings');
       process.exit(1);
     }

     // Print first 5 section titles
     console.log('\n--- First 10 section titles ---');
     pages.slice(0, 10).forEach((p, i) => {
       console.log(`  ${String(i + 1).padStart(2)}. ${p.metadata.section}`);
     });

     // Stats
     const totalChars = pages.reduce((s, p) => s + p.text.length, 0);
     console.log('\n--- Stats ---');
     console.log(`Total sections:    ${pages.length}`);
     console.log(`Total characters:  ${totalChars.toLocaleString()}`);
     console.log(`Avg section size:  ${Math.round(totalChars / pages.length).toLocaleString()} chars`);
     console.log(`Min section size:  ${Math.min(...pages.map(p => p.text.length))} chars`);
     console.log(`Max section size:  ${Math.max(...pages.map(p => p.text.length)).toLocaleString()} chars`);
   }).catch(err => {
     console.error('Parse failed:', err);
     process.exit(1);
   });
   ```

4. **Run the verification**:
   ```bash
   npx ts-node etl/verify-user-guide.ts
   ```

5. **Run typecheck**:
   ```bash
   npm run typecheck
   ```

6. **Commit**:
   ```bash
   rm etl/verify-user-guide.ts
   git add etl/parser.ts
   git commit -m "feat(etl): add User Guide Markdown parser"
   ```

## Verification / Done Criteria

```bash
npx ts-node etl/verify-user-guide.ts
```

Expected output:
```
Parsing User Guide from: ./data/sources/drupal-user-guide.md

✓ Parsed 147 User Guide sections in 0.3s

--- First 10 section titles ---
   1. Preface — Audience and Goal
   2. Preface — Organization
   3. Preface — Conventions Used
   4. Understanding Drupal
   5. Background Concepts
   6. Planning Your Site
   ...

--- Stats ---
Total sections:    147        ← must be > 100
Total characters:  482,341
Avg section size:  3,281 chars
Min section size:  82 chars
Max section size:  24,892 chars
```

**Done criteria**:
- Exits 0
- Section count > 100
- Section titles look like real Drupal User Guide headings (not garbage output)
- `npm run typecheck` exits 0

## Notes / Gotchas

- **Split strategy — `##` only**: The function splits at H2 headings (`## `). The User Guide has H1-H5 nesting, but H2 gives sections that are large enough to contain meaningful context while small enough for the chunker (Task 07) to keep below token limits without too much truncation.
- **Preamble discarding**: pandoc typically outputs book-level metadata (title, author, date) before the first `##`. The `filter(s => s.startsWith('## ...'))` guard discards this cleanly.
- **`drupal_version: 'all'`**: The User Guide covers Drupal 10/11 conceptually and does not give version-specific API signatures. Setting `drupal_version: 'all'` means the LLM's version filter in the tool handler (`where: { drupal_version: '11.x' }`) will **not** return User Guide results when a version filter is active. This is a conscious trade-off to keep version-specific queries clean. If User Guide content should be included in version-filtered results, change this to `'11.x'` or parameterize it.
- **Large sections**: Some User Guide sections (e.g., configuration walkthroughs with many steps) can be 10,000+ characters. The chunker in Task 07 will split these into overlapping ~2,000-character chunks automatically.
- **File path**: The `file_path: 'drupal-user-guide.md'` is a relative reference used to generate stable chunk IDs (see Task 07). It does not need to be an absolute path.
- **Re-running is idempotent**: The User Guide parser reads a static file and always produces the same output for the same file. It is safe to re-run.
