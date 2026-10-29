# Hooks as procedural monoliths in the .module file

Intent: keeping real logic out of `.module` functions — thin hook wrappers, services underneath, and OOP `#[Hook]` attributes where available.

Source: https://www.drupal.org/node/3442349

## Why it keeps appearing

Procedural hooks in `<machine_name>.module` are the most-represented pattern in older material, so generators produce two-hundred-line `hook_form_alter()` / `hook_entity_presave()` bodies with inline business logic. It runs, and it resists unit testing, reuse, and static analysis.

## The anti-pattern

```php
// mymodule.module
function mymodule_form_alter(&$form, FormStateInterface $form_state, $form_id) {
  // 200 lines of queries, conditionals, and AJAX wiring.
}
```

## The current pattern

1. **Extract the logic to a service**; the hook becomes a two-line adapter calling it (see `01-service-locator-instead-of-di.md` for wiring).
2. **Prefer OOP hooks where the version supports them**: Drupal 11.1+ lets modules declare hook implementations as classes with `#[Hook('form_alter')]` attributes under `src/Hook/` — registered via the `Hook` attribute discovery, no `.module` function required. Constructor injection works there naturally.
3. **Reach for the most specific hook**: `hook_form_FORM_ID_alter()` over a branchy `hook_form_alter()`; entity-specific hooks over generic ones.
4. Hooks remain fully supported and often the right choice for lifecycle moments — the anti-pattern is *volume*, not existence (see the placement guidance on selecting hooks vs. events vs. services).

## Detection

Cyclomatic-complexity and file-size analyzers flag it; grep for function bodies > ~30 lines in `.module` files. Tests that mock services cannot even run against procedural code that calls `\Drupal` internally.

Validator: complexity tools (PHPMD, phploc via the audit module's `audit_complexity`) catch the volume; the "thin wrapper" rule itself is a review concern (see `drupal-validation-tooling/03-phpmd-and-complexity.md`).

## Version notes

- OOP hook attributes (`#[Hook]`, `src/Hook/`): introduced 11.1; not available on 10.x.
- `hook_form_FORM_ID_alter`: since 8.x; still the disambiguation tool in 11.x/12.x.
