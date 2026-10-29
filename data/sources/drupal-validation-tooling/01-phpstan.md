# PHPStan with the Drupal extension and deprecation rules

Intent: static analysis that catches deprecated/removed Drupal APIs, type errors, and dependency-injection mistakes before runtime.

Source: https://github.com/mglaman/phpstan-drupal

## The stack

- `phpstan/phpstan` — the analyzer.
- `mglaman/phpstan-drupal` — Drupal awareness: knows the service map from `*.services.yml`, understands entity storage/interfaces, recognizes `\Drupal::` calls, resolves Drupal-specific autoload (see the extension's own `extension.neon` / `rules.neon` in this index, source `phpstan_drupal`).
- `phpstan/phpstan-deprecation-rules` — flags usage of classes/methods marked `@deprecated` (the "removed in 9.0/10.x/11.x" catalogue in anti-pattern `08-old-apis-and-d7-isms.md`).
- `phpstan/extension-installer` — auto-registers the above.

```bash
composer require --dev phpstan/phpstan phpstan/extension-installer \
  mglaman/phpstan-drupal phpstan/phpstan-deprecation-rules
vendor/bin/phpstan analyse --memory-limit=1G
```

Canonical config: `phpstan.neon` including the extension, a `drupalRoot` setting, and analysis of `web/modules/custom` (plus themes). The audit module's `audit_phpstan` submodule reuses the project's `phpstan.neon(.dist)` and `phpstan-baseline.neon` when present — a project-tuned config carries into the site-integrated run.

## What it catches

- Deprecated and removed APIs (deprecation rules): `db_query()`, `drupal_set_message()`, `drupal_get_path()`, removed procedural helpers.
- Type errors and wrong interface usage on injected services.
- With the Drupal extension: service-locator patterns in classes (when rules enabled), unknown services, entity API misuse.
- The baseline file (`phpstan-baseline.neon`) freezes known debt so new violations surface — useful in agent loops to prevent "fix by reverting" churn.

## What it structurally misses

- Cache metadata semantics (`#cache` correctness, bubbling) — no rule expresses them.
- Twig-level issues (`|raw`, escaping) — out of scope.
- Semantic duplication: it cannot know a function "already exists three modules over".
- Architectural overengineering — every piece type-checks.

## Version notes

- Verify the extension's supported Drupal/PHP matrix against its own README (source `phpstan_drupal` in this index) rather than memory; major Drupal lines have required extension majors.
- Deprecation coverage is only as good as core's `@deprecated` annotations — always present for removed APIs, sometimes late for deprecations.
- Baseline files: regenerate deliberately, never inside an automated fix loop without review (a regenerated baseline launders regressions).
