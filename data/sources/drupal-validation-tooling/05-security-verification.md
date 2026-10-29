# Security verification: advisories, updates, and the remediation loop

Intent: the deterministic tools that answer "is anything installed here vulnerable right now", how to act on their findings, and what the knowledge index can and cannot contribute.

Source: https://www.drupal.org/security

## The division of labor

Exposure is a property of an *installed* dependency graph, so detection belongs to site-state tools — not to this index, which carries no site and never runs tools:

| Tool | Answers | Mechanism |
|---|---|---|
| `composer audit` (Composer 2.4+) | Are installed packages on advisory lists? | Packagist security-advisories API |
| `drush pm:security` | Which projects have pending security releases? | drupal.org release history |
| `audit_updates` submodule (audit module) | Scored update status + Update-module health | Drupal Update module data |
| `audit_security` submodule (audit module) | Insecure patterns in *custom* code + security config | Static rules (`rules/static_security_rules.yml`) |

`composer audit` and `drush pm:security` are the true on-demand path: run them whenever wanted, at any cadence, without touching this index. Their findings list *what* is vulnerable; the advisory text explains *why* and *what to do*.

## What the index contributes

This index carries **Drupal core security advisories** (source `security_advisories`, fetched from drupal.org/security; revision-aware — a revised advisory replaces its corpus copy). That grounds the remediation half of the loop:

1. A tool above flags a vulnerable core version.
2. Retrieve the advisory (`search_drupal` for the SA ID, e.g. `SA-CORE-2026-014`) for: the vulnerability class, affected versions, the fix version, mitigations, and workaround notes.
3. Reason about exposure: is the vulnerable code path even used by this site? (Site-state judgment; the advisory supplies the affected-path facts.)
4. Decide upgrade vs. patch, grounded in the change-placement guidance (`08-contrib-patch-vs-custom-code.md`).
5. Verify the fix: the advisory names the fixed version; the change-records corpus often carries the accompanying API change.

For findings with no indexed advisory, say so (`insufficient_evidence`) — never synthesize vulnerability details from priors. Advisory freshness is capped at fetch + rebuild cadence: check `get_index_status` / `drupal://index/status` (`builtAt`, and the `security_advisories` source freshness) before treating the absence of an advisory as evidence of safety.

## Cadence and limits

- The advisory fetcher is cron-driven on the maintainer side (`npm run index:fetch-advisories`; hourly default cadence, more around scheduled core release windows). See `docs/plans/active/security-advisory-sidecar.md` for the deferred sub-rebuild design.
- Contrib advisories are deliberately out of scope in this index (volume, per-project relevance). For contrib exposure, `composer audit` / `drush pm:security` are authoritative and on-demand.
- **PHP runtime advisories are also out of scope**: this corpus is Drupal-core advisories only. PHP runtime vulnerabilities land upstream (php.net releases); their Drupal relevance is the runtime floor/support matrix (see placement guidance `16-php-runtime-floors.md`). An empty SA result must never be read as "the PHP runtime is safe".
- An advisory corpus is evidence, not a scanner: it cannot tell you what *this* site has installed. Never skip the site-state tools because the corpus "looks current".
