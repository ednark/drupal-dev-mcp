---
status: in-progress
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Skill-aware RAG integration plan for Drupal MCP

This document outlines a concrete, implementable architecture to combine the three Drupal knowledge layers (AI Skills, system prompt instructions, and RAG results) into a single higher-quality Drupal AI assistant MCP server.

Files referenced in this plan are shown as clickable links for implementation and review: [`src/tools/ask-drupal-expert.ts`](src/tools/ask-drupal-expert.ts:1), [`src/index.ts`](src/index.ts:1), [`data/sources/drupal-best-practices/ai/rules/general-rules.md`](data/sources/drupal-best-practices/ai/rules/general-rules.md:1), [`data/sources/drupal-best-practices/ai/commands/commands.md`](data/sources/drupal-best-practices/ai/commands/commands.md:1), and the skills folder root [`data/sources/drupal-best-practices/ai/skills/`](data/sources/drupal-best-practices/ai/skills/:1).

---

## 1. Skill-Aware Query Routing

Design decisions
- Add a deterministic skill detector: implement [`detectSkillDomain(query)`](src/tools/ask-drupal-expert.ts:1) that returns one of the ten skill ids: `views | blocks | fields | nodes | taxonomy | theming | forms | text-formats-editors | config-parser | other-content-entities` or `null` when none match.
  - Implementation approach: a two-stage detector inside [`src/tools/ask-drupal-expert.ts`](src/tools/ask-drupal-expert.ts:1):
    1. Fast rule-based matcher using a domain-keyword map (low cost, deterministic). Example keywords per domain pulled from each [`SKILL.md`](data/sources/drupal-best-practices/ai/skills/:1).
    2. Fallback soft-intent matcher: embed the query and compare to precomputed embeddings of each `SKILL.md` title+summary using the same embedding model (cheap top-1 similarity). Use only when rule-based yields no result.

- Load all `SKILL.md` files once at module initialization into an in-memory map: [`skillMap: Record<string, Skill>`](src/tools/ask-drupal-expert.ts:1). Each Skill object includes `{ id, title, summary, usage, guardrails, validation_command, raw_text }`.

Injection rules
- When [`detectSkillDomain(query)`](src/tools/ask-drupal-expert.ts:1) returns a skill id, inject the corresponding `SKILL.md` content along with `general-rules.md` if the query is site-building related. Injection policy:
  - If skill detected and `isSiteBuildingQuery(query)` is true -> inject both `SKILL.md` + `general-rules.md` before the base system prompt.
  - If skill detected but `isSiteBuildingQuery(query)` is false -> inject `SKILL.md` only (useful for config-parser or code-level queries).
  - If no skill detected but `isSiteBuildingQuery(query)` is true -> inject `general-rules.md` only (current behavior).

Token-bloat mitigation
- `SKILL.md` files are small (30–40 lines). Inject them only when rule-based detection triggers or soft-intent confidence > threshold (e.g., cosine similarity > 0.78). Do not inject multiple SKILL.md files for a single query — only the top matched skill.
- Truncate `SKILL.md.raw_text` to the `Description + Usage + Guardrails` sections (omit References block) to conserve tokens.

Code-level additions
- Add functions in [`src/tools/ask-drupal-expert.ts`](src/tools/ask-drupal-expert.ts:1):
  - [`loadSkills()`](src/tools/ask-drupal-expert.ts:1) — reads `ai/skills/*/SKILL.md` into `skillMap` at module load.
  - [`detectSkillDomain(query)`](src/tools/ask-drupal-expert.ts:1) — returns the matched skill id or null.
  - Enhance `handleAskDrupalExpert(args)` to call `detectSkillDomain` and compute `effectiveSystemPrompt` using layered injection (see section 2).

---

## 2. Enhanced System Prompt Architecture

Layered prompt model (composition and ordering)
- Base layer (always present): assistant identity + citation & hallucination rules — current [`SYSTEM_PROMPT`](src/tools/ask-drupal-expert.ts:110).
- Best practices layer: [`general-rules.md`](data/sources/drupal-best-practices/ai/rules/general-rules.md:1) — injected for site-building queries.
- Skill layer: matched [`SKILL.md`](data/sources/drupal-best-practices/ai/skills/:1) — inject trimmed skill content (Description+Usage+Guardrails) when a skill matches.
- RAG layer: retrieved LanceDB chunks (context prompt) — always appended to the user message as the “Documentation Context” (current pattern in [`src/tools/ask-drupal-expert.ts`](src/tools/ask-drupal-expert.ts:196)).

Ordering and rationale
- System prompt = [ Skill layer (if any) ] + [ Best practices layer (if site-building) ] + [ Base layer ]. Rationale: place the most specific instructions closest to the model input so the model respects domain guardrails first, then broader best-practices, and finally the global identity/citation rules. Practically: prepend Skill and Best-practices above the BASE prompt string before calling `chat(...)`.

