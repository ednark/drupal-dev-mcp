# Unbounded loops instead of Batch and Queue API

Intent: long-running work goes through Batch API (interactive) or Queue API + cron (background), never a bare loop in a submit handler or `hook_cron()`.

Source: https://www.drupal.org/docs/drupal-apis/batch-api and https://www.drupal.org/docs/drupal-apis/queue-api

## Why it keeps appearing

A `foreach` over all entities is the obvious implementation and passes tests on fixtures of ten items. Against production data it times out PHP-FPM, wedges a cron run, or silently processes half the set. Generators rarely reach for batch/queue unprompted.

## The anti-pattern

```php
public function submitForm(array &$form, FormStateInterface $form_state): void {
  foreach ($this->nodeStorage->loadMultiple() as $node) { // thousands
    $this->expensiveTransform($node);
  }
}
```

Same shape in `hook_cron()`, `hook_update_N()`, and Drush one-shots.

## The current pattern

- **User is waiting**: Batch API via `BatchBuilder` — chunked operations with context, progress bar, resumable across requests.
- **Nobody is waiting**: Queue API — items via `\Drupal::queue($name)`, workers via `queue_ui`-style processing or `hook_cron()` claiming a bounded item count per run.
- **`hook_update_N()`**: batch context for large data rewrites, or split into multiple updates.
- **Entity loading in loops**: `loadMultiple()` in pages, never per-iteration `load()`; chunk with an entity query pager/ID range.

## Detection

Grep for `loadMultiple()` / `foreach` over storage inside submit/cron/update handlers; complexity tools won't flag it and small-fixture tests won't either. The `audit` module's performance checks catch some cases at runtime.

Validator: complexity/size tools catch the shape indirectly; runtime checks (`audit_cron`, `audit_performance`) catch the symptom. Neither asserts "should be batched" — review signal for submit/cron handlers (see `drupal-validation-tooling/00-overview.md`).

## Version notes

- Batch and Queue API: 7.x→8.x redesign, stable surface since 8.x through 12.x.
- `BatchBuilder`: since 8.6 — prefer it over raw `batch_set()` arrays.
- Queues declare workers as `@QueueWorker` plugins; cron claims `time > 15s` budget by default.
