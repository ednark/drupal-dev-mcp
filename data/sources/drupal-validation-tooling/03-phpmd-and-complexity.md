# Complexity and duplication: PHPMD, phploc, jscpd

Intent: the size/shape metrics that flag "too complex" and "copied" code — and their limits when the code was generated to pass them.

Source: https://www.drupal.org/docs/develop/standards

## The tools

- **PHPMD** (`phpmd/phpmd`) — rule-based metrics: cyclomatic complexity, excessive method/class length, naming, dead code. Rulesets chosen per project (`cleancode,codesize,design,naming,unusedcode`).
- **phploc** — size metrics (lines, cyclomatic complexity aggregates). The audit module's `audit_complexity` submodule wraps the `cmgmyr/phploc` fork.
- **jscpd** (npm) — copy-paste detection across files, including Twig/JS/CSS, not just PHP. The audit module's `audit_duplication` submodule wraps it; this matters because generated Drupal work duplicates templates and styles as often as PHP.

```bash
vendor/bin/phpmd web/modules/custom text codesize,design,naming
npx jscpd web/modules/custom --min-tokens 70
```

## What they catch

- The blog-grade failure: a two-hundred-line `hook_form_alter` or a form builder with branch depth nobody can hold in their head (anti-pattern `02-hook-implementations-in-module-file.md`).
- Literal copy-paste: duplicated templates, copied block methods, near-identical services (anti-pattern `05-duplicated-existing-functionality.md`, partially).
- Growth signals: a module whose custom-code volume is climbing for unclear reasons.

## What they structurally miss — and how agents exploit it

A generator can pass every one of these checks while making the code worse:

- **Splitting to game the metric**: one incomprehensible function becomes five meaningless methods; complexity scores drop, coherence drops further. Metrics measure shape, not sense.
- **Semantic duplication**: jscpd finds literal copies; a re-implemented date formatter with different variable names passes clean (anti-pattern `05`).
- **Overengineering**: five small classes doing one ticket's work score beautifully (anti-pattern `06-overengineering-and-unneeded-abstractions.md`).

Treat a *clean* complexity/duplication report as "no known shape problems", never as "good architecture" — that judgment stays with review.

## Version notes

- PHPMD/phploc are Drupal-unaware: they will flag idiomatic Drupal structures (long plugin form arrays, hook wrappers) — tune rulesets or baselines rather than bending the code to the metric.
- jscpd threshold choice (`--min-tokens`) controls noise; too low flags every boilerplate plugin, too high hides real copies. Audit-module defaults are a reasonable start.
