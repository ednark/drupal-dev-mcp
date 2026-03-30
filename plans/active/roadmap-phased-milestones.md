---
status: in-progress
phase: planning
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts:
  - plans/active/skill-rag-integration-plan.md
  - plans/active/tutorials-and-examples-implementation-plan.md
---

# Phased Roadmap — Drupal Architect MCP Server

Master delivery plan consolidating all active work streams into a sequenced roadmap with milestones, dependencies, risks, and validation gates.

---

## Current State Snapshot

### ✅ Fully Implemented (Baseline)
- Core infrastructure: LanceDB, OpenAI embedding/chat, chunker, embedder, loader
- MCP server with `ask_drupal_expert` + `drupal_skill_guide` tools
- ETL pipeline: fetch → parse → chunk → embed → load (run.ts orchestrator)
- Source corpus (all have fetcher + parser + RAG integration):
  - `drupal_core_docs`, `drupal_user_guide`, `drupal_developer_guides`
  - `change_records` (Tier 1), `drupal_examples`, `core_module_code`
  - `api_drupal_org_docs`, `contrib_module_code`, `contrib_module_docs`
  - `drupal_best_practices`, `php_docs`, `symfony_docs`, `certification_docs`
- `drupal_tutorials` parser exists (`etl/parse-tutorials.ts`) + Tier 2 RAG slot

### 🔄 In Progress (Active Plans)
1. `skill-rag-integration-plan.md` — Skill domain detection + prompt injection
2. `tutorials-and-examples-implementation-plan.md` — Tutorial ETL hardening

### 📋 Identified but Not Yet Wired
- `contrib_module_handbook`: fetcher script exists (`scripts/fetch-contrib-module-handbook.ts`), no ETL parser or RAG table
- Drupal Module Developer Handbook: `drupal.org/docs/creating-custom-modules` — highest-value gap for module creation questions
- These were the "top two new sources" deferred from the previous session

---

## Phase 1 — New Source Integration
**Goal**: Wire the two highest-value module-creation sources into the RAG pipeline.

### Milestone 1.1 — Contrib Module Handbook
**Scope**: Connect the existing handbook fetcher to a full ETL path and expose in RAG Tier 2.

| # | Task | File(s) | Owner |
|---|------|---------|-------|
| 1.1.1 | Create ETL parser `etl/parse-contrib-module-handbook.ts` — reads `data/sources/contrib-modules/*-handbook.md`, strips nav/header noise, splits on `##` headings, emits `{ text, metadata: { source: 'contrib_module_handbook', module, section, file_path } }` | `etl/parse-contrib-module-handbook.ts` | dev |
| 1.1.2 | Create verify script `etl/verify-contrib-module-handbook.ts` — asserts ≥ 100 pages extracted, ≥ 5 unique modules covered | `etl/verify-contrib-module-handbook.ts` | dev |
| 1.1.3 | Wire into `etl/run.ts`: add `fetchContribModuleHandbook()` call in fetch phase, `parseContribModuleHandbook()` in parse phase | `etl/run.ts` | dev |
| 1.1.4 | Add `contrib_module_handbook` to Tier 2 datasets in `ask-drupal-expert.ts` | `src/tools/ask-drupal-expert.ts` | dev |
| 1.1.5 | Add `npm run fetch:contrib-module-handbook` script to `package.json` | `package.json` | dev |
| 1.1.6 | Create isolated runner `etl/run-contrib-module-handbook-only.ts` | `etl/run-contrib-module-handbook-only.ts` | dev |

**Validation Gate 1.1**:
- `npm run verify:contrib-module-handbook` outputs ≥ 100 pages, ≥ 5 modules
- ETL dry-run (`--dry-run`) includes handbook chunks without errors
- RAG query "How do I configure Views programmatically?" returns ≥ 1 handbook chunk in results

