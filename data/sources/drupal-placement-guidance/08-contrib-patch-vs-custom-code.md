# Contributed module: patch, fork, or reimplement

Intent: a contributed module almost fits requirements; choosing between patching it, overriding parts of it, forking it, or writing a small custom replacement.

Source: https://www.drupal.org/docs/develop/creating-modules

## Where it lives

- **Patch** — diff committed with composer patches alongside pinned contrib versions (`composer.json` + patches file).
- **Decorate/override in custom module** — service decorators, plugin overrides, `hook_form_alter`: all stay out of contrib's tree.
- **Forked copy under `modules/custom` or private repo** — last resort ownership move.

## Decision rules

1. Is the gap fixable upstream? Search issue queue first; patches targeting already-open issues have the best maintenance story.
2. Gap is local/integration-specific (this site's data shapes)? Patch locally if trivial, decorate in custom module if it must survive updates robustly.
3. Project abandoned/unmaintained AND substantial rework needed? Fork consciously: rename machine name or manage as internal package, own security scanning thereafter.
4. Need is small relative to dependency weight? A lean custom module beats carrying heavyweight contrib plus patches.

## Trade-offs

- Patches vanish from history awareness unless tooling enforces them; document and verify per rebuild.
- Decorators/plugins/hooks survive composer installs untouched but lag behind upstream behavioral changes more gracefully than forks do.
- Forks guarantee stability-at-freeze forever — strongest commitment possible.
