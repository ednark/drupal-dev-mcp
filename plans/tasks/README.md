---
status: in-progress
phase: tracking
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Drupal Architect MCP Server — Task Index

Ordered, incremental implementation tasks for the MVP. Each task leaves something demonstrably working. Complete them in sequence — each builds on the previous.

> **Tech stack**: TypeScript · LanceDB (fully embedded — no server or Docker required) · OpenAI API · `@modelcontextprotocol/sdk`
>
> **Before you start**: Install Node.js 20 LTS, pandoc ≥ 3.0, and obtain an OpenAI API key.

---

## Progress Tracker

| # | Task | Description | Status |
|---|------|-------------|--------|
| 01 | [Repo Scaffold](./01-repo-scaffold.md) | TypeScript project skeleton — `package.json`, `tsconfig.json`, `.env`, `.gitignore`, directory stubs, `npm run build` passes | ⬜ |
| 02 | [LanceDB + OpenAI Smoke Test](./02-lancedb-openai-smoke-test.md) | Wire `src/lib/lancedb.ts` and `src/lib/openai.ts`; run smoke test that embeds text, stores in LanceDB (fully embedded), and queries it back — no Docker required | ⬜ |
| 03 | [Source Sync Script](./03-sync-script.md) | `scripts/sync-docs.sh` — shallow-clone `drupal/drupal@11.x`, download User Guide ePub, convert to Markdown via pandoc; verify all sources land in `data/sources/` | ⬜ |
| 04 | [PHPDoc Parser](./04-phpdoc-parser.md) | `etl/parser.ts` — walk `drupal-core/core/lib/` and `core/modules/`, extract docblock + declaration pairs via regex; verify > 5,000 pages extracted | ⬜ |
| 05 | [Docset Parser](./05-docset-parser.md) | Add `parseDocset()` to `etl/parser.ts` — read Drupal Dash/Zeal SQLite DB, strip HTML, extract plain text; gracefully skips if Docset not downloaded | ⬜ |
| 06 | [User Guide Parser](./06-user-guide-parser.md) | Add `parseUserGuideMarkdown()` to `etl/parser.ts` — split pandoc-converted Markdown on `##` headings; verify > 100 sections extracted | ⬜ |
| 07 | [Chunker](./07-chunker.md) | `etl/chunker.ts` — `RecursiveCharacterTextSplitter` at 2000-char/256-char-overlap with heading-aware separators; SHA-256 stable chunk IDs; verify zero duplicate IDs | ⬜ |
| 08 | [Embedder + LanceDB Loader](./08-embedder-lancedb-loader.md) | `etl/embedder.ts` (batched OpenAI `text-embedding-3-small` with retry) + `etl/loader.ts` (LanceDB table create/append); mini end-to-end test confirms docs land in LanceDB | ⬜ |
| 09 | [ETL Runner](./09-etl-runner.md) | `etl/run.ts` — orchestrates parse → chunk → embed → load; `--dry-run` stops after chunk; verify full run produces 15,000–40,000 LanceDB rows | ⬜ |
| 10 | [MCP Server Bootstrap](./10-mcp-server-bootstrap.md) | `src/index.ts` with `StdioServerTransport`; bare server with placeholder tool list; verify `initialize` + `tools/list` MCP handshake succeeds | ⬜ |
| 11 | [Tool Handler](./11-tool-handler.md) | `src/tools/ask-drupal-expert.ts` — full four-phase RAG handler: embed → LanceDB vector search → prompt → GPT-4o synthesis; `tools/list` returns real schema; end-to-end question answered | ⬜ |
| 12 | [Client Integration](./12-client-integration.md) | Register server in Claude Desktop / Cursor with absolute paths and env vars (no Docker needed); verify tool appears in picker; send one test question from client UI | ⬜ |
| 13 | [Manual Testing](./13-manual-testing.md) | Run all 10 test questions; record pass/fail; document out-of-scope and version-filter tests; ≥ 8/10 pass = MVP done | ⬜ |

---

## Phase Summary

```
Phase 1 — Foundation (Tasks 01–02)
  01 → 02

Phase 2 — ETL Pipeline (Tasks 03–09)
  03 → 04 → 07 → 08 → 09
       04 ↗
  03 → 05 ↗
       06 ↗

Phase 3 — MCP Server (Tasks 10–12)
  10 → 11 → 12

Phase 4 — Validation (Task 13)
  12 + 09 → 13
```

---

## Key File Map

| File | Created in Task |
|------|----------------|
| `package.json`, `tsconfig.json`, `.env.example` | 01 |
| `src/config.ts` | 02 |
| `src/lib/openai.ts` | 02 |
| `src/lib/lancedb.ts` | 02 |
| `tests/smoke-test.ts` | 02 |
| `scripts/sync-docs.sh` | 03 |
| `etl/parser.ts` — PHPDoc | 04 |
| `etl/parser.ts` — Docset | 05 |
| `etl/parser.ts` — User Guide | 06 |
| `etl/chunker.ts` | 07 |
| `etl/embedder.ts` | 08 |
| `etl/loader.ts` | 08 |
| `etl/run.ts` | 09 |
| `src/index.ts` (stub) | 10 |
| `src/tools/ask-drupal-expert.ts` | 11 |
| `src/index.ts` (final) | 11 |
| `tests/manual-test-questions.md` | 12 |
| `README.md` (quickstart) | 12 |

---

## Infrastructure Requirements

| Service | How to run | Required for |
|---------|-----------|--------------|
| LanceDB | Fully embedded — no server or Docker required. Data stored in `data/lancedb/` on disk. Install via `npm install` (`@lancedb/lancedb`). | Tasks 02, 08, 09, 11, 12, 13 |
| OpenAI API | Set `OPENAI_API_KEY` in `.env` | Tasks 02, 08, 09, 11, 13 |
| pandoc | `brew install pandoc` | Task 03 |
| git | `brew install git` | Task 03 |

---

## Updating This Tracker

Mark tasks complete by changing `⬜` to `✅` in the Progress Tracker table above as you work through them. You can also add `🔄` for in-progress and `❌` for blocked.

---

## Note on Vector Store

> This project uses **LanceDB** as the vector store — it is fully embedded (no server, no Docker) and stores data as files in `data/lancedb/`, exactly like SQLite. The npm package is `@lancedb/lancedb`. Do not install `chromadb` — it requires a running HTTP server and is not used in this project.
