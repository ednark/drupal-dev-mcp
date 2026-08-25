# Integrating drupal-dev-mcp into your own agent loop

This guide is for consumers that run their own durable agent runtime (a coordinating LLM in a controlled state machine, approval-gated side effects, per-step budgets) and want drupal-dev-mcp as the retrieval backend for Drupal development knowledge.

The split is deliberate: **the server is evidence retrieval only; your loop owns reasoning, decisions, budgets, and approvals.** The server never synthesizes advice, executes commands, fetches URLs at query time, or mutates the workspace. If you need those, add them on the agent side where your gates already live.

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

Recommended resolution order for policy engines: **config override > server annotation hints > conservative default**. With these annotations, all six tools resolve to the lowest-friction tier (no human approval, safe to retry) with no per-tool config. There are no write or exec tools by design; the trust boundary is a feature. Do not expect — or request — side-effecting tools from this server.

## Tools and recommended routing

| Tool | Route it as | Notes |
|------|-------------|-------|
| `search_drupal` | retrieve | Evidence + provenance, never advice. Default route for grounding. |
| `get_drupal_entity` | resolve | One entity by `ent_…` ID or exact identifier; explicit disambiguation. |
| `get_drupal_entities` | resolve | Batch of up to 25 IDs in one step; unknown IDs return `not_found` per item instead of failing the batch. Collapses search→resolve-N from 2N+1 steps to 2. |
| `explore_drupal_relationships` | traverse | Deterministic, evidence-backed edges; confidence `>= 0.7` by default. |
| `get_drupal_document` | verify | Exact indexed text of a document or a single chunk. Use to check a claim against source without re-searching. |
| `get_index_status` | trust | Active build readiness, build date, versions, counts. Cite `builtAt` when freshness matters. |

Typical grounded flow:

1. `search_drupal` → collect `resourceUri` / `chunkResourceUri` + provenance per hit.
2. `get_drupal_entities` for any `ent_…` results you need in full (one batched call).
3. Distill into provenance-carrying facts, e.g. `"{uri}: {title} — {excerpt}"`.
4. Before admitting a final answer, `get_drupal_document` the cited URIs and check the claim against exact text.

## Token budgeting

- `limit` (max 25), `include_snippets: false`, and `snippet_max_chars` (40–2000) bound search payloads.
- `get_drupal_entities` omits relations unless `include_relations: true`.
- The JSON text fallback is compact (no pretty-printing); prefer `structuredContent` when your loader supports typed results — every tool declares an output schema.
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

- No synthesis, planning, or advisory output — that is what your loop (or `@drupal-dev-mcp/agent`, if you want a reference implementation) is for.
- No index mutation: fetching and rebuilding are maintainer CLI operations (`npm run index:*`), never tool calls.
- No open-world access: the server answers only from the closed, versioned index it opened at startup.
