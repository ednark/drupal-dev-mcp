---
status: in-progress
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-31
depends_on: []
supersedes: []
related_artifacts:
  - src/tools/ask-drupal-expert.ts
  - src/tools/drupal-skill-guide.ts
  - src/tools/search-drupal-docs.ts
  - src/lib/retrieval.ts
---

# Skill-aware RAG integration plan for Drupal MCP

## Goal
Finish the remaining skill-routing and prompt-quality work without changing the raw retrieval contract exposed by [`search_drupal_docs`](src/tools/search-drupal-docs.ts:43).

## Current Status
- [x] Skill files can be loaded at startup through [`loadSkills()`](src/tools/ask-drupal-expert.ts:37)
- [x] Deterministic keyword-based routing exists in [`detectSkillDomain()`](src/tools/ask-drupal-expert.ts:67)
- [x] Skill and general-rules prompt injection are wired into [`handleAskDrupalExpert()`](src/tools/ask-drupal-expert.ts:218)
- [x] [`drupal_skill_guide`](src/tools/drupal-skill-guide.ts:28) exposes raw, trimmed, and JSON skill output
- [ ] Detection quality is benchmarked and tuned
- [ ] Soft-intent fallback is evaluated and added only if needed
- [ ] Prompt assembly and logs are covered by targeted tests

## Guardrails
- Do not convert [`search_drupal_docs`](src/tools/search-drupal-docs.ts:43) into a synthesized or advisory tool
- Preserve the JSON-first raw evidence contract returned by [`handleSearchDrupalDocs()`](src/tools/search-drupal-docs.ts:92)
- Keep skill guidance as an augmentation for [`ask_drupal_expert`](src/tools/ask-drupal-expert.ts:180) and related prompt consumers, not as shared retrieval post-processing

## Remaining Actions
1. Validate current skill routing against representative questions for each domain and record false positives and misses
2. Tighten the keyword maps and site-building heuristics before adding any heavier fallback path
3. If deterministic routing is still insufficient, add a bounded soft-intent fallback after keyword failure only
4. Add tests that verify prompt composition order, no-skill behaviour, and structured error handling in [`drupal_skill_guide`](src/tools/drupal-skill-guide.ts:164)
5. Add lightweight observability for injected layers and prompt-size regression checks

## Completed Work Already Reflected in Code
- Startup loading and trimming of `SKILL.md` assets
- Prompt layering with skill guidance and general rules
- Dedicated skill guide tool for direct advisory lookup
- Separation between shared retrieval in [`src/lib/retrieval.ts`](src/lib/retrieval.ts:174) and human-facing synthesis in [`handleAskDrupalExpert()`](src/tools/ask-drupal-expert.ts:218)

## Exit Criteria
- Each supported skill domain has at least one passing benchmark query
- Prompt injection stays targeted and bounded
- No changes are required to the external contract of [`search_drupal_docs`](src/tools/search-drupal-docs.ts:43)

## Key Decisions
- Keep raw retrieval and skill-aware explanation as separate concerns
- Prefer deterministic routing first, then add a fallback only if benchmarks justify it
- Reuse [`drupal_skill_guide`](src/tools/drupal-skill-guide.ts:28) for advisory lookup instead of overloading retrieval tools
