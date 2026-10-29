# Custom block staleness: cache tags vs cache contexts

Intent: the most common "my block shows stale content" failure — choosing between cache tags (what the block *depends on*) and cache contexts (what *varies* the block) — with the canonical fixes.

Source: https://www.drupal.org/docs/drupal-apis/cache-api/cacheable-metadata

## Why it keeps appearing

Custom blocks render once, then keep showing old content after edits — or show one user's data to everyone. The two failure modes need opposite fixes, and generated code tends to reach for the wrong one (or neither). The recurring developer questions are: *the block doesn't update when its content is edited*, and *the block depends on the current node/user — which mechanism?*

## The two mechanisms

- **Cache tags** answer "*what must invalidate this block when X changes?*" — they do not make the block per-user or per-node. `block_content:UUID` (block entity), `node:123`, custom tags.
- **Cache contexts** answer "*how many variants of this block exist?*" — `user` (per user), `user.permissions`, `route`, `timezone`. Contexts multiply cached variants; they never invalidate anything.

The recurring mistake: adding a context where a tag is needed (block never updates), or a tag where a context is needed (one user's data served to all). If block content changes when a *specific entity* is edited → tag. If the block *looks different per viewer or per page* → context.

## The anti-pattern

```php
// Stale after edit: no tag on the block content entity.
$build['#markup'] = $this->renderCustomBlock();

// Wrong: a tag cannot vary per viewer — leaks one user's data to all.
$build['#cache']['tags'] = ['node:' . $currentNodeId];
```

## The current pattern

1. **Block content edits must invalidate**: derive the tag from the entity — `CacheableMetadata::createFromObject($block)->applyTo($build)` or `$build['#cache']['tags'][] = 'block_content:' . $block->uuid();`. Saving the block clears `block_content:*` automatically; custom render logic must carry the tag for that to reach your build.
2. **Content depends on the current node/user**: use a context so variants are cached separately —
   ```php
   $build['#cache']['contexts'][] = 'route';        // per-page variant
   $build['#cache']['contexts'][] = 'user';         // per-user variant
   ```
   For data derived from the current node, prefer the node's *tag* (`node:N`) plus whatever context actually varies the output — and be honest about the variant explosion per-user contexts cause.
3. **Custom invalidation on external changes**: a cache tag invalidation must happen in the code path that changes the data (`Cache::invalidateTags(['my_tag:...'])` in the entity hook or service that mutates it) — invalidating in the render path is a symptom patch.
4. **Context-aware block plugins** (per-block context annotations) are the 8.x+ mechanism for blocks whose *configuration* comes from runtime contexts — distinct from cache contexts; do not confuse the two.

## Debugging workflow

1. Enable `debug: cacheability headers` (development services) and inspect `X-Drupal-Cache-Tags/Contexts` on the response.
2. Verify the expected tag is *present* on the response — a missing tag means the build never inherited it (bubbling gap, see `04-cache-metadata-in-render-arrays.md`).
3. Verify the tag is actually *invalidated* when the data changes (tags only invalidate when the tagged entity changes in the database).
4. Site-audit tooling (the audit module's cache checks) flags blocks with `max-age: 0` — a common over-correction that "fixes" staleness by disabling caching entirely.

## Detection

No generic linter expresses staleness; this is the audit module's cache-score territory plus review. Any custom block render path in a diff with neither tags nor contexts deserves the question: *what changes this block, and what varies it?*

## Version notes

- Cache tags/contexts and bubbling: since 8.x, unchanged through 12.x.
- `lifecycle: deprecated`-era block plugins and `BLOCK_NO_CACHE`: legacy constants still appear in old snippets; prefer `#cache` metadata.