### Milestone 1.2 — Drupal Module Developer Handbook
**Scope**: Fetch and index `drupal.org/docs/creating-custom-modules` and sub-pages.

| # | Task | File(s) | Owner |
|---|------|---------|-------|
| 1.2.1 | Create fetcher `scripts/fetch-drupal-module-handbook.ts` using Jina AI reader for dynamic content; target URL list covers: creating-custom-modules, creating-custom-themes, services-and-dependency-injection, creating-custom-modules/hooks, plugin-api, creating-custom-modules/routing-system | `scripts/fetch-drupal-module-handbook.ts` | dev |
| 1.2.2 | Create ETL parser `etl/parse-drupal-module-handbook.ts` — reads `data/sources/drupal-module-handbook/`, heading-aware split, emits `{ text, metadata: { source: 'drupal_module_handbook', topic, section, file_path } }` | `etl/parse-drupal-module-handbook.ts` | dev |
| 1.2.3 | Create verify script `etl/verify-drupal-module-handbook.ts` — asserts ≥ 200 pages, covers hooks/services/routing topics | `etl/verify-drupal-module-handbook.ts` | dev |
| 1.2.4 | Wire into `etl/run.ts`: fetch + parse phases | `etl/run.ts` | dev |
| 1.2.5 | Add `drupal_module_handbook` to Tier 1 primary datasets (between `drupal_developer_guides` and `contrib_module_code`) in `ask-drupal-expert.ts` — this is a Tier 1 source because it directly answers module-creation questions | `src/tools/ask-drupal-expert.ts` | dev |
| 1.2.6 | Add `npm run fetch:drupal-module-handbook` and `npm run verify:drupal-module-handbook` to `package.json` | `package.json` | dev |
| 1.2.7 | Create isolated runner `etl/run-drupal-module-handbook-only.ts` | `etl/run-drupal-module-handbook-only.ts` | dev |

**Validation Gate 1.2**:
- `npm run verify:drupal-module-handbook` outputs ≥ 200 pages
- Query "How do I implement hook_entity_presave?" surfaces at least one `drupal_module_handbook` result
- Query "How do I register a custom service in Drupal?" returns module handbook chunks in Tier 1

**Dependencies**: None (fetch scripts use Jina AI reader, no Playwright dependency)

**Risks**:
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Jina AI rate limits or blocks drupal.org | Medium | High | Add 1.5s delay between requests; use Playwright fetcher as fallback (same pattern as certification docs) |
| drupal.org HTML structure changes break parser | Low | Medium | Cheerio-based fallback; selector chain `article → main → .field-body → body` |
| Handbook pages have too much navigation noise | Medium | Medium | Use Jina `/r.jina.ai/` reader URL which strips nav; add noise heuristic (skip chunks < 100 chars) |

---

## Phase 2 — Skill-RAG Integration
**Goal**: Enable domain-aware skill injection into prompts; expose `drupal_skill_guide` tool fully.
**Depends on**: Phase 1 (source tables must exist for representative testing)

Reference plan: `plans/active/skill-rag-integration-plan.md`

### Milestone 2.0 — Skill Loader (Stage 0)
| # | Task | File(s) |
|---|------|---------|
| 2.0.1 | Implement `loadSkills()` — reads `data/sources/drupal-best-practices/ai/skills/*/SKILL.md` at module init; builds `skillMap: Record<string, Skill>` | `src/tools/ask-drupal-expert.ts` |
| 2.0.2 | Log available skills at startup; return list of loaded skill IDs | `src/tools/ask-drupal-expert.ts` |

**Validation Gate 2.0**: Server startup log shows 10 skill domains loaded; no crash on missing SKILL.md files.

