# Getting a Drupal 12 site running — the environment stack

Intent: the setup sequence an agent should know for standing up a local Drupal 12 site — verified on the nps.gov/yell duplication test (ddev + OrbStack, October 2026).

Source: https://www.drupal.org/docs/develop/local-server-setup (and the duplication-test ledger)

## The sequence

1. **Container runtime up before ddev**: ddev reports success states independently of Docker; verify with `docker info` (OrbStack: `open -a OrbStack` / `orbctl start`). "Started" project + dead runtime = confusing failures.
2. **Project config**: `ddev config --project-name <name> --project-type drupal12 --docroot web --create-docroot --php-version 8.5`. The PHP floor for 12.0.x is **8.5** (see placement 16).
3. **Install**: `ddev composer create-project drupal/recommended-project:12.0.x-dev ./` — **requires a clean project root**: ddev rejects the create when ANY untracked directory exists (notes/, source snapshots, anything). Stash side directories, restore after.
4. **Site install**: `ddev drush site:install standard -y` (drush arrives via `composer require drush/drush` — core-dev no longer ships it).
5. **Verify**: `/user/login` returns 200; `/` may 403 until front content exists.

## D12-specific setup facts (snapshot-verified)

- **Standard profile creates NO default content types** and no body storage (change record 3540814) — every field model is built from zero.
- **Removed from core in 12.0**: Claro and Olivero themes (only default_admin, stark, starterkit_theme remain — a D11-era `base theme: olivero` breaks theme install), the telephone module, and the experimental `sdc` module (obsolete — components are core; see change record 3410260).
- `filtered_html` no longer exists — text formats are basic_html/full_html/plain_text/restricted_html.
- **Config import gotchas**: a sync-dir `core.extension.yml` exported before modules were enabled will silently uninstall them on the next failed import — re-export after enabling modules. `config-export` rewrites the whole sync dir from active config (partial files staged there are destroyed).

## Validation loop (per the validation-tooling corpus)

phpcs (Drupal + DrupalPractice) and phpstan (level 5+) over `web/modules/custom` + `web/themes/custom` — configure in step 0, run every step. phpstan catches render-API misuse phpcs cannot.

## Related corpus entries

- Placement 16: PHP runtime floors per line.
- corpus-issues: the SDC/views YAML pitfalls doc (`drupal-validation-tooling/06`) for the hand-authored config traps hit during this test.
