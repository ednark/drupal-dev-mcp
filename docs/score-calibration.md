# Score calibration: semantic vs lexical scales

Status: **Option 1 (affine rescaling) implemented.** This file records the problem,
the measurement behind the current constants, and the alternatives we deliberately
deferred, so we can revisit with evidence.

Last measured: 2026-08-25, corpus of ~20K docs / ~55K chunks, `text-embedding-3-small`,
index build `20260825235626881-3404a1`.

## The problem

Hybrid search merges two score families that are not on the same scale:

- **Lexical** (FTS5 bm25 × IDF-weighted token coverage) has an inflated top end for
  short documents. A 2KB link-listing chapter containing 4 of 5 query tokens
  saturates bm25 (term-frequency *fraction*) and scored ~0.77 for a vague query —
  while the semantically correct results scored lower.
- **Semantic** (cosine distance from LanceDB) is compressed. Real on-topic hits for
  benchmark-style queries cluster at distances 0.64–0.95; the naive `1 − d/2` mapping
  (theoretical range [0, 2] for cosine distance) put them at 0.51–0.55, reserving
  half the output scale for distances that never occur in practice.

Net effect before calibration: **junk lexical (0.77) outranked gold semantic (0.55)**
for conceptual queries — the agent's context filled with navigation-chapter noise.

The aggregation choice (max + saturating bonus, see `semanticDocumentScore` in
`packages/knowledge/src/query/provider.ts`) does not fix this; it bounds semantic
scores but cannot make the two families comparable.

## Measurement

Distances sampled by running 8 queries (on-topic, identifier-style, and unrelated
control queries) against the vector table, top-200 hits each:

| Slice | Distance range |
|---|---|
| Best hit, on-topic queries | 0.64 – 0.95 |
| Top-8 hits, on-topic queries | 0.77 – 1.03 |
| Best hit, *unrelated* queries | 1.03 – 1.05 |
| Deep tail (rank ~150–200) | 1.05 – 1.49 |

Key observation: the best hit for a completely unrelated query (~1.04) is the
empirical "irrelevance" anchor — nothing at or beyond it deserves a nonzero score.

## What was implemented (Option 1: affine rescaling)

Constants live in `packages/knowledge/src/query/provider.ts`:

- `SEMANTIC_DISTANCE_EXCELLENT = 0.8` — distances at or below this score 1.0
  (roughly the p10 of on-topic top-8 hits).
- `SEMANTIC_DISTANCE_IRRELEVANT = 1.05` — distances at or beyond this score 0
  (unrelated-query best-hit territory). Linear in between.
- Lexical scores are squared (`lexicalScore`): overlap of ~0.95 (identifier
  lookups) keeps ~0.90; partial-overlap pages (~0.77) drop to ~0.56.

Verified outcomes on the reference query "Drupal 11 implementation best practices":

| Result | Before | After |
|---|---|---|
| OWASP standards docs (gold, semantic) | 0.55 | **0.64** |
| "email"/"actions" chapters (junk, lexical) | 0.77 | 0.585 |

Identifier-style queries ("hook_entity_presave entity validation") now produce
hybrid corroborated scores of ~1.7 (lexical + semantic both firing), and the
default `min_score` floor of 0.2 retains them.

Known limitations:

- Constants are corpus- and embedding-model-specific. Re-measure after a corpus
  refresh or model change (the sampling script pattern is in git history / this doc).
- Affine maps are global, not per-query. A genuinely vague query ("best practices")
  has gold hits at 0.90+ distance that only reach ~0.58 — correct behavior (vague
  query ⇒ moderate confidence) but it means absolute scores still encode some
  query-difficulty signal, not pure relevance.

## Deferred alternatives

**Option 2 — per-query normalization.** Z-score or min-max each family's scores
across its own candidate set before merging. Self-adapting, no constants to
maintain. Downsides: unstable with few results (a single-hit candidate set
normalizes to 1.0), and `min_score` becomes query-relative rather than an
absolute relevance floor — harder to explain in a tool description.

**Option 3 — rank-based fusion (RRF).** Score = Σ 1/(k + rank) per retriever,
as Elasticsearch/Vespa hybrid search default to. Completely sidesteps scale
comparison. Downsides: discards magnitude information entirely (a rank-1
near-exact match and a rank-1 weak match count the same), and `min_score`
degenerates into a rank-depth knob. Worth revisiting only if score *magnitude*
proves unhelpful to consumers.

**Option 4 — logistic calibration on labeled data.** The benchmark suite in
`packages/knowledge/src/index/benchmark.ts` (~30 question → expected-substring
cases) is a ready-made labeled set. Run it, record per-hit features
(lexicalScore, semanticScore, coverage, authority), fit `P(relevant | features)`.
Scores become probabilities and `min_score = 0.3` is a principled threshold.
This is the statistically right answer if ranking quality ever regresses or the
tool description's score semantics need to be tightened. Cost: a fitting script
plus storing the fitted coefficients somewhere versioned.

## How to revisit

1. Re-run the distance sampling (queries above against the current vector table)
   after any corpus or embedding-model change; update the two constants if the
   anchors moved.
2. `npm run index:benchmark` is the regression gate: if release-gate pass rate
   drops after a calibration change, the constants are wrong for the corpus.
3. If junk-in-context complaints recur with correct ranking (i.e., junk present
   but ranked low), the issue is the `min_score` default, not the scale — consider
   raising it or making it query-regime-aware (see the identifier-vs-conceptual
   query discussion in the conversation that produced this file).
