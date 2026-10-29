# Validation tooling for Drupal code — overview

Intent: what each deterministic analysis tool catches on Drupal code, what it structurally cannot catch, and where each fits an agent fix loop. The counterpart corpus `drupal-anti-patterns` lists the failure modes; this one lists the detectors.

Source: https://www.drupal.org/docs/develop/creating-modules

## The detection layers

Green tests assert behavior the author already understood. Everything below catches classes of defects tests do not:

| Layer | Catches | Structurally misses |
|---|---|---|
| Runtime tests | Asserted behavior | Cache bubbling, escaping, staleness, unasserted behavior |
| [PHPStan](01-phpstan.md) (+ drupal extension, deprecation rules) | Deprecated/removed APIs, type errors, DI wiring, service-locator calls | Cache metadata semantics, semantic duplication, Twig escaping |
| [PHPCS](02-phpcs.md) (Coder: Drupal + DrupalPractice) | Coding standards, naming, some best-practice smells | Behavioral anything, complexity |
| [PHPMD / phploc / jscpd](03-phpmd-and-complexity.md) | Cyclomatic complexity, copy-paste duplication, dead code | Whether a split makes sense; semantic duplication |
| Audit module (`audit_*` submodules, JSON via Drush) | All above, site-integrated + Drupal-aware checks (Twig quality, cache bubbling, security config) | "Should this exist", architecture fit |
| Human review | Architecture, necessity, project conventions | Scale |

The audit module's developer submodules wrap these same tools: `audit_phpstan` (phpstan + `mglaman/phpstan-drupal` + `phpstan/phpstan-deprecation-rules`), `audit_phpcs` (phpcs + `drupal/coder`), `audit_complexity` (phploc), `audit_duplication` (jscpd) — each reads the project's own config (`phpstan.neon`, `phpcs.xml.dist`) and finds binaries via composer's `bin-dir`.

## Selecting by failure mode

Cross-reference to the anti-patterns corpus:

- Service locator inside classes → PHPStan (drupal extension), partially PHPCS.
- Deprecated/removed D7-D8-era APIs → PHPStan + deprecation rules; "still exists, wrong idiom" cases need grep/review.
- Complexity and duplication → PHPMD/phploc/jscpd; semantic duplication ("exists three modules over") is a review concern.
- Twig `|raw` → audit_twig (Drupal-aware); generic linters mostly miss it.
- Missing cache metadata → nothing generic; audit_cache / audit_twig plus review.
- Unbounded loops → complexity tools partially; review of submit/cron handlers.

## Per-tool pages

1. `01-phpstan.md` — PHPStan + mglaman/phpstan-drupal + deprecation rules.
2. `02-phpcs.md` — PHPCS with the Coder Drupal/DrupalPractice standards.
3. `03-phpmd-and-complexity.md` — PHPMD, phploc, jscpd, and the audit-module bridges.
4. `04-agent-fix-loop.md` — wiring the run → fix → re-run loop for coding agents.
