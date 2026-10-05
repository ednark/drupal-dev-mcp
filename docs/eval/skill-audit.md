# Skill-corpus quality audit (indexed drupal-skills family)

First audit: 2026-10-05, against the skill-authoring best-practices rubric
(platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).
The corpus is search-served evidence — a bloated, vague, or time-stale skill
document pollutes retrieval. Re-run with `npm run index:audit-skills`
(report: untracked `data/cache/skill-audit/report.json`).

## Results: 105 indexed skill documents, 59 flagged (56%)

| Check | Flagged | Severity |
|---|---|---|
| frontmatter-description (SKILL.md) | **0** | ✅ every SKILL.md carries a specific description |
| reference-toc (refs >100 lines, no contents header) | **59/59** | **upstream-owned, ~zero impact on this index** — we chunk at ingest and serve chunk-level text; the TOC matters only to agents reading the files whole in the skill repo itself |
| body-length (>500 lines) | 2 | consumer-boundary impact: `get_drupal_document` on the 1229L patch-workflow guide returns ~8.4k tokens. Mitigated 2026-10-05: `get_drupal_document` now returns `textLength` so agents switch to chunk-level fetches (skill + tools-spec teach the pattern) |
| vague-naming | 0 | ✅ retracted — initial flag was a checker false positive ("Data" inside "Data Integrity Failures Standards", the legitimate OWASP A08 title); checker now only flags titles whose *distinguishing* content is a generic word |
| time-sensitive | 0 | ✅ no "before/after year" rot detected |

## Interpretation

- The upstream drupal-skills repo recently reorganized to progressive-disclosure structure (SKILL.md + references) — that migration succeeded for descriptions but left the reference files without contents headers. This is upstream drift, not our bug.
- **Retrieval impact is contained**: the flagged files are long-tail reference docs; the SKILL.md files (the ones with intent and guardrails) are all clean. No remediation is required for search quality today.
- The two oversized files are the only ones where chunking (not structure) is doing all the work; 1229L of patch-workflow text is fine as evidence chunks but won't route cleanly as a "skill".

## Recommended actions

- [x] Retract the vague-naming finding (checker false positive) — fixed 2026-10-05.
- [x] Oversized-document consumer impact — mitigated 2026-10-05 via `textLength` on `get_drupal_document` plus chunk-level-fetch guidance in the companion skill and tools-spec. Ingest-time section splitting was considered and rejected for now: it would drag freshness-fingerprint mirroring along with it (the same class of bug fixed in the dedupe incident) and is disproportionate for two documents.
- [ ] Optional upstream contribution: add contents headers to the long reference files in the drupal-skills repo (mechanical, scriptable — benefits the skill repo's own users; ~zero effect on this index).
- [ ] Re-run this audit after each `index:fetch` of the skills family to catch regressions early.
- [ ] Extend checks if corpus sources change (e.g. if we ingest more skill-style repos, the same rubric applies — the script reads `source_type = 'skill'`).
