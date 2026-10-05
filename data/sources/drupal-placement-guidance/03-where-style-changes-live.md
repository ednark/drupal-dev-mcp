# Where style changes live

Intent: a stakeholder wants something styled differently (colors, spacing, layout, responsive behavior, hidden/visible elements).

Source: https://www.drupal.org/docs/develop/theming-drupal

## Where it lives

1. **Site's active theme CSS via a library** — the default answer. Component-scoped stylesheets declared in `*.libraries.yml`, attached in templates or render arrays; overrides for contrib module styling go in the theme as well.
2. **Twig templates** — when the change needs different markup structure or wrapper elements to target (`templates/` with core template name suggestions, e.g. `node--article--teaser.html.twig`).
3. **Theme settings / configuration UI** — color schemes, logo, breakpoint-visible blocks: many base themes expose these as theme settings rather than code.
4. **Not in core/contrib files** — never edit contrib or core templates/stylesheets directly.

## Decision rules

- Pure visual change with existing markup → library-attached CSS in the custom/sub theme.
- Need a hookable element that doesn't exist → template override or preprocess tweak in the theme.
- Change should vary per editor choice/per placement → theme settings or block/paragraph config rather than hard-coded CSS.
- Style depends on data state (e.g. "highlight if flagged") → module adds a class via render array/template variable; theme only defines what that class looks like.

## Trade-offs

- Theme CSS is update-safe and centralizes design debt.
- Template forks of contrib templates must be re-diffed on upstream updates — track why each fork exists.
- Modules injecting inline "styling" via libraries in a module is acceptable for *self-contained* component markup but fightable with themes; prefer rendering intent-neutral classes and letting themes decide appearance.
