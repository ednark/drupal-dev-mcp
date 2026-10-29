# PHPCS with the Coder Drupal and DrupalPractice standards

Intent: enforce Drupal coding standards and best-practice sniffs mechanically, so neither humans nor agents burn review cycles on them.

Source: https://www.drupal.org/docs/develop/standards/php

## The stack

- `drupal/coder` ships two PHPCS standards:
  - **Drupal** — formatting, naming, docblocks, strict comparison, test classes (the coding-standards corpus in this index, source `drupal_coding_standards`, is the human-readable version of these rules).
  - **DrupalPractice** — project-practice sniffs: `t()` misuse in classes, unsafe `l()`/`url()` replacements, globals, debug calls, Yaml file issues.

```bash
composer require --dev drupal/coder
vendor/bin/phpcs --standard=Drupal,DrupalPractice \
  --extensions=php,module,inc,install,profile,theme,txt,yml \
  web/modules/custom
```

Canonical config: a committed `phpcs.xml.dist` pinning standards, extensions, and paths — the audit module's `audit_phpcs` submodule honors it and reports every violation, scoring the coding-standards dimension from the same ruleset.

## What it catches

- Standards violations: indentation, line length, docblock shape, array syntax, naming (hooks, services, plugin IDs).
- `DrupalPractice` smells that double as anti-pattern signals: static `t()` in class context, `\Drupal::` calls where injection is expected by sniffs, debug leftovers.
- Consistency drift across a codebase — the cheapest signal that generated code copied from mixed eras.

## What it structurally misses

- All behavior: it never executes or type-checks. Security, caching, and API-correctness are out of scope.
- Complexity and duplication (that is PHPMD/phploc/jscpd territory).
- Standards ≠ correctness: fully PHPCS-clean generated code can still carry D7-era idioms that happen to be formatted well.

## Version notes

- Coder tracks core standards per major line; verify the installed version matches the target Drupal major (Coder 8.3.x covers 10/11-era standards).
- `phpcbf` auto-fixes a large subset — safe for formatting rules, but run it before review, not as a review substitute; auto-fixes still need a diff read.
- Auto-fixing generated code can churn unrelated lines; scope `phpcbf` to changed files in fix loops.
