---
status: in-progress
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-31
depends_on: []
supersedes: []
related_artifacts:
  - etl/parse-tutorials.ts
  - etl/verify-tutorials.ts
  - src/lib/retrieval.ts
  - src/tools/search-drupal-docs.ts
  - src/tools/ask-drupal-expert.ts
  - src/lib/deep-research.ts
  - src/tools/deep-research-drupal.ts
---

# Tutorials and Examples Integration Plan

## Goal
Treat tutorials and examples as shared retrieval assets that improve raw evidence lookup, human explanations, and deep research planning across the full tool set.

## Current Status
- [x] Tutorial dataset slot exists in shared retrieval ordering via [`src/lib/retrieval.ts`](src/lib/retrieval.ts:146)
- [x] [`ask_drupal_expert`](src/tools/ask-drupal-expert.ts:279) already formats tutorial hits distinctly when they are retrieved
- [ ] Tutorial parsing and verification quality still need hardening
- [ ] Metadata quality for filtering and ranking still needs validation
- [ ] Cross-tool retrieval value has not been benchmarked systematically

## Retrieval Role
- [`search_drupal_docs`](src/tools/search-drupal-docs.ts:43) should expose tutorial/example chunks as raw evidence when relevant
- [`ask_drupal_expert`](src/tools/ask-drupal-expert.ts:218) should use them as illustrative teaching context
- [`runDeepResearch()`](src/lib/deep-research.ts:154) and [`deep_research_drupal`](src/tools/deep-research-drupal.ts:56) should use them as implementation examples and comparative evidence

## Remaining Actions
1. Validate the outputs of [`etl/parse-tutorials.ts`](etl/parse-tutorials.ts:1) and [`etl/verify-tutorials.ts`](etl/verify-tutorials.ts:1) against real example-heavy sources
2. Confirm the metadata schema consistently captures `module`, `topic`, `complexity`, and code-snippet presence
3. Tune retrieval behaviour so tutorial/example chunks appear for example-seeking queries without overwhelming primary API and handbook evidence
4. Add benchmark questions that verify tutorial/example usefulness in all three tool surfaces
5. Keep any new filtering generic enough to live in shared retrieval or shared metadata conventions where possible

## Preferred Sources
- Drupal.org project documentation and example pages
- Maintainer documentation with implementation walkthroughs
- Repository example directories and README usage sections
- Community tutorial material only when attribution and quality are clear

## Exit Criteria
- Tutorial/example chunks are validated, deduplicated, and consistently attributed
- Example-oriented questions surface helpful evidence in raw search, synthesized answers, and deep research dossiers
- Metadata is good enough for ranking and future filtering without creating tool-specific coupling

## Key Decisions
- Tutorials/examples are corpus assets first, presentation features second
- Shared retrieval remains the integration point; tool files should only decide how retrieved tutorial hits are presented
- Tutorial/example evidence should complement, not displace, core API and handbook sources
