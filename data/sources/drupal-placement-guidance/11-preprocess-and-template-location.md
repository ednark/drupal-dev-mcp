# Preprocess hooks and template overrides — which layer hosts them

Intent: choosing between module-provided templates/hooks and theme-level overrides; organizing them correctly.

Source: https://www.drupal.org/docs/develop/theming-drupal

## Where it lives

- **Module defines** base template names and default variables (via hook_theme), plus module preprocess (`<module>_preprocess_*`).
- **Theme overrides** those templates by name suggestion (`templates/node--article.html.twig` inside active theme) and adds `<theme>_preprocess_*`.
- Module may also ship default templates consumable directly until overridden.

## Decision rules

1. Data transformation needed across all consumers regardless of their theme? Do it in the **module** (or better its service) — themes may not even be installed elsewhere.
2. Presentation-specific tweaks (wrappers, classes)? **Theme** preprocess/template.
3. Contribution-published reusable modules should expose minimal, intent-named variables instead of forcing every consumer to re-preprocess internals.
4. Preprocess chain order matters: module hooks run before theme hooks for same element; test when both transform same variable.

## Trade-offs

- Module-side logic maximizes reusability/testing; theme-side keeps markup freedom with zero API surface costs.
- Heavy interplay between module preprocess and theme preprocess hides data flow — document variable contracts in module docblocks so integrators know what they inherit.
