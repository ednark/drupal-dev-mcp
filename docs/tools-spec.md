# drupal-dev-mcp — tool & surface specification (0.2.x)

**This document is the normative contract** for the MCP surface exposed by
`@drupal-dev-mcp/server`: tool names, input/output schemas, the result
envelope, resource URIs, capability advertisement, and status semantics.

- The implementation lives in [`packages/server/src/server.ts`](../packages/server/src/server.ts); any change to the surface must update this document in the same change.
- Usage guidance, routing recipes, and token budgeting for agent-loop authors live in [integration-agent-loops.md](integration-agent-loops.md). When the two disagree, this document wins on contract questions.
- Tool descriptions on the wire are kept compact (discovery-critical facts only: what the tool returns, query style for `search_drupal`, expert gating and verify-your-citations). The full operational guidance — routing, grounding workflow, token budgeting, design-doc recipe — lives in the companion skill [`skills/querying-drupal-knowledge/`](../skills/querying-drupal-knowledge/SKILL.md) and in [integration-agent-loops.md](integration-agent-loops.md).

Transport is local stdio. The server opens the active verified index build
read-only. There are no write, exec, or network-fetch tools; the retrieval
tools answer only from the closed index, with one declared exception
(`ask_a_drupal_expert`, which sends gathered evidence to a configured LLM).

## Capability advertisement

At `initialize`, the server advertises one static capability under
`capabilities.experimental` (MCP SDK 1.27 has no `extensions` namespace yet;
when the SDK gains it, the same object moves there with the `experimental`
entry kept for older clients):

```json
{
  "experimental": {
    "drupal-dev-mcp/synthesis": {
      "tool": "ask_a_drupal_expert",
      "available": true
    }
  }
}
```

`available` reflects `OPENAI_API_KEY` presence in the server environment,
evaluated once at construction. API-key presence is fixed for the process
lifetime, so this never goes stale.

**Static facts only.** Dynamic facts (index readiness, build freshness,
counts) are deliberately excluded from capabilities because they can change
mid-session; query `get_index_status` or `drupal://index/status` for those.

Capability-aware clients may prune `ask_a_drupal_expert` from their tool
surface or warn before the first call. The runtime fallback is unchanged:
calling the tool without a key returns `status: "unavailable"`, and every
other tool keeps working. Clients that ignore unknown capabilities are
unaffected.

## Result envelope

Every successful tool result carries:

1. `content` — one `text` item with compact (non-pretty) JSON of the payload, plus one `resource_link` per distinct `drupal://` URI cited by the result.
2. `structuredContent` — the same payload as a typed object. Every tool declares an `outputSchema`; prefer this field when your loader supports typed results.
3. `_meta` *(optional)* — a namespaced mirror of the few host-actionable envelope signals, so MCP hosts can react without parsing `structuredContent`:

| `_meta` key | Present when | Value |
|---|---|---|
| `drupal-dev-mcp/status` | payload has a top-level `status` | same string, e.g. `found`, `unavailable` |
| `drupal-dev-mcp/degraded-mode` | search ran degraded | `"lexical_only"` |

The payload in `structuredContent` remains the authoritative, complete
contract; `_meta` is a convenience mirror, not a second source of truth. If
you read only one, read the payload.

## Common parameter semantics

- `drupal_version`: `"10.6" | "11.4" | "12.0" | "all"`, default `"11.4"`. The active set of versions is reported by `get_index_status` (`availableDrupalVersions`) — do not hardcode beyond the enum.
- Opaque IDs are prefix-tagged: entities `ent_…`, documents `doc_…`, chunks `chk_…`. Input schemas enforce the prefixes.
- Limits and floors are bounded by `zod` on the wire; out-of-range values fail validation before reaching the provider.

## Tools

### `search_drupal`

Evidence search over the closed index. Never synthesizes advice.

Input: `query` (required, 1+ chars), `drupal_version` (default `11.4`),
`mode` (`hybrid | lexical | semantic`, default `hybrid`), `projects` (string[]),
`source_types` (string[]; `"guidance"` narrows to the curated change-placement
corpus), `entity_kinds` (enum array, see node kinds below), `limit` (1–25,
default 8), `include_snippets` (default true), `snippet_max_chars` (40–2000),
`min_score` (0–1, default 0.2; results below are dropped as noise).

Output: `query`, `appliedFilters`, `index` (active build summary),
`degradedMode?` (`"lexical_only"` when embeddings are unavailable),
`results[]`, each with: `id`, `resultType` (`document | entity`), `title`,
`snippet?`, `score`, `exactMatch`, `sourceType`, `authority`, `project?`,
`drupalVersion`, `compatibility` (`compatible | cross_version`), `status`,
`freshness`, `chunkId?` / `chunkResourceUri?` (chunk-level citation URIs on
semantic hits), `provenance`, `resourceUri`.

Query style matters: short keyword/identifier queries score best; the tool
description carries the model-facing guidance.

### `get_drupal_entity`

Resolve one entity by `entity_id` (`ent_…`) **or** `identifier` (exact string)
— exactly one, enforced by refinement. Optional `drupal_version`, `project`,
`kind` (node kind), `include_relations` (default true), `relation_limit`
(1–100, default 25).

Output: `status` (`found | ambiguous | not_found`), and per status: `entity`,
`candidates` (disambiguation list when ambiguous), `incoming` / `outgoing`
relationships (when requested), `evidence`. Candidate ordering is
deterministic within a single index build.

