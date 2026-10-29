# Plan: Stratified expert benchmark ("expert index")

Status: proposed. Inspired by the OpenHands Index pattern (a vendor grading
its own scaffold across named categories and many models) applied to
`ask_a_drupal_expert`.

## Goal

Measure the EXPERT (not just retrieval) per question category, using the
stratified set in `stratified-questions.md`. Retrieval is already gated by
`index:benchmark` (41/41); this measures the synthesis layer on top of it:
correct answers, correct refusals, version-correct statements, and citation
validity.

## Categories (from stratified-questions.md)

| Category | Scoring shape |
|---|---|
| Lookup | Answer matches verified ground truth |
| Concept trap | Correct distinction (e.g. tags vs contexts), not one mechanism for both |
| Version trap | Version-correct statement for the targeted line (10.6/11.4/12.0) |
| Absence | `insufficient_evidence` or an explicit "cannot confirm" — scored as CORRECT refusal |
| Fabricated name | Refusal / "unverified" flag — never a confident answer |
| Tool-name contract | Exact exposed tool name |

## Harness design

1. Runner script (`scripts/expert-benchmark.ts`, agent workspace): iterates
   the stratified set, calls `DrupalAgent::ask/research` per question with
   the targeted drupal_version, and applies per-category checkers:
   - citation validity: every `drupal://` URI resolves via
     `get_drupal_document` and the cited chunk contains the claim's key terms
     (mechanical, no LLM);
   - refusal checkers: absence/fabrication categories pass iff
     `insufficientEvidence === true` or the answer flags unverified;
   - version checkers: the answer must name the correct version line.
2. Output: `docs/eval/expert-index-results.json` (per-category pass rates,
   grounding density, token usage from the new `usage` field) + a markdown
   summary; committed so regressions are visible across runs.
3. Model matrix (optional phase): run against ≥2 models (frontier + a local
   small model) to expose the model-quality gap the OpenHands data
   emphasizes — model choice moves the number more than the scaffold.

## Decisions needed before building

- **LLM budget**: synthesis calls per question × ~10 questions × models.
  Local (llama.cpp/Ollama) keeps cost at zero; frontier API costs real
  money per run. Decide per run.
- Ground truth maintenance: the stratified set's expected answers must be
  re-verified when the corpus rebuilds (the retrieval benchmark's baseline
  discipline, applied to synthesis).
- Version-trap cases need multi-version index availability (10.6/11.4/12.0
  in one build — already true).

## Effort

Runner + checkers: M (1-3 days). Model matrix: adds an L per model.
