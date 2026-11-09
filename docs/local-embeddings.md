# Local embeddings (offline hybrid search)

Status: **adapter implemented, NOT the default.** The serving index remains
lexical-only (FTS5 BM25). This module is the fully-offline path to hybrid
retrieval, built so it can be evaluated side-by-side and adopted later with a
flag flip — no online API involved at any point.

## What exists

| Piece | Where | Notes |
|---|---|---|
| Embedder adapter | `packages/knowledge/src/index/local-embed.ts` | In-process transformers.js (`@huggingface/transformers`, optionalDependency). Lazy: default paths never import it; a base install works without it. |
| Presets | same file | `bge-small-en-v1.5` (default, 384d, MIT, query-only retrieval prefix) and `nomic-embed-text-v1.5` (768d, Apache-2.0, `search_query:`/`search_document:` prefixes). Ad-hoc HF ids pass through prefix-less. |
| Query hook | `SqliteKnowledgeProvider.open({ queryEmbedder })` | Existing pluggable hook — the adapter's `embedQuery` drops straight in. |
| Build hook | `buildIndex({ embed, embeddingModel, withEmbeddings })` | `embeddingModel` overrides the recorded model name (e.g. `transformers:bge-small-en-v1.5`). |
| Calibration | automatic | Any build with vectors self-calibrates into its own manifest (see docs/score-calibration.md) — the comparison build measures anchors for ITS model, the serving build is untouched. |
| Side-by-side | `npx tsx scripts/embed-compare.ts` | Builds a comparison index under `data/index-compare/<model>/` (separate indexRoot — activation is per-root, so the serving `active.json` can't be affected) and benchmarks: active-lexical vs compare-lexical vs compare-hybrid, plus calibration anchors and query latency. JSON per-case report next to the build. |

## Measured verdict (2026-11-09, full corpus, bge-small-en-v1.5 q8)

Full run: 101,379 vectors embedded in ~59 min (one-time, Apple Silicon CPU);
hybrid query latency ~162ms avg; comparison build 1.1 GB on disk.

| Run | Pass | MRR | Chrome |
|---|---|---|---|
| active · lexical (serving) | **41/41** | 0.907 | 0 |
| compare · lexical (sanity check) | 41/41 | 0.907 | 0 |
| compare · hybrid (bge-small + BM25) | **38/41** | 0.933 | 1 |

**Verdict: lexical-only serving STAYS.** Hybrid fails the pre-registered
adoption gate (3 regressions incl. two rank-1→fail drops on
identifier/keyword cases: services.yml DI, theme regions .info.yml, Twig
|raw anti-pattern), even though MRR is higher and 6 concept-style queries
improved to rank 1 (SDC, config schema, cache-bin). Failure shape: the
semantic path pulls plausible-but-wrong docs above lexically-perfect ones —
a fusion-weighting problem (Redis measured RRF beating weighted score-sum
fusion; our merge sums scores). The comparison harness did its job:
**measured, not adopted, with a named next experiment** (RRF fusion) parked
until telemetry shows paraphrase failures that outweigh the identifier risk.

**Calibration guard validated in production**: bge-small anchors measured at
excellent=0.35 / irrelevant=0.85 — wildly different from the legacy
text-embedding-3-small anchors (0.8 / 1.05). Applying the legacy constants to
this model would have scored nearly every semantic hit ~1.0 and swamped
lexical ranking. The manifest-carried calibration caught exactly the
silent-corruption scenario it was built for.

## Model choice rules (from the 2026-11-09 research pass)

1. **Context window beats parameter count.** The index chunks at ~500 tokens;
   `mxbai-embed-large` (512-token truncation) and `all-MiniLM-L6-v2` (256
   wordpieces) truncate exactly where this corpus lives — avoid both.
2. **Prefixes are part of the model contract.** nomic without
   `search_query:`/`search_document:` silently degrades; bge v1.5 wants the
   retrieval instruction on queries only. The presets encode this.
3. **Small models compress well on single-domain English corpora** — bge-small
   loses ~0.9 MTEB-Eng points to bge-base. Whether that gap matters HERE is
   exactly what `embed-compare.ts` measures; do not adopt on leaderboard
   numbers.

## Evaluation workflow (telemetry-gated, per the 2026-11-09 review)

1. Let query telemetry accumulate real traffic (`npm run telemetry:summary`).
2. If paraphrase-style failures appear (identifier queries rarely need
   semantic), run the comparison:

   ```sh
   npx tsx scripts/embed-compare.ts --version=11.4        # full corpus (~30–60 min CPU, one-time)
   npx tsx scripts/embed-compare.ts --model=nomic-embed-text-v1.5
   ```

3. Read the table: hybrid is only worth adopting if `compare · hybrid` beats
   `active · lexical` on pass/MRR **without regressing identifier-style cases**
   (per-case results are in `data/index-compare/<model>/compare-report.json`).
4. Adoption (later, if warranted): rebuild the SERVING index with
   `--with-embeddings` + the local embedder wired into the build entry point,
   then serve with `queryEmbedder` at startup. Both hooks already exist.

## Test coverage

- Unit: preset resolution, prefix contracts, laziness (no model load at
  creation), empty-batch short-circuit, prefix overrides — always run.
- Real-model integration (downloads ~35MB once, then cached and offline):
  ```sh
  RUN_LOCAL_EMBED_TESTS=1 npx tsx --test packages/knowledge/tests/local-embed.test.ts
  ```
  Verifies 384-dim normalized vectors and query/document prefix separation.
