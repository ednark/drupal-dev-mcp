# Site migration checklist — where everything lands

Intent: migrating an existing (often legacy or platform-out) site onto a Drupal codebase; mapping each category of source material to its destination.

Source: https://www.drupal.org/docs/drupal-apis/migrate-api

## Where it lives

| Source material | Destination |
|---|---|
| Editorial content | Migrate API content pipeline → nodes/media/terms/users as **content** in the target |
| Taxonomies/vocabularies/terms | Vocabulary *definitions* via config; terms via migration |
| Content types & fields | Rebuilt as **config** on target (not migrated) where structure is equivalent; otherwise migrate_create_tools generate initial config to refine |
| Files/images | Migration process plugins copying into public/private file storage, referenced by media entities |
| Users/passwords | Migrated users; password compatibility handled by hash migrators where available |
| URL aliases/redirects | Redirect module config + migration; preserve SEO paths verbatim |
| Custom business logic from old system | **Rewritten in custom modules** (`modules/custom`) — never ported wholesale without review against current APIs for the target Drupal version |
| Styling/templates from old theme | Decision per `03-where-style-changes-live` / `02-when-custom-theme-is-warranted`: usually a fresh sub/custom theme consuming exported design tokens, not a converted stylesheet dump |
| Site settings/variables | Map deliberately: structural ones → exported config; environmental → settings.php |

## Decision rules (the when)

1. Content volume justifies automation? Then Migrate API (source → process → destination plugin chains) over one-off SQL scripts.
2. Rollback requirements matter? Migrations are re-runnable and provide tracking — pick them before any manual import script.
3. Old platform's fields map cleanly onto target field types? Configure target first, then write process mappings; else create custom field types in modules.
4. Incremental/content-continues-during-cutover? Plan incremental migrations keyed on timestamps/IDs.

## Trade-offs

- Configure-first then migrate-data keeps legacy schema distortions out of the new information architecture.
- Wholesale 1:1 porting perpetuates legacy pain but minimizes risk/cost near freeze dates.
- Migration scripts live in version control too — typically `migrations/` inside a dedicated profile or custom migration module — so the whole cutover remains reproducible.

## Citations
- Source: https://www.drupal.org/docs/drupal-apis/migrate-api
- Configuration management overview: https://www.drupal.org/docs/administering-a-site/configuration-management