### `get_drupal_entities`

Batch resolve 1–25 `ent_…` IDs in one call. `drupal_version` (default
`11.4`), `include_relations` (default **false**), `relation_limit`.

Output: `results[]`, each `{ entityId, status: found | not_found, entity?,
incoming?, outgoing?, evidence? }`. Unknown IDs are reported per item;
the batch never fails because of individual misses.

### `get_drupal_document`

Return the exact indexed text of `document_id` (`doc_…`), or of one
`chunk_id` (`chk_…`) within it. Verification primitive: check a claim against
source without re-searching.

Output: `status` (`found | not_found`), `uri`, `mimeType`, `text`, and
`textLength` (character count of `text`). Large documents can exceed 10k
tokens whole; `search_drupal` hits carry chunk-level `chunkResourceUri`
values — for long documents, verify at chunk granularity instead of
fetching the full text.

### `get_index_status`

Active verified build report: `ready`, `schemaVersion`, `runId?`, `builtAt?`,
`defaultDrupalVersion`, `availableDrupalVersions`, `counts`,
`embeddingModel?`, `buildPath?`, `fixtureLimit?`,
`verification?` `{ passed, errors[], warnings[] }`.

Use it to decide whether to trust evidence freshness; cite `builtAt` when
freshness matters to a claim.

### `explore_drupal_relationships`

Traverse evidence-backed graph edges from `entity_id` (`ent_…`). Optional
`predicates` (enum array, below), `direction` (`incoming | outgoing | both`,
default `both`), `max_depth` (1–3, default 1), `min_confidence` (0–1, default
`0.7` — lower-confidence edges are excluded by default), `max_nodes` (1–200,
default 50), `include_evidence` (default true).

Output: `startEntity`, `nodes[]`, `edges[]` (each may carry
`evidenceDocumentId`), `truncated`.

Node kinds: `document, module, class, interface, trait, enum, method,
function, hook, service, plugin, route, event, config`.
Predicates: `contains, defines, extends, implements, uses_trait, calls,
instantiates, references, implements_hook, invokes_hook, implemented_by,
aliases, decorates, injects, tagged_with, handled_by, subscribes_to,
dispatches, deprecated_by, documented_by, changed_by, example_of,
equivalent_to`.

### `ask_a_drupal_expert` *(opt-in synthesis)*

The single synthesis tool; everything above is pure-evidence. Input:
`question` (natural language is fine), `depth` (`ask` = one evidence round,
concise answer; `research` = iterative multi-query rounds producing a
design-doc-shaped report), `drupal_version` (default `11.4`).

Annotations differ from the retrieval tools: `idempotentHint: false` (LLM
output varies per call) and `openWorldHint: true` (calls an external LLM
provider) so policy engines can gate it distinctly.

Output `status` enum:

| Status | Meaning |
|---|---|
| `answered` | Grounded answer/report with `citations[]` (`resourceUri`, `canonicalUrl?`, `title`) and mechanical `grounding` stats (`sentences`, `citedSentences`, `groundingDensity`). Low density is a warning; high density is not proof of support. |
| `insufficient_evidence` | The evidence could not ground an answer; never a guess. |
| `unavailable` | No `OPENAI_API_KEY` in the server environment. All other tools keep working. |
| `error` | Provider/runtime failure; `reason` carries the message. |

Gating order: capability advertisement (static, see above) → runtime
`unavailable` fallback (authoritative for all clients). Alternative
endpoints: honors `OPENAI_BASE_URL` / `OPENAI_AGENT_MODEL` (OpenAI-compatible
local endpoints); only generation is swappable — embeddings always use
OpenAI endpoints, so without an embeddings-capable key, search reports
`degradedMode: "lexical_only"`.

## Resources

| URI | Type | Description |
|---|---|---|
| `drupal://index/status` | `application/json` | Active verified index status and freshness. |
| `drupal://entity/{id}` | `application/json` | One entity and its evidence-backed relationships. |
| `drupal://document/{id}` | `text/plain` | Exact indexed source content and provenance. |
| `drupal://document/{id}#chunk/{chunkId}` | `text/plain` | Single chunk within a document. |

The entity/document templates are **not enumerable** (`list: undefined`):
clients resolve them by known ID (from tool results), never by listing.
`drupal://` URIs are stable across re-indexes of identical content; canonical
source URLs travel in result `provenance` for human-facing citations.

## Annotations and policy mapping

All retrieval tools declare `{ readOnlyHint: true, destructiveHint: false,
idempotentHint: true, openWorldHint: false }`; `ask_a_drupal_expert` overrides
the last two. The full recommended policy-engine resolution order is in
[integration-agent-loops.md](integration-agent-loops.md) — contract-wise, the
only guarantee is: no tool mutates state, executes commands, or fetches
arbitrary URLs.

## Degradation and determinism

- When embeddings are unavailable, search remains fully operational through SQLite FTS5 and reports `degradedMode: "lexical_only"` (payload and `_meta`). Lexical hits are document-level; semantic hits carry chunk-level `chunkResourceUri`.
- Result ordering is deterministic within a single index build (stable tie-breakers). Ordering may change between builds — the build, not the query, is the unit of reproducibility.
- Index activation is atomic: a build becomes active only after verification passes; a failed build leaves the prior active manifest untouched. See [architecture-0.2.md](architecture-0.2.md).