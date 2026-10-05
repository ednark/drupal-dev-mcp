# Design-doc drafting recipe (Lynch: cost of getting it wrong)

`drupal-dev-mcp:ask_a_drupal_expert` with `depth: "research"` already emits a
design-doc-shaped report (Objective, Goals/non-goals, Findings, Alternatives,
Open issues, Version notes, Recommended steps). Use this recipe when your
agent loop drafts the doc itself instead of delegating.

Spend evidence budget on hard-to-reverse choices, not trivia.

## Section → tool flow

| Lynch section | Tool flow | Notes |
|---|---|---|
| Objective (1 sentence) | None — write from the user request | Plain language any stakeholder understands. |
| Background, Related docs | `search_drupal` (broad) + `get_drupal_document` | Self-contained first page; link prior docs by `drupal://` URI. |
| Goals / Non-goals | `search_drupal` with `source_types: ["guidance"]` for placement norms | Frame as impact ("reduce deploy outages"), never implementation ("add Kubernetes"). State out-of-scope explicitly. |
| Findings / Interfaces | `get_drupal_entity` / `get_drupal_entities` + `get_drupal_document` | Quote exact signatures, service IDs, config keys; cite chunk URIs. |
| Diagram | `explore_drupal_relationships` → fenced `mermaid` flowchart | Only nodes/edges the traversal returned; omit when thin, never invent identifiers. |
| Alternatives considered | `search_drupal` follow-ups per rejected option | A few brief lines + why rejected, not exhaustive. |
| Open issues | Gap between question and admitted evidence | Format: problem / options seen / immediate next step. |
| Version notes | `search_drupal` per version + `explore_...` `changed_by` / `deprecated_by` | Defer to `get_index_status` `builtAt` for freshness. |

## Grounding rules

Do not invent what the index cannot ground: SLOs, monitoring/alerting,
timelines, logging volumes, privacy/legal/security posture. When the design
needs them, file under Open issues as "requires project input" — the same
`None identified` convention the expert uses for Alternatives, Open issues,
and Version notes.

## Triage rule

- **Hard-to-reverse** (custom module vs theme vs config vs `settings.php` vs
  contrib patch; storage/API/language): full evidence + alternatives +
  trade-offs.
- **Easy-to-reverse** (label text, CSS tweak, list limit): one line, no
  argument.
