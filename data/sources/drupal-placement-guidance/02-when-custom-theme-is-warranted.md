# When a custom theme is warranted

Intent: choosing between using an existing/contributed theme, enabling sub-theming, or building a custom theme from scratch.

Source: https://www.drupal.org/docs/develop/theming-drupal/creating-sub-themes

## Where it lives

`themes/custom/<machine_name>/`, with an `.info.yml` defining base theme inheritance. Themes ship templates, libraries (CSS/JS), theme settings, and optional `.theme` file with preprocess/theme hooks.

## Decision rules

Ask in order:

1. Does an out-of-the-box administrative/professional theme meet requirements unchanged? Use it — no work.
2. Do requirements differ mainly in colors/logo/layout tweaks? Create a **sub-theme** (starterkit) inheriting a maintained parent — standard recommended path, inherits upstream fixes.
3. Are the design language, markup expectations, or component system genuinely bespoke (design-system-driven builds, heavily customized frontend)? Build a **custom theme**, typically starting from core's starterkit rather than a contributor framework theme.
4. Custom themes are warranted specifically when: markup must match a provided design system component library, the site ships many themes-worthy variations, or parent-theme assumptions fight the design repeatedly.
5. Never use a custom (or any) theme to store business logic, entity data, or content; if the "reason" for the theme is non-presentational, that requirement belongs in a module.

## Trade-offs

- Sub-theme: minimal effort, stays compatible with parent updates, but inherits parent markup opinions and bloat.
- Custom theme: full control over markup and dependencies, but you own every regression, accessibility obligation, and update story.
- Contrib theme deep-forks drift permanently; budget for maintenance before forking.
