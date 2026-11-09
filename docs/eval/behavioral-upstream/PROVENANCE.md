# Behavioral eval cases — vendored from `ai_best_practices`

Provenance:

- Upstream: https://git.drupalcode.org/project/ai_best_practices (`evals/` directory)
- Vendored at upstream commit: `4cdb347b3359f31a228df3e2e4db7cc4e7178122` (2026-11-04)
- Vendored on: 2026-11-09 (plan: plans/active/ai-best-practices-corpus.md, Phase 3)
- Content: **verbatim copies** of `dataset.yaml` (cases) and `rubrics.yaml`
  (checks) per bundle — no transformations. 12 datasets, ~50 behavioral cases.
- License: GPL-2.0-or-later (drupal.org git), same as this repository.

What these are: agent-behavioral cases — a task prompt (`input`), the expected
shape of a correct response (`criteria`), machine-checkable expectations
(`metadata.expectations`), and per-case rubric checks (`must_contain_any`,
`must_not_contain`, `php_lint`). They were designed upstream to score GENERATED
CODE; here they score whether **our index + agent produce advice that would
lead code to pass those checks** — a retrieval-and-grounding quality measure.

Adaptation rules (documented in scripts/behavioral-eval.ts):

- `must_contain_any` → applied to retrieved evidence (retrieval mode) and to
  the agent's answer (agent mode).
- `must_not_contain` → **advisory only**: designed for code, but a grounded
  answer may legitimately quote the anti-pattern to warn against it (our
  anti-pattern corpus does exactly that). Reported separately, never gating.
- `php_lint` → not applicable (no code artifact produced); recorded as skipped.
- Upstream `static-checks.json` (assertions on the skill files themselves) are
  redundant here: the skills are version-controlled corpus content.

Refresh: re-vendor by re-running the rsync from a fresh clone of
`ai_best_practices` at a recorded commit; update the provenance block above.
