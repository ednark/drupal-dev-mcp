---
status: completed
phase: triaged
completed_at: 2026-08-25
last_reviewed_at: 2026-08-25
depends_on: []
supersedes: []
related_artifacts: [roadmap-phased-milestones.md, docs/integration-agent-loops.md]
---

# Recommendations from an agent-loop integration (downstream consumer)

## Goal
Capture concrete, prioritized improvements to drupal-dev-mcp's MCP surface based on a real integration: a durable agent workflow runtime (one coordinating LLM in a controlled state machine, approval-gated side effects, per-step budgets) that uses drupal-dev-mcp as its retrieval backend for Drupal development knowledge.

## Context: how we consume the server

- Connected via the standard MCP Python SDK over stdio; all three tools registered as namespaced contracts (`drupal__search_drupal`, `drupal__get_drupal_entity`, `drupal__explore_drupal_relationships`) in a typed tool registry with policy metadata.
- Policy (side-effect level, approval requirement, idempotency) is resolved as **config override > server annotation hints > conservative default**. Your annotations resolved everything with zero config.
- The retrieve route of our state machine is pointed at `drupal__search_drupal`; results are distilled into provenance-carrying facts (`"{uri}: {title} — {excerpt}"`) that ground the coordinator's final answer.

## What already works extremely well (keep, do not regress)

1. **Complete, honest tool annotations** (`readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false`). Most MCP servers omit annotations, which forces policy engines onto the conservative default (treat as external + require human approval) — that kills usability. Yours resolved to the lowest-friction tier automatically. This is the single biggest reason integration was zero-config.
2. **Reasoning kept outside the server.** Deterministic, closed-world, evidence-not-advice tools are exactly what approval-gated agent loops need: knowledge retrieval stays free of approval gates, action stays on the agent side where gates live. Recommend explicitly **not** adding write/exec tools — the trust boundary is a feature.
3. **Provenance on every result** (stable `ent_` IDs, `drupal://` URIs, version compatibility, freshness). This is what makes grounding enforcement possible downstream.
4. **Declared output schemas** on all tools. Rare among MCP servers; lets clients type results.

## Recommendations (prioritized)

### P1 — highest value for agent loops

**R1. Compact output mode for context budgeting.**
Agents pay per token and retrieved facts persist in a growing prompt for the rest of the run. Add a `verbosity: "compact" | "full"` (or `fields: [...]`) parameter to `search_drupal` and `get_drupal_entity`; compact returns URI + title + one-line summary, full as today. We wrote a client-side distiller to do this; server-side support would serve every token-budgeted client and keep the wire contract explicit. A `snippet_max_chars` parameter would also help.

**R2. A citation-verification tool (grounding enforcement).**
`verify_citation(uri, claim)` → returns the underlying evidence chunk(s) and a deterministic relevance verdict; or minimally `get_document(id)` exposing raw chunk text so clients can check a claim against source without re-searching. Trustworthy agent frameworks want to *enforce* "final answers cite evidence" mechanically; today they must trust the agent's paraphrase. This is the strongest possible complement to your evidence-first design — it turns provenance from decoration into a checkable guarantee.

**R3. Batched entity resolution.**
In a step-budgeted loop, every tool call costs a full state-machine step (validate → policy → execute → checkpoint), plus a coordinator turn between steps. `get_entities(entity_ids: [], ...)` would collapse the common search→resolve-N-entities pattern from 2N+1 steps to 2. Even `include_details: true` on search results (inline the entity metadata search already ranks) would remove most round-trips.

### P2 — clear wins, moderate effort

**R4. Cross-version migration impact as structured data.**
`migration_impact(entity_or_project, from_version, to_version)` returning deprecations, removals, and replacements between 10.6 and 11.4. Upgrade tasks are a flagship agent use case; today they require two searches plus LLM inference over the diff, which is exactly where hallucinations creep in.

