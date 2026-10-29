---
name: querying-drupal-knowledge
description: Retrieves Drupal development evidence (APIs, hooks, services, entities, theming, forms, caching, migration, deployment) through the drupal-dev-mcp MCP server with mandatory drupal:// citations. Use when answering Drupal implementation questions, building or theming a Drupal site, upgrading or migrating content, or when the user mentions Drupal, drush, Twig, hooks, entities, plugins, or Views.
---

# Querying Drupal knowledge via drupal-dev-mcp

The server is a read-only evidence engine over a closed, versioned index
(Drupal core 10.6 + 11.4 + 12.0 code, api.drupal.org, change records, official
guides, user guide, coding standards, 73 contrib modules, PHP/Twig/Symfony/
Drush docs, curated placement guidance). It returns evidence with provenance;
it never executes code, fetches URLs, or mutates state. Synthesis exists as
one opt-in exception (`drupal-dev-mcp:ask_a_drupal_expert`).

## Tool routing

| Tool | Route it as | Notes |
|------|-------------|-------|
| `drupal-dev-mcp:search_drupal` | retrieve | Default first step for grounding. `source_types: ["guidance"]` narrows to the curated change-placement corpus (plus AI-frequent anti-pattern docs) — "where should X live" placement questions and "what is the current pattern instead of Y" repairs. |
| `drupal-dev-mcp:get_drupal_entity` | resolve | One entity by `ent_…` ID or exact identifier; explicit disambiguation. |
| `drupal-dev-mcp:get_drupal_entities` | resolve | Up to 25 `ent_…` IDs in one call; unknown IDs return per-item `not_found`. |
| `drupal-dev-mcp:explore_drupal_relationships` | traverse | API genealogy: what implements a hook, what deprecated an API (`changed_by`/`deprecated_by`). |
| `drupal-dev-mcp:get_drupal_document` | verify | Exact indexed text of a document or chunk. The citation checker. |
| `drupal-dev-mcp:get_index_status` | trust | Build date and verification — cite `builtAt` when freshness matters. |
| `drupal-dev-mcp:ask_a_drupal_expert` | decide | Placement/decision questions needing conclusions. Opt-in; requires `OPENAI_API_KEY` in the server env. |

## Query style (scores depend on it)

- Use **short keyword or identifier queries**: `hook_entity_presave`,
  `EntityTypeManagerInterface`, `cache tags render array` — not full sentences.
- Run **several narrow queries** rather than one broad one.
- Natural language is fine only for `ask_a_drupal_expert`.
- Filter with `projects`, `source_types`, `entity_kinds`; narrow further with
  `min_score` (default 0.2) and `limit` (default 8, max 25).

## Grounded workflow (copy and check off)

```
- [ ] search_drupal → collect resourceUri / chunkResourceUri + provenance
- [ ] get_drupal_entities for any ent_… results you need in full
- [ ] Distill facts as "{uri}: {title} — {excerpt}"
- [ ] get_drupal_document every URI you will cite; check the claim against exact text
```

Do not present a claim whose citation fails step 4. Prefer chunk-level
`chunkResourceUri` when present. Semantic hits are chunk-level; lexical hits
are document-level.

Long documents: some indexed sources exceed 10k tokens whole (the result's
`textLength` field tells you). For those, verify at chunk granularity —
fetch the chunk's URI (`drupal://document/{id}#chunk/{chunkId}`) rather than
the full document.

## Expert tool caveats

- Without a key it returns `status: "unavailable"`; all retrieval tools keep working. The server also advertises `drupal-dev-mcp/synthesis` capability at initialize when synthesis is available.
- Answers carry mechanical `grounding` stats — low `groundingDensity` is a warning, high density is not proof of support. Verify citations regardless.
- It reports `insufficient_evidence` instead of guessing; treat that as an answer, not a failure.

## Token budgeting

Bound search payloads with `limit`, `include_snippets: false`, and
`snippet_max_chars` (40–2000). Every tool declares an output schema — prefer
`structuredContent` when your loader supports typed results. Details:
[reference/token-budgeting.md](reference/token-budgeting.md)

Design-doc drafting recipe (for `depth: "research"` outputs or drafting
your own): [reference/design-doc-recipe.md](reference/design-doc-recipe.md)

## Degradation and versions

- `degradedMode: "lexical_only"` means embeddings are unavailable; search still works via SQLite FTS5. Lexical-only is normal for fully local setups.
- `drupal_version` accepts `10.6`, `11.4`, `12.0`, or `all` (default `11.4`; 12.0 covers the pre-release 12.0.x branch until 12.0.0 ships); `get_index_status` reports the versions actually present.
- Result ordering is deterministic within an index build; builds are the unit of reproducibility.
