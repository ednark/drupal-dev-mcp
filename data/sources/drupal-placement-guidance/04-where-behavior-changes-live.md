# Where behavior changes live

Intent: adding or altering what the site *does* — new logic, data capture, reactions to events, integrations.

Source: https://www.drupal.org/docs/develop/creating-modules

## Where it lives

`modules/custom/<machine_name>/` as a proper module: `.info.yml`, then by shape of need —

- **Service** (`src/<Name>.services.yml`) — reusable dependency-injected logic; the modern default for business logic.
- **Hooks** (`<machine_name>.module` implementing documented hooks) — reacting to Drupal lifecycle/entity/runtime moments;Drupal is hook-first and hooks remain fully supported.
- **Events/subscribers** — alternative OO integration point for dispatched events; equivalent to hooks where an event exists.
- **Plugins** — blocks, field types/formatters/widgets, queue workers, migrations and more are plugin-driven under `src/Plugin/`.
- **Entities/fields** — persistent structured data demands content/config entity definitions in code, not ad-hoc storage.

## Decision rules

1. Would you test this code? Then it belongs behind a service, invoked from the thinnest possible hook/plugin.
2. Extend existing subsystem behavior → find its plugin type or event first before inventing structures.
3. Only add schema/storage where core offers none; prefer configuring fields/content types over bespoke tables unless scale says otherwise.
4. Administrative one-off tasks may be Drush commands in `src/Drush/` inside the same custom module — keep ownership of every artifact in version control.

## Trade-offs

- Custom modules carry full lifecycle ownership: updates, deprecations between Drupal 10.6 and 11.x, tests.
- Logic living directly in `.module` hooks works but resists unit testing; extract to services.
- Putting behavior in themes/UI hacks (e.g. PHP filters, views PHP) creates unversioned, invisible-to-auditors changes — a maintenance hazard.
