# Deprecated and removed core modules — where the feature lives now

Intent: when a core module is deprecated or removed from the target line, the feature's placement answer changes ("is module X still in core?"). The per-line facts below come from the indexed core snapshots, not from memory.

Source: https://www.drupal.org/docs/core-modules-and-themes/deprecated-and-obsolete

## Verified per-line facts (from core snapshots, 2026-10-29)

| Module | 10.6.x | 11.4.x | 12.0.x | Placement answer |
|---|---|---|---|---|
| **Contact** | present | present, `lifecycle: deprecated` (info.yml) | **removed** | On 11.4: usable but deprecated — plan migration. On 12.0: install the contrib Contact module or replace the functionality; do not build against core contact. |
| **Forum** | present | **removed** | **removed** | On 10.6: legacy. On 11.4/12.0: install the contrib Forum module or restructure with core primitives (taxonomy + nodes + views). |

Verify against the target snapshot before asserting (`core/modules/<name>` presence, `lifecycle:` in the module's `.info.yml`) — the removal timeline advances per minor.

## Decision rules

1. **Deprecated (still present)**: existing sites keep working; new builds should not add dependencies on it. Check `lifecycle: deprecated` + `lifecycle_link` in the module's `.info.yml` for the removal plan.
2. **Removed**: the placement answer is "contrib module or restructure with supported primitives" — never "use the core module".
3. **Custom code touching a removed module**: hooks, services, and routes from that module are gone with it — this is a placement question *and* an anti-pattern signal (dangling `hook_form_contact_form_alter`-class code).
4. **Version-scoped answers only**: "is Contact in core?" is not one question — it is three, one per supported line. Agents must state the line before answering (see the version-scoping rule in the anti-patterns corpus).

## Related corpus entries

- Change records carry the deprecation/removal notices per line (full text indexed).
- The contrib-patch-vs-custom-code placement guidance covers the "install contrib vs rebuild" trade-off.
