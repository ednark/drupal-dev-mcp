# Attaching CSS and JavaScript

Intent: deciding how stylesheets/scripts reach pages — library definitions versus ad-hoc includes.

Source: https://www.drupal.org/docs/develop/theming-drupal

## Where it lives

- **`.libraries.yml` + attachment** — declare assets with dependencies, versions, weights; attach from Twig (`{{ attach_library('theme/name') }}`), render arrays (`#attached => ['library' => [...]]`), or globally via `*.info.yml`.
- Theme-owned libraries for presentation; module-owned libraries when markup shipped by that module inherently needs behavior/styles of its own.
- Conditional inclusion based on context belongs in render arrays/preprocess deciding whether to attach at all.

## Decision rules

1. Asset needed everywhere/global layout? Attach via theme info file.
2. Component-scoped? Attach within that component's template/render array only.
3. Dependent on editor-entered data/state? The PHP side decides attachment; template never guesses.
4. Third-party bundles belong inside libraries definitions with license metadata rather than CDN script tags injected in templates where cacheability is harmed.

## Trade-offs

- Render-array attachment is cache-tag/context aware: safest default.
- Global info-file attachment is simple but taxes every page.
- Template-injected raw `<script>` bypasses aggregation/dependencies/deduplication — avoid except truly static edge cases.

## Citations
- Source: https://www.drupal.org/docs/develop/theming-drupal/adding-assets-css-js-to-a-drupal-theme-via-librariesyml