### Milestone 2.1 — Skill Detection + Injection (Stage 1, high impact)
| # | Task | File(s) |
|---|------|---------|
| 2.1.1 | Implement `detectSkillDomain(query)` with keyword map per domain (from each SKILL.md) | `src/tools/ask-drupal-expert.ts` |
| 2.1.2 | Add soft-intent fallback using cosine similarity against precomputed skill embeddings when keyword match fails | `src/tools/ask-drupal-expert.ts` |
| 2.1.3 | Modify `handleAskDrupalExpert` to compose `effectiveSystemPrompt = [SKILL_BLOCK?] + [GENERAL_RULES?] + BASE` | `src/tools/ask-drupal-expert.ts` |

**Validation Gate 2.1**:
- Query "How do I create a Views field plugin?" detects skill `views` and injects views SKILL.md block
- Query "Write a custom block plugin" detects skill `blocks`
- Query about database schema (non-Drupal) detects no skill domain → no injection
- Token count of system prompt does not exceed 6,000 tokens for any single query

### Milestone 2.2 — drupal_skill_guide Tool (Stage 2)
| # | Task | File(s) |
|---|------|---------|
| 2.2.1 | Fully implement `src/tools/drupal-skill-guide.ts` with `raw`, `trimmed`, `json` format support; reads from `skillMap` | `src/tools/drupal-skill-guide.ts` |
| 2.2.2 | Register tool in `src/index.ts`; add to MCP tool list | `src/index.ts` |

**Validation Gate 2.2**:
- `drupal_skill_guide({ skill_id: "views", format: "json" })` returns valid JSON with `{ id, title, description, usage, guardrails }`
- `drupal_skill_guide({ skill_id: "invalid" })` returns a structured error (not a crash)
- Tool appears in MCP `tools/list` response

**Dependencies**: Phase 1 complete; SKILL.md files present in `data/sources/drupal-best-practices/ai/skills/`

**Risks**:
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Skill keyword map gives false positives (e.g., "hooks" matches wrong domain) | Medium | Medium | Use compound keyword phrases; add confidence threshold before injection |
| Token bloat from skill injection on every query | Low | Medium | Only inject when rule-based confidence > 0.7 or cosine similarity > 0.78; cap injected block at 50 lines |
| SKILL.md files not yet created for all 10 domains | Low | High | Verify all 10 exist at startup; skip gracefully if missing; log warning |

---

## Phase 3 — Tutorials & Examples Hardening
**Goal**: Validate and harden `drupal_tutorials` table; add filtering by complexity/module.
**Depends on**: Phase 1 (new source integration complete)

Reference plan: `plans/active/tutorials-and-examples-implementation-plan.md`

### Milestone 3.1 — Tutorials ETL Validation
| # | Task | File(s) |
|---|------|---------|
| 3.1.1 | Run `etl/verify-tutorials.ts`; fix any gaps in `etl/parse-tutorials.ts` | `etl/verify-tutorials.ts`, `etl/parse-tutorials.ts` |
| 3.1.2 | Ensure metadata schema includes `module`, `complexity`, `topic`, `code_snippets` per the plan's spec | `etl/parse-tutorials.ts` |
| 3.1.3 | Add module/complexity filter support in `vectorSearch` for the `drupal_tutorials` table | `src/lib/lancedb.ts`, `src/tools/ask-drupal-expert.ts` |

**Validation Gate 3.1**: `npm run verify:tutorials` passes; ≥ 50 tutorial pages extracted; at least 3 complexity levels represented.

### Milestone 3.2 — Inline Snippet Display
| # | Task | File(s) |
|---|------|---------|
| 3.2.1 | Modify answer synthesis in `ask-drupal-expert.ts` to prefer and annotate `drupal_tutorials` chunks with `[Tutorial: <module>]` citation prefix | `src/tools/ask-drupal-expert.ts` |
| 3.2.2 | Add `isTutorialQuery()` helper that boosts Tier 2 tutorial results when query contains "example", "how do I", "tutorial", "step by step" | `src/tools/ask-drupal-expert.ts` |

**Validation Gate 3.2**: Query "Show me an example of a custom form with Webform module" returns ≥ 1 tutorial chunk with inline code snippet.

