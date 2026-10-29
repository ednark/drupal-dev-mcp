# AI-frequent Drupal anti-patterns — overview

Intent: the recurring legacy-pattern fallbacks that AI code generators produce in Drupal projects, why tests do not catch them, and where each is documented in this corpus.

Source: https://www.drupal.org/docs/develop/creating-modules

## Why this corpus exists

Code generators return the *most likely* solution, and for Drupal that answer is weighted toward fifteen years of Drupal 7/8-era material: service-locator calls, procedural `.module` monoliths, `|raw` in Twig, and render arrays without cache metadata. Nearly all of it runs green. Unit tests assert behavior the author already understood; they do not assert cacheability, escaping, dependency-inversion, or duplication. These documents pair each anti-pattern with the current pattern and how it is usually detected.

## The patterns

1. `01-service-locator-instead-of-di.md` — `\Drupal::service()` inside classes instead of injected dependencies.
2. `02-hook-implementations-in-module-file.md` — large procedural hooks in `.module`; OOP `#[Hook]` attributes (11.1+) and services as the thin-wrapper alternative.
3. `03-twig-raw-and-escaping.md` — `|raw` and friends that bypass auto-escaping.
4. `04-cache-metadata-in-render-arrays.md` — render arrays missing `#cache` contexts/tags/max-age; custom static caches instead of declared metadata.
5. `05-duplicated-existing-functionality.md` — reimplementing what core or an installed contrib module already provides.
6. `06-overengineering-and-unneeded-abstractions.md` — one task expanded into services, wrappers, config schemas, and admin pages.
7. `07-batch-and-queue-for-long-running-work.md` — unbounded loops in form submits and hook_cron instead of Batch/Queue API.
8. `08-old-apis-and-d7-isms.md` — removed D7-era APIs that survive in older snippets.

## How to use these in a fix loop

Deterministic analyzers (PHPStan, PHPCS, audit tooling) say *what* is wrong; the pages here say *what right looks like* in the indexed version, with version notes. Cross-check the current pattern against `change_records` and core snapshots for the target version before rewriting — deprecation timelines differ per line.
