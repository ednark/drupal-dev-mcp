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
| reference-toc (refs >100 lines, no contents header) | **59/59** | medium — hurts partial reads (agents `head` long files and miss scope) |
| body-length (>500 lines) | 2 | low — `Drupal Patches` (1229L), `Troubleshooting - Skill Activation` (515L) |
| vague-naming | 1 | low — "…Data Integrity Failures Standards" routes poorly |
| time-sensitive | 0 | ✅ no "before/after year" rot detected |

## Interpretation

- The upstream drupal-skills repo recently reorganized to progressive-disclosure structure (SKILL.md + references) — that migration succeeded for descriptions but left the reference files without contents headers. This is upstream drift, not our bug.
- **Retrieval impact is contained**: the flagged files are long-tail reference docs; the SKILL.md files (the ones with intent and guardrails) are all clean. No remediation is required for search quality today.
- The two oversized files are the only ones where chunking (not structure) is doing all the work; 1229L of patch-workflow text is fine as evidence chunks but won't route cleanly as a "skill".

## Recommended actions

- [ ] Optional upstream contribution: add contents headers to the 59 long reference files in the drupal-skills repo (mechanical, could be scripted).
- [ ] Re-run this audit after each `index:fetch` of the skills family to catch regressions early.
- [ ] Extend checks if corpus sources change (e.g. if we ingest more skill-style repos, the same rubric applies — the script reads `source_type = 'skill'`).
