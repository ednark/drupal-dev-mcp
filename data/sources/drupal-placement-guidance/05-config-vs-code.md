# Configuration versus code

Intent: deciding whether a site customization belongs in exported configuration or committed code.

Source: https://www.drupal.org/docs/administering-a-site/configuration-management

## Where it lives

- **Configuration export** (`config/sync/*.yml`, managed via Configuration API) — everything editors/admins can create through the UI: content types, fields, views, block layouts, image styles, vocabularies, roles, form display/view display settings, some module settings.
- **Code (custom modules/themes)** — anything requiring programming: services, hooks, plugins, custom entities, complex rendering. Their *settings* (e.g. thresholds, toggles) become config schema owned by that module, discoverable via `config/schema`.
- **`settings.php`** — environment credentials and low-level bootstrap values ($databases, $settings, $config_directories); not part of YAML config exports for most items.

## Decision rules

1. Could the change be created entirely through admin UI without writing PHP? → It is config; make it in a dev environment and export it.
2. Does defining the capability require new executable PHP? → Code. Ask whether that code needs operator-adjustable values; if so those belong in config with schema.
3. Per-environment differences (API keys, hostnames, cache backends)? → `settings.php` / split mechanism, never stored config exports.
4. When both apply ("a view whose results are computed specially") → config carries structure + view plugin provided in code.

## Trade-offs

- Config-only changes deploy atomically with config import and roll back cleanly.
- Code provides power but requires release process/deploy discipline for even tiny tweaks made in code.
- Hardcoding UI-created things into code forfeits editor autonomy; hand-crafting config exports instead of building via UI risks schema mistakes.