**Risks**:
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Tutorial sources are stale or not fetched | Medium | Medium | Run `scripts/fetch-tutorials.sh` before verifying; add timestamp check in verify script |
| Tutorials are too short to add value (duplicate of developer guides) | Low | Low | Deduplicate chunks by SHA-256 ID at load time (already in chunker) |

---

## Phase 4 — RAG Quality Enhancement
**Goal**: Improve retrieval precision and reduce noisy results.
**Depends on**: Phases 1–3 complete (full source corpus indexed)

Reference: Stage 3 of `skill-rag-integration-plan.md`

### Milestone 4.1 — PHPDoc De-noising
| # | Task | File(s) |
|---|------|---------|
| 4.1.1 | Add heuristic in `etl/parser.ts` to strip `{@inheritdoc}` stubs and empty method blocks from `drupal_core_docs` before chunking | `etl/parser.ts` |
| 4.1.2 | Drop chunks shorter than 80 characters in `etl/chunker.ts` | `etl/chunker.ts` |
| 4.1.3 | Re-run ETL for `drupal_core_docs` after de-noising | `etl/run-core-only.ts` |

**Validation Gate 4.1**: Core docs table row count drops by < 20% (not over-pruned); test query "What does EntityTypeManager do?" returns substantive (non-stub) results.

### Milestone 4.2 — Dataset-Specific Distance Thresholds
| # | Task | File(s) |
|---|------|---------|
| 4.2.1 | Add per-dataset `maxDistance` config map in `ask-drupal-expert.ts` (e.g., `contrib_module_docs: 1.2`, `drupal_tutorials: 1.25`) | `src/tools/ask-drupal-expert.ts` |
| 4.2.2 | Filter results after retrieval, before synthesis, by dataset-specific threshold | `src/tools/ask-drupal-expert.ts` |

**Validation Gate 4.2**: Noisy dataset results (distance > threshold) are dropped; answer quality on 5 benchmark questions scores ≥ 4/5 (manual review).

### Milestone 4.3 — Metadata-Aware Boosting
| # | Task | File(s) |
|---|------|---------|
| 4.3.1 | For code queries, boost results where `symbol_name` or `file_path` is non-empty (sort code chunks higher in context assembly) | `src/tools/ask-drupal-expert.ts` |
| 4.3.2 | Increase `api_drupal_org_docs` Tier 1 limit from 6 to 8 when `isEntityQuery()` is true | `src/tools/ask-drupal-expert.ts` |

**Validation Gate 4.3**: Entity API query "How do I load a node by UUID?" returns api_drupal_org_docs results in top 3 context chunks.

**Risks**:
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| De-noising strips too many core docs chunks | Low | High | Gate by character length AND absence of prose keywords; verify row count does not drop > 20% |
| Distance thresholds too aggressive, miss valid results | Medium | Medium | Start with conservative thresholds (1.3); tune based on benchmark queries |

---

## Phase 5 — Observability & Hardening
**Goal**: Add structured logging, metrics, and a manual validation suite.
**Depends on**: Phases 1–4 complete

Reference: Stage 5 of `skill-rag-integration-plan.md`

### Milestone 5.1 — Query Metrics Logging
| # | Task | File(s) |
|---|------|---------|
| 5.1.1 | Emit structured JSON log lines per query: `{ query_hash, skill_detected, tiers_searched, result_counts, latency_ms, top_distance }` | `src/tools/ask-drupal-expert.ts` |
| 5.1.2 | Add `DEBUG_QUERIES=true` env flag to enable verbose per-result logging (already partially present) | `src/config.ts`, `src/tools/ask-drupal-expert.ts` |

**Validation Gate 5.1**: Each query logs a single structured JSON line to stderr; no PII in logs.

