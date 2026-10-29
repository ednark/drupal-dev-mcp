# Raw output and escaped-HTML bypasses in Twig

Intent: eliminating `|raw` (and sibling bypasses) from templates by moving markup construction into render arrays or properly sanitized values.

Source: https://www.drupal.org/docs/develop/theming-drupal/twig-in-drupal

## Why it keeps appearing

When generated markup "looks right" but renders escaped entities, the fastest fix a generator knows is appending `|raw`. It suppresses Twig's auto-escaping — including escaping that was protecting against user input — and almost always survives functional tests, which assert on the rendered string either way.

## The anti-pattern

```twig
{{ body_value|raw }}
{{ '<div class="x">' ~ user_input ~ '</div>'|raw }}
```

Also suspicious: `|striptags(false)`-style misuse, building HTML strings in PHP and passing them pre-marked safe without sanitization.

## The current pattern

1. **Render arrays over inline HTML**: return `['#markup' => $text]` (auto-escaped), `['#theme' => 'item_list', ...]`, or a dedicated `#type` — Drupal handles escaping, caching, and placeholders.
2. **Rich text goes through text formats**: `check_markup($text, $format_id)` or a field renderer, not `|raw` on a stored value.
3. **Truly pre-sanitized values**: mark them explicitly at the boundary (`Markup::create()` on a value already passed through a text format) — one deliberate, greppable decision, not a per-template escape hatch.
4. **Need to assemble HTML in Twig?** Prefer `{% set %}` with `trans`/`t` placeholders (`@variable` escaped, `%variable` for translations) over string concatenation with `|raw`.

## Detection

Grep templates for `|raw`, `|raw }`, and `autoescape false`; the `audit`-style Twig checkers flag it. Security review of custom themes should treat every occurrence as a finding requiring justification.

Validator: Drupal-aware Twig checkers (the audit module's `audit_twig`) are the mechanical layer; generic linters largely miss escaping semantics (see `drupal-validation-tooling/00-overview.md`).

## Version notes

- Twig auto-escaping: on in Drupal 8+; Twig 3 in 10.x+.
- `{{ body }}` on a field already renders safely; `|raw` is almost never needed for field values in Drupal templates.
