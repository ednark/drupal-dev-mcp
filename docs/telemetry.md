# Query telemetry

Local, opt-out logging of every MCP tool call this server serves, added
2026-11-09 (maintainer decision, follow-up to the pessimistic review of that
day's research run).

## Why

The project's synthetic evals (`docs/eval/`) answer "does the index answer our
curated questions well?" — they cannot answer "what are agents *actually*
asking, and where does grounding actually fail?". The 2026-11-09 review found
that four consecutive research runs recommended retrieval work with zero
observed failures behind it. This log is the failure evidence source: corpus
work, index changes, and new eval cases should cite rows from it, not
generic-RAG articles.

## Mechanics

- **File:** `data/telemetry/tool-calls.jsonl` — one JSON object per tool call,
  appended on completion. Rotated at ~10 MB to `tool-calls.jsonl.1`.
- **Opt-out:** `DRUPAL_DEV_MCP_TELEMETRY=off` in the server environment.
  Telemetry is on by default; it is local-only and never version-controlled
  (`.gitignore`), because real queries may contain client-proprietary content.
- **Never breaks a tool:** log writes are best-effort and silent on failure.
- **Session id:** one `randomUUID()` per server process, so calls can be
  grouped into agent sessions.

## Record shape

```json
{
  "ts": "2026-11-09T14:03:22.101Z",
  "sessionId": "…",
  "tool": "search_drupal",
  "durationMs": 41,
  "ok": true,
  "args": { "query": "hook_entity_presave", "drupal_version": "11.4" },
  "outcome": {
    "status": "ok", "resultCount": 8, "topScore": 0.83,
    "topHits": [{ "id": "ent_…", "title": "…", "score": 0.83 }],
    "insufficientEvidence": false, "citationCount": 4, "groundingDensity": 0.72
  }
}
```

Mechanical outcome signals only. Whether grounding *sufficed* is a human
judgment made later from the log — never inferred at write time. For
`ask_a_drupal_expert`, the answer prose is kept (truncated to 4,000 chars) for
error analysis.

## Reviewing the log

```sh
npx tsx scripts/telemetry-summary.ts            # markdown report
npx tsx scripts/telemetry-summary.ts --days=7     # last week only
npx tsx scripts/telemetry-summary.ts --json     # machine-readable
```

The summary surfaces two lists:

1. **Failure candidates** — zero/weak search results, degraded mode,
   not-found entities/documents, module-name misses, insufficient-evidence
   refusals, zero-citation or low-grounding answers, handler errors. These are
   *candidates*: replay the query and read the record before judging.
2. **Repeated queries** — asked ≥2 times. Anything repeated deserves a stable
   answer; if it also failed once, it deserves a benchmark case in
   `scripts/expert-benchmark.ts`.

## Correction log (Capture loop, adopted from ai_best_practices Phase 4)

The failure-analysis workflow now has a formal capture step, using the
six-way failure taxonomy from `ai_best_practices/drupal-expert-corrections`
(adapted remediation targets in `scripts/correction-taxonomy.ts`):

1. **Capture** — after hand-confirming a failure candidate:
   ```sh
   npm run correction:log -- --subsystem=caching --class=SKILL_GAP \
     --claimed="Cache tags invalidate synchronously" \
     --corrected="Two-phase: checksum immediate, eviction lazy on next read" \
     --reasoning="Assumed invalidation = deletion" \
     [--seed-prompt="..." --seed-contains=a,b --seed-not-contains=x]
   ```
   Appends to `data/telemetry/corrections.jsonl` (append-only, gitignored).
2. **Classify** — `telemetry-summary` suggests a class per failure candidate
   (`SKILL_GAP` / `SKILL_STALE` / `EVAL_GAP` / `HOOK_CANDIDATE` /
   `CONFABULATION` / `ASSUMPTION_ERROR`); the human confirms.
3. **Remediate** — each class prints its this-stack targets in priority order
   (corpus doc → eval case → mechanical checker → validator entry).
4. **Verify** — re-run the eval the correction seeded, `index:benchmark`, or
   `behavioral:eval`. Corrections carrying `eval_seed` are promotable directly
   into `docs/eval/behavioral-upstream`-format cases; telemetry-summary flags
   repeat subsystems as promotion candidates.

## Workflow (Hamel-style error analysis)

1. Run the summary weekly (or after heavy agent sessions).
2. Hand-review the top failure candidates until you stop learning something
   new from each one.
3. Codify what you learned: a corpus doc (placement/anti-patterns/concept
   bridges), an index or tooling change, or a new benchmark case.
4. Do **not** chase retrieval-mechanics changes (chunking, reranking, …)
   without a failure row motivating them — that was the 2026-11-09 review's
   core lesson.
