# Score calibration: semantic vs lexical scales

Status: **Option 1 (affine rescaling) implemented.** This file records the problem,
the measurement behind the current constants, and the alternatives we deliberately
deferred, so we can revisit with evidence.

> **⚠️ Rule (enforced in code since 2026-11-09, see [Manifest-carried calibration](#manifest-carried-calibration-2026-11-09)):**
> the semantic anchors are only valid for the embedding model they were measured
> with. **Any embedding-model change requires re-measuring the anchors for the new
> model** — either automatically at build time (the builder now does this) or via
> `npm run index:calibrate -- --write`. A build whose model has no calibration
> degrades to lexical-only mode instead of silently mis-ranking.

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
   anchors moved. **This is now automated — see the next section.**
2. `npm run index:benchmark` is the regression gate: if release-gate pass rate
   drops after a calibration change, the constants are wrong for the corpus.
3. If junk-in-context complaints recur with correct ranking (i.e., junk present
   but ranked low), the issue is the `min_score` default, not the scale — consider
   raising it or making it query-regime-aware (see the identifier-vs-conceptual
   query discussion in the conversation that produced this file).

## Manifest-carried calibration (2026-11-09)

The two constants above became a silent-corruption hazard the moment a second
embedding model became possible: cosine distances re-scale with the model, and
old anchors then mis-rank hybrid results with no error anywhere. The mechanism
now in place (`packages/knowledge/src/index/calibration.ts`):

1. **Calibration travels with the build.** Every build that creates vectors
   also measures its own anchors (12 probe queries: 8 on-topic, 4 unrelated
   controls, sampled top-8 against the build's own `vectors.lance`) and stores
   them in `manifest.json` as `semanticCalibration`. The provider resolves
   anchors per build at open() — a model swap automatically carries its own
   scale.
2. **No calibration → no semantic mode.** If a build's embedding model has no
   `semanticCalibration` in its manifest (and is not the one legacy
   hand-calibrated model below), the provider degrades hybrid/semantic queries
   to `lexical_only` rather than apply wrong anchors. A calibration/model
   mismatch in the manifest (edited post-hoc) is likewise refused.
3. **Legacy fallback.** Constants `0.8 / 1.05` in `provider.ts` remain valid
   ONLY for `text-embedding-3-small` (the hand-measured model). Builds from
   before this change keep working unchanged.
4. **Re-evaluation on demand.** After any corpus or embedding-model change:

   ```sh
   npm run index:calibrate              # dry run: current vs proposed anchors
   npm run index:calibrate -- --write   # persist into the build manifest
   ```

   The command embeds the probe queries with the build's OWN recorded model
   (that is the guard) and writes `semanticCalibration` back into the build
   and active manifests. Verified outcomes: `npm run index:benchmark`.
5. **Verification.** `get_index_status` (and `drupal://index/status`) surfaces
   `semanticCalibration` — which model the anchors belong to and when they
   were measured. If it is absent while `embeddingModel` is set and non-legacy,
   the index is serving lexical-only by design; run step 4.
