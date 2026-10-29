# Reimplementing what core or contrib already provides

Intent: before writing a service, plugin, or helper, establish that it does not already exist three modules over.

Source: https://www.drupal.org/docs/develop/creating-modules

## Why it keeps appearing

Generators optimize for a self-contained answer: a private helper in the current file beats a reference to something they cannot see. The result is a codebase with four date formatters, three "unique token" helpers, and two parallel queue-wrapper services — all green, all maintained forever.

## The anti-pattern

```php
// New 40-line helper for "human readable date difference",
// next to an installed module and a core service that both do this.
private function timeAgo(int $timestamp): string { ... }
```

## The current pattern

Search in this order, and record what was found:

1. **Core APIs**: entity type manager and storage, entity queries, `DatetimeFormatterInterface`, `QueueInterface`, `MessengerInterface`, path alias services, `TimeInterface`, datetime computations, `LinkGeneratorInterface`. Core's `core/lib` and `core/modules/*/src` are the first index to check.
2. **Installed contrib**: an `audit`-style site inventory beats guessing — the answer differs per project. `twig_tweak`, `eca`, `views_bulk_operations` et al. already ship large utility surfaces.
3. **Examples module** (`drupal-examples` source in this index) for the canonical shape of a plugin type before inventing one.
4. **Custom**: only after the above — and then placed per the change-placement guidance, not dropped into the nearest file.

A copy with one changed line is still a copy: pick the upstream path or document why forking is warranted.

## Detection

Nothing generic flags "this already exists": it needs an index of what is installed (site audit) plus a codebase search habit in review. Cheap heuristic for review: every new service/plugin/helper name gets a one-line "exists elsewhere?" check.

Validator: literal copy-paste is catchable (jscpd via the audit module's `audit_duplication`); semantic duplication is not — no tool can know a reimplemented helper "exists three modules over" (see `drupal-validation-tooling/03-phpmd-and-complexity.md`).

## Version notes

- Core service inventory shifts per major: verify against the target version's snapshot (this index carries 10.6/11.4/12.0 separately) rather than memory.
