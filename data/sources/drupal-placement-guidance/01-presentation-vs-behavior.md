# Presentation changes versus behavior changes

Intent: deciding whether a requested change belongs in the theme layer or in a module.

Source: https://www.drupal.org/docs/develop/theming-drupal

## Where it lives

The split turns on what the change affects, not on where it feels convenient:

- **Presentation only** — output structure of existing data, markup classes, visual design, template overrides. Lives in the theme layer: Twig templates, CSS attached through libraries, theme-level preprocess hooks.
- **Behavior or data** — new stored data, business logic, reactions to system events, permissions, integrations. Lives in code: a custom module's services, plugins, hooks/subscribers.
- **Mixed changes** — e.g. "show a badge on featured articles": the *featured flag* is behavior/data (module), the *badge rendering* is presentation (theme).

## Decision rules

1. If the change can be expressed purely by editing HTML/CSS/Twig around data that already reaches the template → theme layer.
2. If the change requires knowing or storing something Drupal does not already know (new fields, conditions, computations) → custom module for that part.
3. If you find yourself writing PHP logic inside a Twig file or a template_preprocess hook to decide *content*, move that decision into a module (service, hook, render array); keep only display decisions in preprocess.

## Trade-offs

- Theme-layer-only fixes are fast and survive module updates cleanly, but cannot persist or compute anything.
- Putting data/logic in themes breaks when the site switches theme; Drupal's own convention (see user guide chapter on planning themes) is that themes contain no site-specific business logic.
- Splitting mixed changes costs two places to look, but keeps both reusable independently.