### Milestone 5.2 — Manual Test Suite
| # | Task | File(s) |
|---|------|---------|
| 5.2.1 | Create `tests/benchmark-questions.md` with 20 representative module-creation questions across all skill domains, categorised by expected tier/source | `tests/benchmark-questions.md` |
| 5.2.2 | Run all 20 questions; record: skill detected, source(s) used, answer quality (1–5 scale); pass threshold = ≥ 16/20 score ≥ 3 | manual |
| 5.2.3 | Document out-of-scope queries (non-Drupal, Drupal 7/8 legacy) | `tests/benchmark-questions.md` |

**Validation Gate 5.2**: ≥ 16 of 20 benchmark questions score ≥ 3/5; all 10 skill domains triggered at least once.

**Risks**:
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Logging adds latency | Low | Low | Emit to stderr only; use `process.stderr.write()` not `console.error()` for structured lines |
| Benchmark questions subjective | Medium | Medium | Use objective criteria: correct API, correct module version, ≥ 1 code example, no hallucinated function names |

---

## Dependency Graph

```
Phase 1 (New Sources)
  1.1 Contrib Module Handbook → 1.2 Drupal Module Developer Handbook
        ↓                                    ↓
Phase 2 (Skill-RAG Integration) ←──────────────────────────────────────
  2.0 Skill Loader → 2.1 Skill Detection → 2.2 drupal_skill_guide Tool
        ↓
Phase 3 (Tutorials Hardening)
  3.1 Tutorials ETL → 3.2 Inline Snippets
        ↓
Phase 4 (RAG Quality)
  4.1 PHPDoc De-noising → 4.2 Distance Thresholds → 4.3 Metadata Boosting
        ↓
Phase 5 (Observability)
  5.1 Metrics Logging → 5.2 Manual Test Suite
```

Note: Phase 1 milestones (1.1 and 1.2) can run in parallel. Phase 2.0 can begin after Phase 1.1 (skill loader is independent of source corpus). Phase 4 requires full corpus (phases 1–3).

---

## Risk Register (Project-Level)

| # | Risk | Phase | Likelihood | Impact | Mitigation |
|---|------|-------|-----------|--------|-----------|
| R1 | OpenAI API rate limits delay ETL re-runs | 1–4 | Medium | High | Use `p-limit` concurrency cap (already in embedder); cache embeddings by SHA-256 chunk ID |
| R2 | drupal.org blocks automated fetchers | 1 | Medium | High | Jina AI reader as proxy; 1.5s delay; Playwright stealth as fallback |
| R3 | LanceDB table corruption after partial ETL run | 1–4 | Low | High | Always drop+recreate tables in `loader.ts`; never append to partial tables |
| R4 | Token budget exceeded in prompt construction | 2 | Low | Medium | Hard cap: inject max 2 SKILL.md blocks + general-rules, truncate RAG context to 6,000 tokens |
| R5 | Skill detection false positives degrade answer quality | 2 | Medium | Medium | Threshold tuning; A/B test on 5 queries before and after injection |
| R6 | Handbook pages are stale or 404 by run time | 1 | Low | Medium | `--skip-existing` flag in fetchers; re-fetch only if file < 500 bytes |
| R7 | `drupal_tutorials` table empty if tutorials never fetched | 3 | Low | Medium | Fetcher called in run.ts; verify step asserts > 0 pages before embedding |

---

## Exit Criteria

The project is complete when:
1. All Phase 1 sources are fetched, parsed, and queryable in RAG
2. All 10 skill domains detected and injected correctly on representative queries
3. `drupal_skill_guide` tool registered and responsive to all valid `skill_id` values
4. `drupal_tutorials` ETL passes verify with ≥ 50 pages
5. PHPDoc de-noising applied without over-pruning (< 20% row reduction)
6. ≥ 16/20 benchmark questions score ≥ 3/5
7. All `npm run verify:*` scripts pass without errors
8. MCP server starts cleanly, logs 10 skill domains, and answers queries without crashes
