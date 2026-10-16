# Concept-bridge guidance — how this corpus works

This corpus closes a specific retrieval failure measured in the
corpus-issues ledger (`concept-bridge-recent-era-systems`, and the 2026-10-16
B1 sweep): a caller describes a *capability in plain language* — "show a
status message", "the currently logged-in user", "a reusable front-end
component with template, CSS and JS in one directory", "ship default
configuration and content as one unit" — and lexical retrieval cannot reach
the Drupal system that implements it, because the question never contains
the system's name.

Each document therefore deliberately contains BOTH halves of the bridge:

- the plain-language descriptions a caller actually uses (the trigger
  phrases), and
- the Drupal system name, API entry points, and current-era mechanics.

## Status of these documents

Each document is a synthesis of official Drupal documentation indexed
elsewhere in this knowledge base. The "Citations" section names the primary
sources. Verify any specific API claim against the cited primary source via
its `drupal://` resource URI before relying on exact method names.

## How to read a bridge entry

- **The question callers ask** — verbatim plain-language shapes.
- **The Drupal system** — the canonical name and its API surface.
- **Decision rules** — when this system vs the neighboring ones.
- **Citations** — primary sources in this index.
