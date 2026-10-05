# Change placement guidance — how this corpus works

This corpus answers one recurring question that API documentation does not answer well: *where should a change live in Drupal, and when is which approach warranted?* It exists because a caller who asks "I am migrating a site" or "should I create a custom theme?" needs decision frameworks, not hook signatures.

## Status of these documents

Each document is a synthesis of official Drupal documentation indexed elsewhere in this knowledge base (theming guide, module handbook, configuration management docs, user guide, Migrate API docs). The "Citations" section of every document names those primary sources. Conclusions are community conventions as recorded by drupal.org documentation; where Drupal itself enforces something (e.g. modules in `modules/custom` are never overridden by other installs), the document says so explicitly.

## How to read a placement entry

- **Intent** — what the user is trying to accomplish.
- **Where it lives** — the conventional location(s): custom theme, custom module, configuration, settings, contrib patch, or content.
- **Decision rules** — ordered questions whose answers select an option.
- **Trade-offs** — costs and benefits of each remaining option, stated neutrally.

## When to cite this corpus

Treat these documents as high-authority secondary sources: normative about convention, primary about nothing. Verify any specific API claim against the cited primary source via its `drupal://` resource URI before relying on details like function names or exact file paths.

Primary references used across this corpus:

- Theming guide: https://www.drupal.org/docs/develop/theming-drupal
- Creating modules handbook: https://www.drupal.org/docs/develop/creating-modules
- Configuration management: https://www.drupal.org/docs/administering-a-site/configuration-management
- User guide: https://www.drupal.org/docs/user_guide/en/index.html
- Migrate API: https://www.drupal.org/docs/drupal-apis/migrate-api
