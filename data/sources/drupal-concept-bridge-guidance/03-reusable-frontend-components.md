# Reusable front-end components with colocated assets

## The question callers ask

- "What is the recommended way to create a reusable front-end component with
  its template, CSS and JS colocated in one directory?"
- "How do I build a self-contained component in Drupal (markup + styles +
  scripts together)?"
- "Where do reusable UI pieces live so they can be shared across pages?"
- "What replaced partial templates scattered across a theme?"

## The Drupal system: Single Directory Components (SDC)

Drupal 10.3+ ships **Single Directory Components (SDC)** as stable. A
component is one directory containing a `.component.yml` (machine name,
props with a JSON-schema-like definition, slots), a Twig template, and its
CSS/JS. Prop and slot definitions are machine-readable contracts.

```
components/my-card/
  my-card.component.yml   # name, props, slots, library
  my-card.twig            # include with include('my-theme:my-card')
  my-card.css
  my-card.js
```

Use `{{ include('my_theme:my-card', { title: ..., body: ... }, with_context = false) }}`
or let SDC auto-discover components under the theme's `components/` dir.
Component definitions are validated against the `.component.yml` schema.

## Decision rules

- Component lives with one theme and needs props/slots? **SDC**.
- Component must be reusable across themes/projects, or shipped by a
  distribution? SDC in a module (modules can define components) or a
  design-system contrib module.
- Just a template partial with no assets or contract? A plain Twig include
  remains fine.
- Building whole pages from components in Drupal CMS-era tooling (Canvas)?
  SDC components are the unit that page-building consumes.
- PHP-rendered widgets or complex data structures? Consider a render
  element or a plugin instead — SDC is presentational.

## Citations

- Using Single-Directory Components:
  https://www.drupal.org/docs/develop/theming-drupal/using-single-directory-components
- SDC change record (stable in 10.3): https://www.drupal.org/list-changes
- Theming guide: https://www.drupal.org/docs/develop/theming-drupal
