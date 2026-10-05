# Content versus configuration

Intent: deciding whether a piece of information is content (editorial data, entity storage) or configuration (site structure/behavior definition).

Source: https://www.drupal.org/docs/user_guide/en/index.html

## Where it lives

- **Content** — content entities of all types (nodes, media, taxonomy terms, users, custom content entities). Movable between environments only via migrations/deploy tooling, deliberately NOT via config export.
- **Configuration** — definitions that shape how the site behaves: content types and their field storage, views, menus structure settings, vocabularies themselves.
- Instances such as a taxonomy term are content; the vocabulary *definition* holding them is config.

## Decision rules

1. Will humans edit/translate/version this through editorial workflows? → Content.
2. Is it part of the site blueprint that must be identical across dev/stage/prod? → Config.
3. Structured reusable data curated by editors but referenced by config (e.g. a list of office locations)? → Usually content entities created in prod; not config.
4. Almost-but-not-quite items: menu *links* configured via UI straddle both — treat per project convention consistently.

## Trade-offs

- Putting site-data into config makes environment deploys brittle (prod-only terms disappear on import elsewhere) — hence strict separation.
- Content versioning/deployment requires migration pipelines (see the migration checklist entry); config deployment alone never moves editorial data.
