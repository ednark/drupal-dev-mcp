---
status: in-progress
phase: execution
completed_at: null
last_reviewed_at: 2026-08-25
depends_on: []
supersedes:
  - plans/archived/new-search-tools-plan.md
related_artifacts:
  - packages/knowledge/src/query/provider.ts
  - packages/server/src/server.ts
  - packages/agent/src/agent.ts
  - docs/architecture-0.2.md
  - docs/integration-agent-loops.md
  - plans/active/agent-loop-integration-recommendations.md
---

# Phased Roadmap — Drupal Dev MCP 0.2

## Goal
Track remaining work for the 0.2 architecture: a read-only evidence server (`@drupal-dev-mcp/server`) over a versioned knowledge index (`@drupal-dev-mcp/knowledge`), with reasoning kept outside the server (`@drupal-dev-mcp/agent` or any external agent loop).

## Note: 2026-08-25 re-anchoring
This roadmap previously described the removed 0.1 surface (`src/tools/*.ts`, `src/lib/retrieval.ts`, the `ask_drupal_expert`/`search_drupal_docs`/`deep_research_drupal` tools). It has been re-anchored to the 0.2 workspace layout. The 0.1-era phases map onto 0.2 work as follows:

- "Source gaps" → fetcher/verification completeness for `SOURCE_REGISTRY` (`packages/knowledge/src/registry.ts`).
- "Skill-aware prompt quality" and "tutorials/examples hardening" → these concerned 0.1 prompt assembly. In 0.2, skill guides and tutorials are ordinary index sources (`drupal_skills`, `tutorials`, `drupal_examples`); their remaining work is corpus quality, tracked under Phase 1. The plans `skill-rag-integration-plan.md`, `tutorials-and-examples-implementation-plan.md`, and `etl-trigger-from-mcp-plan.md` target the removed 0.1 surface and are **archive candidates**.

## Implemented Architecture Baseline
- `@drupal-dev-mcp/knowledge`: source registry, dual Drupal core snapshots (10.6/11.4), SQLite + FTS5 + deterministic graph, optional LanceDB vectors, verified atomic activation. See [`docs/architecture-0.2.md`](../../docs/architecture-0.2.md).
- `@drupal-dev-mcp/server`: read-only MCP tools with full annotations and declared output schemas over `KnowledgeProvider`.
- `@drupal-dev-mcp/agent`: optional OpenAI-backed ask/research workflows with observable evidence admission and budgets.

## Active Phases

### Phase 1 — Corpus completeness for the 0.2 source registry
Focus: every `SOURCE_REGISTRY` entry fetches, parses, verifies, and is retrievable.

Next actions:
- Validate fetcher/parser coverage for each registry source (module handbook, contrib docs, examples, skills, tutorials, upstream docs).
- Confirm sources surface in lexical search and benchmark questions.

Exit criteria:
- `npm run index:fetch && npm run index:rebuild && npm run index:verify` succeeds for the full registry.
- Benchmark gate (`npm run index:benchmark`) meets the 16/20 threshold.

### Phase 2 — Agent-loop integration (from downstream-consumer recommendations)
Reference: [`plans/active/agent-loop-integration-recommendations.md`](agent-loop-integration-recommendations.md) (triaged 2026-08-25).

Adopted items:
- [x] R1 — token budgeting: `snippet_max_chars` on `search_drupal`; compact JSON text serialization.
- [x] R2-min — `get_drupal_document` tool exposing exact indexed text (document or chunk) to tools-only clients.
- [x] R3 — `get_drupal_entities` batch resolution tool.
- [x] R5 — `get_index_status` tool.
- [x] R7-min — deterministic ordering tie-breakers; stability documented in tool descriptions.
- [x] R8 — integration guide: [`docs/integration-agent-loops.md`](../../docs/integration-agent-loops.md).
- [x] R9 — chunk-level citation URIs (`drupal://document/{docId}#chunk/{chunkId}`) for semantic hits.

Explicitly declined or deferred (rationale in the triage):
- R2-full `verify_citation` verdict — reasoning belongs client-side.
- R4 `migration_impact` — deferred until a third Drupal version exists.
- R6 full error-code taxonomy — deferred; structured `found/ambiguous/not_found` statuses cover the common repair path.
- R7 cursor paging — no demonstrated need with `limit` capped at 25.
- R1 `verbosity`/`fields` knobs — existing knobs already bound response size.

Exit criteria:
- New tools are schema-validated, annotated, and covered by `npm test`.
- Integration guide linked from the README.

### Phase 3 — Retrieval quality and benchmarking
Focus: measurable retrieval quality on the 0.2 index.

Next actions:
- Denoise noisy corpora before embedding.
- Tune ranking weights and thresholds in [`packages/knowledge/src/query/provider.ts`](../../packages/knowledge/src/query/provider.ts).
- Expand the benchmark question set and track regressions per build.

Exit criteria:
- Retrieval changes are judged against repeatable `npm run index:benchmark` runs.
- Ranking regressions are visible in verification output.

## Milestone Checklist
- [x] 0.2 architecture implemented (knowledge/server/agent workspaces)
- [x] Agent-loop recommendations triaged
- [x] Agent-loop integration items implemented (R1, R2-min, R3, R5, R7-min, R8, R9)
- [ ] Full source registry fetch/verify completeness
- [ ] Retrieval benchmarking and tuning completed
- [ ] 0.1-era active plans archived

## Key Decisions
- Keep the server read-only, closed-world, and reasoning-free; every adopted recommendation strengthens that stance.
- Prefer few explicit knobs (`limit`, `include_snippets`, `snippet_max_chars`) over open-ended field selection.
- Batch and document/chunk tools exist to cut round-trips for step-budgeted agent loops, not to add synthesis.