Example composition in code (logical):
```
effectiveSystemPrompt = [SKILL_BLOCK?] + [GENERAL_RULES_BLOCK?] + BASE_SYSTEM_PROMPT
```
Represent these blocks with clear separators (e.g., "## Skill Guidance\n...\n---\n").

When to prefer RAG vs skill injection
- Always provide RAG chunks to ground factual claims and code signatures.
- Use SKILL.md + GENERAL_RULES to constrain style, naming, and site-building decisions; SKILL.md should not replace RAG for API-level accuracy.

---

## 3. New MCP Tool: drupal_skill_guide

Design rationale
- Expose a lightweight tool that returns a canonical skill text for an explicit, non-RAG lookup. This allows Claude Code or other skills to call the tool programmatically to fetch authoritative guardrails, validation commands, and usage examples.

Tool signature (JSON input schema)
- name: `drupal_skill_guide`
- description: "Return the canonical SKILL.md content for the requested Drupal skill domain. Returns structured sections for programmatic consumption."
- inputSchema:
  - `skill_id` (string, required) — one of: `nodes`, `blocks`, `views`, `fields`, `taxonomy`, `other-content-entities`, `theming`, `forms`, `text-formats-editors`, `config-parser`.
  - `format` (string, optional) — `raw` | `trimmed` | `json`; default `trimmed`.

Response format
- For `format=trimmed`: return plain text containing `Description`, `Usage`, and `Guardrails` sections only (suitable for injection into system prompts).
- For `format=raw`: return the full SKILL.md content.
- For `format=json`: return `{ id, title, description, usage: [..], guardrails: [..], validation_command, references: [..], raw_md }` as a JSON-serializable object (for programmatic use by tools or pipelines).

Implementation notes
- Add [`src/tools/drupal-skill-guide.ts`](src/tools/drupal-skill-guide.ts:1) with toolkit similar to [`ask_drupal_expert` tool definition](src/tools/ask-drupal-expert.ts:85). Register it in [`src/index.ts`](src/index.ts:4).
- The tool should read from the `skillMap` loaded by `loadSkills()` to avoid duplicative disk reads.

Security and safety
- The tool performs read-only file access and returns no external network results.

---

## 4. Validation Script Integration (Optional)

Recommendation: defer full execution of validation scripts as MCP-callable tools in the initial integration. Offer a read-only preview/tool that returns the `validation_command` and `DDEV-SUPPORT.md` guidance; implement script execution as a gated, opt-in feature for later.

Tradeoffs
- Pros of exposing scripts as tools:
  - Rapid, automated site validation inside CI or by developers through the MCP interface.
  - Strong feedback loop: assistant can run validators and produce concrete fixes.
- Cons / risks:
  - Running shell scripts that call `drush` or `ddev` from the MCP host requires careful sandboxing, permission management, and environment assumptions (DDEV state, database access). Risk of destructive operations if scripts change config or content.
  - Complexity: must surface environment selectors, timeouts, and result parsing.

Suggested phased approach
1. Phase A (safe): Expose `drupal_skill_guide` and provide script metadata (`validation_command`) and `DDEV-SUPPORT.md` guidance via the skill tool.
2. Phase B (opt-in): Add a `drupal_validation_runner` tool that executes scripts but only after an operator toggles `VALIDATOR_ENABLED=true` and the tool enforces whitelisted commands, timeouts, and output-length caps. Run in ephemeral containers (recommended) or DDEV shells.

---

## 5. RAG Quality Enhancement

Targeted improvements (best quality/cost ratio)
- 1) Re-chunk and de-noise `drupal_core_docs` ingestion: strip common PHPDoc boilerplate like `{@inheritdoc}` and empty method stubs before embedding. Implement a small heuristic in the ETL (e.g., in [`etl/parse-php-manual.ts`](etl/parse-php-manual.ts:1)) that removes or collapses blocks with >80% annotation without substantive prose.

- 2) Use a hybrid embedding strategy:
  - Re-embed code-heavy tables (`contrib_module_code`, `contrib_module_docs`) with a code-aware embedding model (code-specialized) to improve retrieval of function/class examples.
  - Keep general docs in the cheaper text embedding (`text-embedding-3-small`) if budget-critical, but consider `text-embedding-3-large` or a higher-capacity text embedding for `api_drupal_org_docs` and `drupal_developer_guides` if accuracy is still poor.

- 3) Add light-weight reranking:
  - After LanceDB vector retrieval, run a cheap cross-encoder or a prompt-based re-ranking step using the synthesis model to rerank top-12 candidates to top-5. This reduces reliance on raw vector similarity for noisy tables.

