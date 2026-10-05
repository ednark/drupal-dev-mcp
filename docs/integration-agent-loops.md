# Integrating drupal-dev-mcp into your own agent loop

This guide is for consumers that run their own durable agent runtime (a coordinating LLM in a controlled state machine, approval-gated side effects, per-step budgets) and want drupal-dev-mcp as the retrieval backend for Drupal development knowledge.

The split is deliberate: **the server is evidence retrieval only; your loop owns reasoning, decisions, budgets, and approvals.** The server never synthesizes advice, executes commands, fetches URLs at query time, or mutates the workspace. If you need those, add them on the agent side where your gates already live.

The normative wire contract — schemas, result envelope, `_meta` keys, resource URIs, capability advertisement, status semantics — is [tools-spec.md](tools-spec.md). This guide covers usage; the spec wins on contract questions.

## Canonical client configuration

```json
{
  "mcpServers": {
    "drupal-dev-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/drupal-dev-mcp/packages/server/dist/index.js"],
      "env": {
        "DRUPAL_MCP_INDEX_ROOT": "/absolute/path/to/drupal-dev-mcp/data/index"
      }
    }
  }
}
```

Transport is local stdio. Build the index first (`npm run index:fetch && npm run index:rebuild && npm run index:verify`); the server opens the active verified build read-only.

## Policy mapping: zero-config by annotations

Every tool declares complete MCP annotations:

```json
{ "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
```

Recommended resolution order for policy engines: **config override > server annotation hints > conservative default**. With these annotations, all six retrieval tools resolve to the lowest-friction tier (no human approval, safe to retry) with no per-tool config. `ask_a_drupal_expert` is read-only in effect but declares `idempotentHint: false` (LLM output varies per call) and `openWorldHint: true` (it calls an external LLM provider), so policy engines can gate it distinctly; it also hard-fails to `status: "unavailable"` without an API key, which is the simplest permission boundary of all. Capability-aware loops get an earlier signal: the server advertises `experimental["drupal-dev-mcp/synthesis"] = { tool, available }` at `initialize`, so you can prune or warn before the first call — the runtime `unavailable` fallback remains authoritative either way. There are no write or exec tools by design; the trust boundary is a feature. Do not expect — or request — side-effecting tools from this server.

## Tools and recommended routing

| Tool | Route it as | Notes |
|------|-------------|-------|
| `search_drupal` | retrieve | Evidence + provenance, never advice. Default route for grounding. `source_types: ["guidance"]` for change-placement questions. |
| `get_drupal_entity` | resolve | One entity by `ent_…` ID or exact identifier; explicit disambiguation. |
| `get_drupal_entities` | resolve | Batch of up to 25 IDs in one step; unknown IDs return `not_found` per item instead of failing the batch. Collapses search→resolve-N from 2N+1 steps to 2. |
| `explore_drupal_relationships` | traverse | Deterministic, evidence-backed edges; confidence `>= 0.7` by default. |
| `get_drupal_document` | verify | Exact indexed text of a document or a single chunk. Use to check a claim against source without re-searching. |
| `get_index_status` | trust | Active build readiness, build date, versions, counts. Cite `builtAt` when freshness matters. |
| `ask_a_drupal_expert` | decide | Reference implementation of evidence→conclusion synthesis: options with conventional locations, trade-offs, mandatory `drupal://` citations. Use when a question asks *where changes should live* or *when to choose an approach*; retrieval tools stay pure-evidence. |

Typical grounded flow:

1. `search_drupal` → collect `resourceUri` / `chunkResourceUri` + provenance per hit.
2. `get_drupal_entities` for any `ent_…` results you need in full (one batched call).
3. Distill into provenance-carrying facts, e.g. `"{uri}: {title} — {excerpt}"`.
4. Before admitting a final answer, `get_drupal_document` the cited URIs and check the claim against exact text.

For placement/decision questions ("migrating this site — where do style changes go?", "custom theme or sub-theme?"), either run that flow yourself or delegate once to `ask_a_drupal_expert` and verify its citations exactly as step 4 describes. The expert automatically includes curated `guidance`-type convention documents for such questions; its output still names every option's trade-offs rather than issuing a single imperative.

## Drafting design docs (Lynch recipe)

