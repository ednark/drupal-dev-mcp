# Token budgeting for drupal-dev-mcp

Knobs that bound how much context each tool result consumes. Retrieved facts
persist in a growing prompt for the rest of a run — budget at the tool call,
not after it.

## Search payload bounds

| Knob | Range | Effect |
|---|---|---|
| `limit` | 1–25 (default 8) | Maximum results returned. 5–8 is usually enough for grounding. |
| `include_snippets` | default true | `false` returns metadata only — cheapest way to survey a topic before committing. |
| `snippet_max_chars` | 40–2000 | Cap each snippet; ~300 keeps evidence readable without bloat. |
| `min_score` | 0–1 (default 0.2) | Drop noise; raise to 0.5 when swamped, lower to widen when empty. |

## Batch resolution

`get_drupal_entities` resolves up to 25 IDs in one call — collapses
search→resolve-N from 2N+1 round-trips to 2. Relations are omitted unless
`include_relations: true`; keep them off in bulk, then follow up on the few
entities whose relationships matter.

## Typed results

Every tool declares an output schema. The compact JSON text fallback is
non-pretty-printed; prefer `structuredContent` when your loader supports
typed results. Host-actionable signals are mirrored under result `_meta`
keys `drupal-dev-mcp/status` and `drupal-dev-mcp/degraded-mode`.

## Synthesis budgets (ask_a_drupal_expert)

Hard budgets fixed in the implementation (`packages/agent/src/`):

| Budget | Value |
|---|---|
| Output cap per synthesis call | 2,000 tokens (override `AGENT_MAX_OUTPUT_TOKENS`) |
| Research query-planner output | 400 tokens, strict JSON |
| Evidence bundle, `depth: "ask"` | ≤ 8 hits × ≤ 800-char snippets ≈ 2–4k input tokens |
| Evidence bundle, `depth: "research"` | up to 24 admitted items ≈ 8–12k input tokens (budget adjustable 5–100) |

Model sizing: 8k context suffices for `ask`; ≥16k–32k for `research`.
Sub-7B models tend to produce mushy or uncited answers — verify their
citations with `get_drupal_document` mechanically.
