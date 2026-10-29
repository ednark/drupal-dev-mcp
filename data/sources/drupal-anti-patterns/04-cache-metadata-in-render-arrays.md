# Render arrays without cache metadata

Intent: every render array carries `#cache` (contexts, tags, max-age) so Drupal can cache correctly — instead of missing metadata or hand-rolled static caches.

Source: https://www.drupal.org/docs/drupal-apis/cache-api/cacheable-metadata

## Why it keeps appearing

Cache metadata is invisible in a passing test: the page renders, assertions pass, and the bug only appears for a *second* user or a logged-in session served a cached variant. Generators trained on snippets omit `#cache` because most snippets omit it.

## The anti-pattern

```php
return [
  '#markup' => $this->renderLatest(),
  // No #cache: cached as if identical for every user, or not cached at all.
];
```

The over-correction is just as harmful: custom static caches (`\Drupal::cache()` with hand-picked keys, module-level property caches) duplicating what render-cache + bubbling already do, with stale-invalidation bugs of their own.

## The current pattern

```php
return [
  '#markup' => $this->renderLatest(),
  '#cache' => [
    'contexts' => ['user.permissions'],  // what varies the output
    'tags'     => ['node_list:article'], // what invalidates it
    'max-age' => 300,                    // or Cache::PERMANENT
  ],
];
```

- Derive metadata from the underlying objects: `$node->getCacheTags()`, `$entity->getCacheContexts()`, or collect with `CacheableMetadata::createFromObject($x)->applyTo($build)`.
- Metadata bubbles child → parent automatically; a leaf with no metadata poisons the branch.
- Vary by exactly the things that change output — nothing more (over-varying destroys hit rates; under-varying leaks content).

## Detection

No generic linter catches this; it needs Drupal-aware checks (the `audit` module's caching/performance scores, manual review of custom render arrays). Any custom render code in a diff without `#cache` deserves a question.

Validator: the audit module's `audit_cache` and `audit_twig` check block/render cache configuration including bubbling; PHPStan and PHPCS structurally cannot (see `drupal-validation-tooling/00-overview.md`).

## Version notes

- Cache API + bubbling: since 8.x, unchanged through 12.x.
- `CacheableDependencyInterface`, placeholders/BigPipe: 8.x+; still current.
- Max-age 0 = do not cache — occasionally the *correct* answer for per-request data.