- 4) Metadata-aware filtering:
  - Favor chunks where `file_path` or `symbol_name` is non-empty for code results.
  - For `drupal_core_docs`, drop chunks shorter than X characters or with markers of boilerplate.

- 5) Source weighting and distance cutoffs (already present but expand):
  - Increase weight/top-K for `api_drupal_org_docs` when `isEntityQuery(query)` true.
  - Maintain the `PHP_DOCS_MAX_DISTANCE` cutoff, and add similar dataset-specific thresholds for other noisy tables.

---

## Prioritized implementation roadmap

Stage 0 — Prep (small, low-risk)
- 0.1 Add `loadSkills()` and `skillMap` loader; list available skills and log at startup. Files: [`src/tools/ask-drupal-expert.ts`](src/tools/ask-drupal-expert.ts:1).

Stage 1 — Skill detection and injection (high impact)
- 1.1 Implement [`detectSkillDomain(query)`](src/tools/ask-drupal-expert.ts:1) with a keyword map using terms from each `SKILL.md`.
- 1.2 Modify `handleAskDrupalExpert` to: compute skill = `detectSkillDomain`, fetch trimmed SKILL.md text, and prepend to `SYSTEM_PROMPT` when present (compose as described in Section 2).
- 1.3 Add soft-intent fallback using skill-embeddings only if keyword matcher returns null.

Stage 2 — drupal_skill_guide tool + registration
- 2.1 Add [`src/tools/drupal-skill-guide.ts`](src/tools/drupal-skill-guide.ts:1) implementing the tool signature above.
- 2.2 Register tool in [`src/index.ts`](src/index.ts:1) next to `registerAskDrupalExpert`.

Stage 3 — RAG tuning and ETL fixes
- 3.1 Add simple PHPDoc de-noising in ETL (`etl/parse-php-manual.ts` and `etl/parse-core.ts`).
- 3.2 Re-embed `contrib_module_code` with a code-specialized embedding model; store model metadata in LanceDB to track embedding model provenance.
- 3.3 Implement reranker pipeline in [`src/tools/ask-drupal-expert.ts`](src/tools/ask-drupal-expert.ts:1): re-rank top-12 candidates before final slicing.

Stage 4 — Validation runner (opt-in)
- 4.1 Expose script metadata via `drupal_skill_guide` (validation_command).
- 4.2 Implement `drupal_validation_runner` behind a feature-flag with strict whitelist and DDEV-aware wrapper.

Stage 5 — Observability and feedback
- 5.1 Log which layer(s) were injected per query (skill, general-rules, RAG). Add metrics counters.
- 5.2 Add tests in `tests/` to assert SKILL.md injection for representative queries (see `tests/query-assessment-v4.ts`).

---

## Tradeoffs and risks

- Injection increases prompt length. Mitigation: only inject top skill (trimmed), and use embedding-confidence threshold for fallback. Measure average token usage and monitor costs.
- Executing validation scripts from MCP is high-risk. Mitigation: phase the feature, require operator opt-in, and run inside ephemeral, sandboxed environments.
- Re-embedding with higher-capacity models raises cost. Apply hybrid strategy: use code-specialized embeddings only for code tables and cheap text embeddings elsewhere.
- Reranking adds latency. Mitigation: apply only to queries with ambiguous top-8 retrieval distances or when the result set contains mixed dataset types.

---

## Testing checklist (deliverable tests)

- Unit tests for [`detectSkillDomain(query)`](src/tools/ask-drupal-expert.ts:1) with positive and negative cases.
- Integration test: query that triggers `views` skill should yield system prompt that includes content from [`data/sources/drupal-best-practices/ai/skills/views/SKILL.md`](data/sources/drupal-best-practices/ai/skills/views/SKILL.md:1) and `general-rules.md` when appropriate.
- End-to-end: sample site-building question should produce answer that cites RAG sources and adheres to SKILL guardrails (check for phrases from Guardrails in response).

---

## Implementation snippets (pseudo)

- Skill loader (pseudocode to add to [`src/tools/ask-drupal-expert.ts`](src/tools/ask-drupal-expert.ts:1)):
```
const skillMap = loadSkills(path.join(process.cwd(),'data','sources','drupal-best-practices','ai','skills'));

function detectSkillDomain(query) {
  // rule-based keyword map
  // fallback: compare embed(query) to skillEmbeddings
}
```

---

## Appendices

- Skills index: [`data/sources/drupal-best-practices/ai/SKILLS-INDEX.md`](data/sources/drupal-best-practices/ai/SKILLS-INDEX.md:1)
- Example skill file: [`data/sources/drupal-best-practices/ai/skills/views/SKILL.md`](data/sources/drupal-best-practices/ai/skills/views/SKILL.md:1)
- Existing server entrypoint: [`src/index.ts`](src/index.ts:1)

---

Prepared by: Roo (architect) — plan to implement in staged fashion; ready for review.

