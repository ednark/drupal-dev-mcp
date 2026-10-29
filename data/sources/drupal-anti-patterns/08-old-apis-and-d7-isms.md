# Removed and D7-era APIs that still compile in snippets

Intent: recognizing the D7/D8-era API calls that generators copy from old material, and their current replacements on the indexed lines.

Source: https://www.drupal.org/list-changes

## Why it keeps appearing

These calls dominated Drupal 7 (and early 8) material, so they remain the *most likely* completion. Some were removed (fail loudly), some were deprecated (pass with notices), and some still exist but are the wrong idiom — which is why linters alone do not catch all of them.

## The catalogue

| Seen in generated code | Status | Current pattern |
|---|---|---|
| `db_query()`, `db_select()`, `db_insert()` | removed (9.0) | inject `DatabaseConnection` (`@database`) or use entity queries |
| `drupal_set_message()` | removed (9.0) | inject `MessengerInterface` |
| `node_load()`, `user_load()`, `file_load()` | removed (9.0) | entity storage handlers via `EntityTypeManagerInterface` |
| `entity_load()` / `entity_create()` | deprecated | storage `load()` / `create()` |
| `drupal_render()` | removed (9.0) | render service (`RendererInterface`) or return render arrays |
| `url()`, `l()` | removed (9.0) | `Url::fromRoute()`, `Link::createFromRoute()` |
| `variable_get()` / `variable_set()` | removed (8.0) | `ConfigFactoryInterface` + `config/schema` |
| `t()` called statically in class context | wrong idiom | `$this->t()` (`StringTranslationTrait`) |
| `drupal_get_path()` | deprecated (9.3+) | `ExtensionPathResolver` / `$extension_list->getPath()` |
| `\Drupal::service('renderer')->render()` mid-build | wrong idiom | keep it a render array; let the caller render |
| `module_invoke()`, `module_load_include()` | legacy | direct class/service calls; autoload |
| `theme()` | removed (8.0) | render arrays with `#theme` |
| `file_prepare_directory()` etc. | removed (9.0) | `\Drupal::service('file_system')` methods |
| `format_date()` | removed (9.0) | `DateFormatterInterface` |
| `taxonomy_get_term_by_name()`, procedural entity helpers | removed | entity query on the storage |
| `hook_init()`, `hook_boot()` | removed (D8) | event subscribers (`KernelEvents::REQUEST`) |

## Version notes

- "Removed in 9.0" items error on 10.x/11.x — generation including them indicates a stale completion, fix wholesale.
- "Deprecated" items may still run on 10.x/11.x and are actively removed toward 12: check `change_records` (this index) for the item's removal record, and the core snapshot for the current signature.
- When a replacement differs across 10.6/11.4/12.0, prefer the version-aware cross-search rather than the first hit.

## Detection

PHPStan with deprecation rules catches most "deprecated/removed" cases; the "still exists but wrong idiom" rows (static `t()`, mid-build `render()`) are review and grep work.

Validator: PHPStan + `phpstan/phpstan-deprecation-rules` — bundled and site-integrated by the audit module's `audit_phpstan` (see `drupal-validation-tooling/01-phpstan.md`); "wrong idiom" rows need grep and review.
