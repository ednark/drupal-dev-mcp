# Deployment workflow — how configuration changes travel

Intent: deciding where each part of a configuration change belongs in the local-to-production path (export, commit, import), and which mechanism hosts each step.

Source: https://www.drupal.org/docs/administering-a-site/configuration-management

## Where it lives

- **Local development** — make the change in the UI or in code, then export with `drush config:export` (`drush cex`) into the sync directory (`$settings['config_sync_directory']`). The exported YAML is the deployment artifact.
- **Git repository** — exported configuration YAML is committed and reviewed like code; it is the single source of truth for structural configuration.
- **Deploy pipeline** — production imports with `drush config:import` (`drush cim`), or the bundled `drush deploy` command that orders database updates and config import correctly. Never hand-edit production YAML.
- **Config split** — structural differences that legitimately differ per environment (devel on dev, shield on stage) are split configs, exported intentionally.
- **`settings.php` / environment includes** — per-environment infrastructure values (databases, API keys, reverse proxy toggles). Never exported configuration.
- **State API** — runtime-mutable values (last cron run, third-party tokens) that must NOT travel with deployments; state is not configuration.
- **Content** — does not travel with configuration at all; content moves via migrations, default content, or editor workflows.

## Decision rules

1. Should the change be identical on every environment? → export to the sync directory and commit.
2. Does the whole config object differ per environment? → config split, exported intentionally.
3. Only values differ per environment? → `settings.php` or environment-specific includes.
4. Is the value runtime-mutable and machine-owned (counters, timestamps, tokens)? → State API, never config.
5. Is it editor-managed content? → content workflow or migration, not configuration.
6. Ordering matters on deploy: run database updates and configuration import in a fixed, scripted order (`drush deploy` or explicit `updb` then `cim`), then rebuild caches.

## Trade-offs

- **UI changes drift silently**: any configuration changed in a production UI and not exported back will be overwritten by the next config import. Export after every intentional UI change, or forbid UI config changes in production.
- **Splits add deployment cognitive load** but keep imports deterministic; prefer a full split per environment role over ad-hoc overrides.
- **Hand-editing YAML locally is fine** — the sync directory is the source of truth either way; what matters is that production only ever imports, never edits.
- **`drush cim` deletes removed config**: deleting YAML from the sync directory deletes the config on import — review the diff, not just the files changed.