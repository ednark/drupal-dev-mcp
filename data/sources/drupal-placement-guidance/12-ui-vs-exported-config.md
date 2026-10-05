# UI-made changes versus exported configuration versus code

Intent: deciding whether a structural change is performed via admin UI then exported, provided by code, or left purely in the UI of each environment.

Source: https://www.drupal.org/docs/administering-a-site/configuration-management

## Where it lives

- **UI-then-export** (default): editors/admins create objects (views, content types, blocks placement, form displays) in dev; Configuration export captures YAML into version control; deploy imports.
- **Code-provided**: items shipped as default config by modules (`config/install/`) or constructed programmatically — appropriate for reusable products/distributions where module owns its artifacts.
- **Environment-local only**: throwaway tweaks never committed.

## Decision rules

1. Must survive deploys identically across environments? Must be captured/exported or code-provided; *never* rely on re-clicking per env.
2. Owned/reusable beyond this site? Provide via `config/install` so consumers get defaults automatically yet may still customize their own exports.
3. Editor-managed future changes expected? Keep exported config flexible rather than locked-by-code where feasible.

## Trade-offs

- UI-first keeps authors closest to actual behavior; risk is un-exported drift on prod hotfixes — enforce export-before-deploy discipline.
- Code-provided config guarantees presence everywhere but chafes when sites must adapt names/labels; schema conventions mitigate.
