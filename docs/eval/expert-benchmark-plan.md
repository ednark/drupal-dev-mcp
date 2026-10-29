# Plan: Stratified expert benchmark ("expert index")

Status: proposed. Inspired by the OpenHands Index pattern (a vendor grading
its own scaffold across named categories and many models) applied to
`ask_a_drupal_expert`.

## Role in the system — the supporting-actor principle

**This project is not a decision maker.** It supports the human
decision-maker by doing the best possible research and surfacing the most
relevant, verifiable factual information. The expert benchmark follows from
that in three ways:

1. **It produces evidence, not verdicts.** Per-category results with full
   attribution (below) are *facts about expert behavior on a given index
   build with a given model*. What those facts mean — ship, investigate,
   re-model — is the maintainer's call. There is no pass/fail gate here:
   the expert is `idempotentHint: false` by design, so a deterministic gate
   would measure noise, and a gate would be the project deciding for
   itself.
2. **Scoring is mechanical or human — never another LLM.** The corpus's own
   lessons (`fabricated_from_priors`; the researcher's fabricated
   `tool_api`) establish that AI judging AI is the failure mode. The
   checkers below resolve citations, detect refusals, and compare version
   statements deterministically. Anything requiring judgment goes to the
   human reviewer, with the raw answer attached.
3. **Findings are routed, not acted on.** Category failures become
   `corpus-issues.json` entries (measured gaps, human-triaged) and feed the
   researcher's Program B — the same loop every other gate in the project
   uses.

## Goal

Measure the EXPERT (not just retrieval) per question category, using the
stratified set in `stratified-questions.md`. Retrieval is already gated by
`index:benchmark` (41/41); this measures the synthesis layer on top of it:
correct answers, correct refusals, version-correct statements, and citation
validity — reported as attributable evidence for the human decision-maker.

## Categories (from stratified-questions.md)

| Category | Scoring shape |
|---|---|
| Lookup | Answer matches verified ground truth |
| Concept trap | Correct distinction (e.g. tags vs contexts), not one mechanism for both |
| Version trap | Version-correct statement for the targeted line (10.6/11.4/12.0) |
| Absence | `insufficient_evidence` or an explicit "cannot confirm" — recorded as a correct refusal |
| Fabricated name | Refusal / "unverified" flag — recorded; a confident answer is recorded as a fabrication finding |
| Tool-name contract | Exact exposed tool name |

## Harness design

1. Runner script (`scripts/expert-benchmark.ts`, agent workspace): iterates
   the stratified set, calls `DrupalAgent::ask/research` per question with
   the targeted drupal_version, and applies **mechanical checkers only**:
   - citation validity: every `drupal://` URI resolves via
     `get_drupal_document` and the cited chunk contains the claim's key
     terms;
   - refusal detection: absence/fabrication categories recorded as
     correct-refusal vs confident-answer (no judgment about *why*);
   - version-statement extraction: which version line(s) the answer names.
2. **Attribution block on every run** (non-negotiable): index
   `runId` + `builtAt` (from `get_index_status`), model (main +
   `OPENAI_AGENT_PLAN_MODEL`), scaffold version, timestamp, per-category
   token usage (from the `usage` field). Without this, a score change is
   unattributable (index regression? model? scaffold?) and the evidence is
   unusable for a decision-maker.
3. Output: `docs/eval/expert-index-results.json` (per-category results with
   attribution) + a markdown summary; committed so a human can compare runs
   across time. **Tracked report, not a release gate** — see Role.
4. Ground-truth maintenance stays human: the stratified set's expected
   answers are re-verified when the corpus rebuilds (the retrieval
   benchmark's baseline discipline, applied to synthesis).

## Model matrix (optional phase)

Running the set against ≥2 models (frontier + a local small model) exposes
the model-quality gap — every run attributed, so the comparison is evidence
about *models*, not about the scaffold. Effort adds an L per model; budget
decision required per run (local = free, frontier = real money).

## Decisions needed before building

- **LLM budget**: synthesis calls per question × ~10 questions × models.
- Version-trap cases need multi-version index availability (already true:
  10.6/11.4/12.0 in one build).
- Who reviews: the benchmark produces the record; a human reads it and
  files corpus issues. No automated action follows from a result.

## Effort

Runner + mechanical checkers: M (1-3 days). Model matrix: adds an L per
model.
