# Hand-writing Views and field YAML: the pitfalls that fail silently

Intent: the failure modes of hand-authoring Views display configs and field/display YAML for Drupal 12 — where imports succeed but render breaks, or where module sets silently roll back. Distilled from the nps.gov/yell duplication test (2026-10-29).

Source: https://git.drupalcode.org/project/drupal (core/modules/views, core/lib/Drupal/Core/Field)

## The defaults: flags control option inheritance

Every non-default display in a views config carries a `defaults:` map deciding, per option, whether it overrides the default display. **A display without the map inherits EVERY option from the default display — an empty override (`header: { }`) means "inherit", not "none".**

Symptom: the new display renders as a *full clone* of the default display (same header areas, same table, same fields), and its own style/row/header/footer overrides never appear. No error is raised at import.

```yaml
display:
  my_block:
    display_plugin: block
    display_options:
      defaults:
        title: false
        style: false      # override the style
        row: false        # override the row plugin
        header: false     # empty header: {} now means NONE
        footer: false
        fields: false     # entity rows ignore fields, but declare the override
        filters: true     # inherited from default
        sorts: true
        pager: true
      header: { }
      style:
        type: default
      row:
        type: 'entity:node'
        options:
          view_mode: default
```

## Field configs need the complete option block

A hand-written views *field* missing any standard option (`alter`, `element_type`, `element_class`, `element_label_type`, `element_wrapper_type`, `element_default_classes`, `empty`, `hide_empty`, `empty_zero`, `hide_alter_empty`) crashes at render: `Unsupported operand types: array + null` in `FieldPluginBase::advancedRender`. Export one view from the UI and copy the field shape, or fill every key.

## Base table vs data table

Revisionable entities split tables: the term *name* lives in `taxonomy_term_field_data`, not `taxonomy_term_data`. A wrong-table reference produces a **Broken field handler with no error at import** — rows render, fields are empty. Diagnosis: `views.views_data` service dump for the table; watchdog SQL errors appear only for some pivots. Check for `Broken` in the rendered view when fields come out empty.

## Not every field is views-integrated

The taxonomy term `description` field (text_long) has **no views field handler** in 12.0.x-dev — the views data for its table is empty. Working pattern: entity rows (`row: { type: 'entity:taxonomy_term' }`) rendered through a term template override.

## Field/display imports: explicit settings everywhere

`EntityFormDisplay`/`EntityViewDisplay` creation with a widget entry missing `settings` or `third_party_settings` throws `WidgetBase::__construct(): Argument #4/#5 must be of type array, null given` — **config-schema defaults are not applied by raw import or storage->create()**. Every widget entry needs explicit `settings: { }` and `third_party_settings: { }`.

Also: a failed import can leave **partially-created displays** that then block recreation ("already exists" on create, null on load). `drush config-delete` the corrupt config before recreating.

## The core.extension rollback trap

The sync directory's `core.extension.yml` is the authoritative module set for `config:import`. If it is stale (exported before new modules were enabled), **every failed import first rolls the module set back** — silently uninstalling modules enabled outside the sync dir (JSON:API, datetime_range vanished this way during the duplication test). After enabling modules: re-export `core.extension` (or the full config) *before* the next import, and remember `config-export` **deletes** sync-dir files that don't match active config — preserve not-yet-imported files first.
