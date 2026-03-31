---
status: archived
phase: completed
completed_at: 2026-03-31
last_reviewed_at: 2026-03-31
depends_on: []
supersedes: []
related_artifacts:
  - src/lib/retrieval.ts
  - src/tools/search-drupal-docs.ts
  - src/tools/ask-drupal-expert.ts
  - src/lib/deep-research.ts
  - src/tools/deep-research-drupal.ts
archived_reason: "core recommendation implemented and replaced by narrower active plans"
---

# New search tools plan for Drupal Dev MCP (Archived)

## Summary
This plan defined the split between shared retrieval, raw search, human-facing explanation, and deep research planning.
Its primary architectural recommendations are now implemented in [`src/lib/retrieval.ts`](src/lib/retrieval.ts:174), [`src/tools/search-drupal-docs.ts`](src/tools/search-drupal-docs.ts:43), [`src/tools/ask-drupal-expert.ts`](src/tools/ask-drupal-expert.ts:180), [`src/lib/deep-research.ts`](src/lib/deep-research.ts:154), and [`src/tools/deep-research-drupal.ts`](src/tools/deep-research-drupal.ts:56).

## Outcome
- Shipped:
  - Shared retrieval layer centralised in [`src/lib/retrieval.ts`](src/lib/retrieval.ts:174)
  - Raw retrieval tool exposed through [`search_drupal_docs`](src/tools/search-drupal-docs.ts:43)
  - Human-facing synthesis retained in [`ask_drupal_expert`](src/tools/ask-drupal-expert.ts:180)
  - Iterative planning flow implemented in [`runDeepResearch()`](src/lib/deep-research.ts:154) and [`deep_research_drupal`](src/tools/deep-research-drupal.ts:56)
- Not shipped:
  - None from the top-level architecture recommendation; remaining work now lives in narrower active plans

## Key Decisions
- Keep retrieval policy shared and reusable, rather than duplicating dataset logic inside each tool
- Preserve a strict product split: raw evidence for agents, synthesis for humans, planning dossiers for advisory research
- Treat tool-specific formatting as a thin layer above the shared retrieval contract

## References
- Active roadmap: [`plans/active/roadmap-phased-milestones.md`](plans/active/roadmap-phased-milestones.md)
- Remaining skill work: [`plans/active/skill-rag-integration-plan.md`](plans/active/skill-rag-integration-plan.md)
- Remaining tutorials/examples work: [`plans/active/tutorials-and-examples-implementation-plan.md`](plans/active/tutorials-and-examples-implementation-plan.md)

## Lessons Learned
- Broad specification plans should be archived once their architectural split is implemented, even if downstream tuning work remains
- Remaining work is easier to track when separated into source-quality, prompt-quality, and retrieval-asset plans
