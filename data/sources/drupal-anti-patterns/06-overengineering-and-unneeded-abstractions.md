# Overengineering: services, wrappers, and admin pages nobody asked for

Intent: shipping the thinnest implementation that satisfies the stated requirement; each abstraction and config surface must earn its maintenance cost.

Source: https://www.drupal.org/docs/develop/creating-modules

## Why it keeps appearing

When generation is cheap, the "complete-looking" answer inflates: one afternoon produces a service, a wrapper interface, a config schema, an admin form, and a permissions page — for a feature that needed one form alter. It passes every check. The cost arrives later: every custom module is one more thing to review per security update and one more to migrate at the next major.

## The anti-pattern

- An interface with exactly one implementation and no second consumer in sight.
- A settings page for values that are effectively constants.
- A config schema + storage for data that belongs in state, code, or nowhere.
- Decorators/factories/events "for extensibility" with no extension use case.
- A general-purpose utility module born from one ticket.

## The current pattern

1. Write the minimum for the requirement. Extract a service when there is a *second* caller or a unit-testing need — both are real triggers, one abstracted "just in case" is not.
2. Config needs a reason: user-editable per environment, or translatable. Otherwise constants in code.
3. Admin UI needs a reason beyond "complete feeling"; document the workflow it serves.
4. Prefer extending an installed module's existing extension points over new parallel structures (see `05-duplicated-existing-functionality.md`).
5. Each new custom module/file must map to a named requirement — in review, ask "what ticket is this?"

## Detection

Complexity metrics *under*-report this (each piece is simple). It is a review concern: count new top-level abstractions vs. requirements in the diff. The blog-grade heuristic — "would a senior dev have written this much for this ticket?" — is the check.

Validator: none. Metrics can even reward it (five small classes score cleanly); this is a human-review signal by construction (see `drupal-validation-tooling/03-phpmd-and-complexity.md`).

## Version notes

- Version-agnostic; the migration tax compounds per major upgrade (D10 → 11 → 12).