`ask_a_drupal_expert` with `depth: "research"` already emits a design-doc-shaped report (Objective, Goals/non-goals, Findings, Alternatives, Open issues, Version notes, Recommended steps). Use this recipe when your loop drafts the doc itself instead of delegating. Adapted from Lynch's "cost of getting it wrong": spend evidence budget on hard-to-reverse choices, not trivia.

| Lynch section | Tool flow | Notes |
|---|---|---|
| Objective (1 sentence) | None — write from the user request | Plain language any stakeholder understands. |
| Background, Related docs | `search_drupal` (broad) + `get_drupal_document` | Self-contained first page; link prior docs by `drupal://` URI. |
| Goals / Non-goals | `search_drupal` with `source_types: ["guidance"]` for placement norms | Frame as impact ("reduce deploy outages"), never implementation ("add Kubernetes"). State out-of-scope explicitly. |
| Findings / Interfaces | `get_drupal_entity` / `get_drupal_entities` + `get_drupal_document` | Quote exact signatures, service IDs, config keys; cite chunk URIs. |
| Diagram | `explore_drupal_relationships` → fenced `mermaid` flowchart | Only nodes/edges the traversal returned; omit when thin, never invent identifiers. |
| Alternatives considered | `search_drupal` follow-ups per rejected option | A few brief lines + why rejected, not exhaustive. |
| Open issues | Gap between question and admitted evidence | Format: problem / options seen / immediate next step. |
| Version notes | `search_drupal` per version + `explore_...` `changed_by` / `deprecated_by` | Defer to `get_index_status` `builtAt` for freshness. |

Do not invent what the index cannot ground: SLOs, monitoring/alerting, timelines, logging volumes, privacy/legal/security posture. When the design needs them, file them under Open issues as "requires project input" — the same `None identified` convention the expert uses for Alternatives, Open issues, and Version notes.

Triage rule: hard-to-reverse (custom module vs theme vs config vs `settings.php` vs contrib patch; storage/API/language) gets full evidence + alternatives + trade-offs. Easy-to-reverse (label text, CSS tweak, list limit) gets one line and no argument.

## Token budgeting

- `limit` (max 25), `include_snippets: false`, and `snippet_max_chars` (40–2000) bound search payloads.
- `get_drupal_entities` omits relations unless `include_relations: true`.
- The JSON text fallback is compact (no pretty-printing); prefer `structuredContent` when your loader supports typed results — every tool declares an output schema. Host-actionable signals (`status`, `degradedMode`) are additionally mirrored under result `_meta` keys `drupal-dev-mcp/status` and `drupal-dev-mcp/degraded-mode`; see the envelope table in [tools-spec.md](tools-spec.md).
- Retrieved facts persist in a growing prompt for the rest of a run; budget at the tool call, not after it.

## Citations and grounding

- Every result carries `resourceUri` (`drupal://entity/{id}` or `drupal://document/{id}`), version compatibility, authority, and `freshness`.
- Semantic search hits additionally carry `chunkId` and `chunkResourceUri` (`drupal://document/{docId}#chunk/{chunkId}`) — cite at chunk granularity when the evidence is chunk-level. Lexical (FTS5) hits are document-level.
- `drupal://` URIs are stable across re-indexes of identical content; canonical source URLs are included in `provenance` for human-facing citations.
- Grounding enforcement is mechanical: compare the admitted answer's cited URIs against `get_drupal_document` output. The server gives you the exact text; the verdict stays in your loop.

## Determinism and freshness

- Result ordering is deterministic within a single index build (stable tie-breakers throughout). It can change between builds — treat the build, not the query, as the unit of reproducibility.
- Call `get_index_status` to decide whether to trust evidence from a stale index and to cite the index build date in answers.
- Hybrid/semantic modes send the query to the configured embedding provider; `mode: "lexical"` is fully local and reports no degradation. When embeddings are unavailable, responses report `degradedMode: "lexical_only"` and remain usable.

## What not to expect

- No synthesis, planning, or advisory output from the six retrieval tools — that is what your loop (or `@drupal-dev-mcp/agent`, or the opt-in `ask_a_drupal_expert` wrapper) is for.
- No index mutation: fetching and rebuilding are maintainer CLI operations (`npm run index:*`), never tool calls.
- No open-world access: the retrieval tools answer only from the closed, versioned index opened at startup. The one declared exception is `ask_a_drupal_expert`, which sends gathered evidence to a configured LLM and returns only what that evidence supports.
