# Drupal Dev MCP 0.2 architecture

## Responsibility boundaries

The repository has three layers joined by the `KnowledgeProvider` interface.

```text
@drupal-dev-mcp/agent
  reasoning, iteration, evidence budgets, citations
                 |
                 v
KnowledgeProvider
  search | getEntity | getEntities | exploreRelationships | readResource | getIndexStatus
                 ^
                 |
@drupal-dev-mcp/server
  stdio MCP schemas, annotations, structured output, resource links
                 |
                 v
@drupal-dev-mcp/knowledge
  source registry, versions, SQLite/FTS5, graph, optional LanceDB
```

The MCP process is read-only. Fetching and indexing are separate maintainer operations. The agent may reason over evidence but cannot admit material that was not returned by `KnowledgeProvider`.

## Source and version model

`SOURCE_REGISTRY` is the single source of truth for source key, source type, authority, default search eligibility, fetcher/parser adapter, canonical location, version policy, and lexical/vector/graph participation.

Drupal core is fetched into independent shallow snapshots:

- `data/sources/drupal-core-10.6` from `10.6.x`
- `data/sources/drupal-core-11.4` from `11.4.x`

Queries default to 11.4. `all`, `general`, branch labels, and Composer-style contrib constraints normalize through one compatibility model. Core-major mismatches are filtered before ranking. An explicit `all` search marks results as cross-version instead of implying compatibility.

## Storage and identity

Each build contains `knowledge.sqlite`, a manifest, verification reports, and optionally `vectors.lance/chunk_vectors.lance`.

SQLite tables:

- `index_runs` records schema, corpus digest, embedding model, timing, status, and build metadata.
- `source_snapshots` records authority, version scope, compatibility, repository reference, commit, and fetch time.
- `nodes` provides graph-wide stable node identity.
- `documents` stores exact content and provenance.
- `chunks` stores deterministic structural chunks and content hashes.
- `entities` and `entity_aliases` store exact semantic entities and lookup aliases.
- `relations` stores deterministic edges, evidence, extractor, and confidence.
- `document_fts` and `entity_fts` provide FTS5 retrieval.

Entity and document IDs are opaque deterministic hashes with `ent_…` and `doc_…` prefixes. Chunk IDs derive from document identity, structural location, ordinal, and content hash. Re-indexing identical material therefore preserves public resource URIs.

## Semantic extraction

No LLM creates graph edges.

The PHP parser extracts declarations, namespace imports, inheritance, interface implementations, trait use, containment, calls, instantiation, Drupal hook implementations, plugin attributes, and deprecation hints. The YAML parser extracts service definitions, aliases, decorators, injection, tags, routes, handlers, permissions/requirements, and config references. Matching Drupal 10.6 and 11.4 entities receive evidence-backed `equivalent_to` edges.

Confidence policy:

- `1.0` — explicit declaration or configuration.
- `0.9` — statically resolved reference.
- `0.75` — deterministic Drupal convention.
- `0.4` — unresolved or heuristic reference.

Public traversal defaults to `0.7`, so heuristic call edges are excluded unless a caller opts in.

## Retrieval

Retrieval runs in this order:

1. Hard version, project, source-type, and entity-kind filters.
2. FTS5 document and entity retrieval.
3. Optional semantic retrieval from the one normalized `chunk_vectors` table.
4. Reciprocal-rank fusion.
5. Exact symbol/alias boosts.
6. Authority and deprecation tie-breaking.
7. Grouping with provenance, compatibility, freshness, and resource URIs.

Embedding vectors are cached by embedding model and chunk content hash in `data/index/embedding-cache.sqlite`. Rebuilds reuse unchanged vectors. If vectors, credentials, or the provider are unavailable, the response reports `lexical_only` and remains usable.

## Activation and rollback

Every build writes to `data/index/builds/{run-id}`. Verification checks that content exists, SQLite integrity passes, foreign keys are valid, resources have graph nodes, and at least 99% of eligible PHP/YAML files parse. Parse failures are retained in `verification.json`.

Only a verified build can replace `data/index/active.json`. Replacement uses a same-directory temporary file and atomic rename. Failed builds remain available for diagnosis and never replace the prior successful build.

## MCP contract

`@drupal-dev-mcp/server` uses the high-level `McpServer` API. Tool inputs and structured outputs are Zod-validated. Each call also includes a JSON text fallback and exact MCP resource links.

Tool annotations are fixed to:

```json
{
  "readOnlyHint": true,
  "destructiveHint": false,
  "idempotentHint": true,
  "openWorldHint": false
}
```

The only runtime transport is local stdio.

Tools cover evidence search, single and batch entity resolution, graph traversal, exact document/chunk retrieval for citation verification, and index status. Semantic search hits carry chunk-level citation URIs (`drupal://document/{docId}#chunk/{chunkId}`) that `readResource` resolves to exact indexed chunk text. See [integration-agent-loops.md](integration-agent-loops.md) for external agent-loop integration.

## Verification gates

`npm test` covers stable IDs, version compatibility, PHP/YAML extraction, confidence filtering, SQLite/FTS5, unified vectors and embedding reuse, atomic activation and rollback, lexical-only operation, exact entity lookup, graph traversal, MCP schemas/annotations/resources, and agent evidence isolation/budgets/stops.

`npm run index:benchmark` checks whether relevant evidence appears in the top five for the 20 maintained benchmark questions. Release requires at least 16 passes. `npm run index:verify` must pass before the generated build is considered active.
