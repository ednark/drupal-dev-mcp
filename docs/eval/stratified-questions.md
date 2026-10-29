# Stratified eval questions (research intake 2026-10-29)

Ten questions stratified by category beyond plain lookup — version traps, concept traps, absence, and fabricated names. Derived from the drupal-dev-mcp researcher's 2026-10-29 daily report (Program B), with ground truth verified against the indexed snapshots where noted.

Scoring: retrieval cases (R) are automatable in the benchmark gate; refusal/correctness cases (A) need agent-level evaluation (ask_a_drupal_expert or a full agent), scored 0–5 per the rubric in `benchmark-questions.md`.

## Lookup

1. **R** — "How do I invalidate a custom block when its content is edited?"
   Expected: block-content cache tag derivation; anti-pattern `09-cache-tags-vs-contexts-custom-blocks.md`.
2. **R** — "Write a hook_entity_presave implementation for module X on 11.x."
   Expected: current hook form for the target line; anti-pattern `02-hook-implementations-in-module-file.md` (OOP `#[Hook]` since 11.1).

## Concept trap

3. **A** — "My block changes per current node. Should I use a cache tag or a cache context?"
   Expected: the distinction (tags invalidate on entity change, contexts create variants), not one mechanism for both. Anti-pattern `09`.
4. **A** — "Render this user-submitted string with Twig."
   Expected: avoid `|raw`; escaping rules. Anti-pattern `03`.

## Version trap

5. **A/R** — "Can I use Drupal Canvas on Drupal 10.6?"
   Expected: no — Canvas requires ^11.3 (verified from `canvas.info.yml`). The 10.6-scoped retrieval must not surface Canvas as usable. Gate case pending: canvas enters the contrib index at the next rebuild.
6. **A/R** — "Is the Contact module in Drupal 12.0 core?"
   Expected: removed (verified: absent from `drupal-core-12.0`, `lifecycle: deprecated` in 11.4). Placement `15`.
7. **R** — "What PHP version does Drupal 11.4 require?"
   Expected: >= 8.3.0 from the line's composer.json — and beware the contrib-proximity trap (a contrib composer.json must not outrank core docs; see corpus-issues `php-floor-drupal-11-contrib-proximity`). Placement `16`.

## Absence (correct refusal)

8. **A** — "Does Drupal core provide a built-in MCP server?"
   Expected: the answer must be grounded or `insufficient_evidence` — the corpus should not invent one. (The contrib `mcp_server` module exists and is now indexed; a grounded answer distinguishes contrib from core.)

## Fabricated name (correct refusal)

9. **A** — "Install `drupal/block_cache_pro` and configure it."
   Expected: refuse or flag as unverified. This exact failure was demonstrated by our own research intake: the report proposed indexing `drupal/tool_api`, which does not exist on drupal.org (404) — caught by deterministic git-clone verification.

## Tool-name contract

10. **A** — "Which tool does the docs search?"
    Expected: the exact exposed tool name (`search_drupal`), not a guideline alias — the Laravel Boost failure mode (guidelines referencing `search-docs` while the wire name differs). Contract-tested in `packages/server/tests` (B9).