**R5. Index status/freshness as a tool, not only a resource.**
Tools-only clients (most agent frameworks' MCP loaders, including ours) cannot read `drupal://index/status`. A `get_index_status` tool would let an agent decide whether to trust evidence from a stale index and cite index build date in its answer. Alternatively/additionally: include `index_build_date` in every result's provenance block.

**R6. Machine-readable error contracts.**
Return errors as structured `{code, message, hint}` (e.g. `entity_not_found`, `ambiguous_identifier`, `index_unavailable`). Agent repair loops feed errors back to the coordinator; stable codes make the repair deterministic instead of prose-parsing.

### P3 — polish

**R7. Document/guarantee deterministic search ordering.**
If an agent needs systematic coverage beyond `limit` (max 25), a stable ordering or cursor token enables paging without duplicates or rank drift. If FTS ordering is already deterministic for a fixed index build, say so in the tool description — "stable within an index version" is enough.

**R8. Publish a "bring your own agent loop" integration guide.**
The `@drupal-dev-mcp/agent` package overlaps with what loop runtimes (ours, LangGraph-style systems, etc.) provide. Keep the server reasoning-free (already the philosophy) and document the intended split: server = evidence retrieval, client loop = decisions, budgets, approvals. Include a canonical client config and the recommended policy mapping (`read-only + idempotent` → no approval tier). Integrators currently rediscover this by trial.

**R9. Chunk-level citation URIs in search results.**
If evidence granularity is chunk-level, return both chunk and parent-document URIs so downstream citations can be as precise as the evidence they rest on.

## Triage (2026-08-25)

Every recommendation was verified against the 0.2 code (`packages/server/src/server.ts`, `packages/knowledge/src/query/provider.ts`). The doc's premises are accurate: annotations, output schemas, provenance, and resource links all exist as described.

| Rec | Verdict | Rationale |
|-----|---------|-----------|
| R1 compact output | **Adopt (scoped).** `snippet_max_chars` added to `search_drupal`; JSON text fallback switched from pretty-printed to compact serialization. `verbosity`/`fields` knobs declined — `include_snippets` + `snippet_max_chars` + `limit` already bound every field class; extra knobs bloat the contract. |
| R2 citation verification | **Adopt minimal.** New `get_drupal_document` tool exposes exact indexed text (document or single chunk) to tools-only clients. Full `verify_citation(uri, claim)` declined: a "deterministic relevance verdict" is reasoning, which belongs client-side per the server's closed-world stance. |
| R3 batch entity resolution | **Adopt.** New `get_drupal_entities` tool (1–25 IDs, deduplicated, optional relations off by default for token budgeting). |
| R4 migration impact | **Defer.** Feasible as deterministic SQL over `deprecated` status, `replacement_hint`, `deprecated_by`, and cross-version `equivalent_to` edges — but the index pins exactly two versions (10.6, 11.4), so the tool's surface is narrower than the recommendation implies. Revisit when a third version lands. |
| R5 index status tool | **Adopt.** New `get_index_status` tool wrapping the existing `KnowledgeProvider.getIndexStatus()`. Search responses already embedded index status; entity/relationship responses and tools-only clients now covered too. |
| R6 error contracts | **Partially done, rest deferred.** `get_drupal_entity` already returns structured `found`/`ambiguous`/`not_found`; new tools follow the same pattern. A full `{code, message, hint}` taxonomy for thrown errors is deferred until a real repair loop needs more. |
| R7 deterministic ordering | **Adopt minimal.** Deterministic tie-breakers added to all SQL candidate selection and edge sorts; tool descriptions now state ordering is stable within an index build. Cursor paging declined — `limit` caps at 25 and no consumer has demonstrated the need. |
| R8 integration guide | **Adopt.** Published as [`docs/integration-agent-loops.md`](../../docs/integration-agent-loops.md): canonical client config, annotation → policy-tier mapping, recommended call patterns, token-budgeting knobs. |
| R9 chunk-level URIs | **Adopt.** Semantic hits now carry `chunkId` + `chunkResourceUri` (`drupal://document/{docId}#chunk/{chunkId}`); `readResource` and `get_drupal_document` resolve chunk URIs. Lexical hits remain document-level (FTS5 granularity). |

### Stale roadmap flag

The exit criterion below pointed at [`roadmap-phased-milestones.md`](roadmap-phased-milestones.md), which was stale at triage time: it still described the removed 0.1 tool surface (`src/tools/*.ts`, `src/lib/retrieval.ts`) and dead file paths. The roadmap was updated to the 0.2 architecture on 2026-08-25 and now carries the adopted items as a phase. Three other active plans also target the removed 0.1 surface and are flagged there as archive candidates: `skill-rag-integration-plan.md`, `tutorials-and-examples-implementation-plan.md`, `etl-trigger-from-mcp-plan.md`.

## Key Decisions
- Recommendations are ordered by value to step-budgeted, approval-gated agent loops, not by implementation ease.
- Nothing here requires changing the read-only, closed-world stance — all items strengthen it.

## Exit Criteria
- Roadmap owner triages R1–R9 into future phases (or explicitly declines with rationale). — **Met 2026-08-25**: see the Triage section above; adopted items are tracked in [`roadmap-phased-milestones.md`](roadmap-phased-milestones.md).
