# Drupal MCP Benchmark Questions

20 representative questions for manual testing. Pass threshold: ≥ 16/20 score ≥ 3/5.

## Scoring Rubric
- 5: Correct API, correct version, ≥1 working code example, no hallucinated functions
- 4: Correct API, minor version ambiguity, ≥1 code example
- 3: Mostly correct, minor errors, some code
- 2: Partially correct, missing key details
- 1: Wrong or misleading

## Questions

### Views (skill: views)
1. How do I create a Views display that shows taxonomy terms as exposed filters?
   - Expected: Views UI steps OR Views hook + plugins; drupal_module_handbook or drupal_developer_guides result
   - Skill domain: views

2. How do I programmatically create a view and add a field to it in Drupal?
   - Expected: Views API, `\Drupal\views\Views::getView()` or similar
   - Skill domain: views

### Blocks (skill: blocks)
3. How do I create a custom block plugin in Drupal?
   - Expected: `@Block` annotation, `BlockBase` extension, `build()` method
   - Skill domain: blocks

4. How do I make a block's visibility depend on a custom condition?
   - Expected: `BlockBase::blockAccess()` or condition plugins
   - Skill domain: blocks

### Fields (skill: fields)
5. How do I create a custom field type with a custom formatter in Drupal?
   - Expected: `@FieldType`, `@FieldFormatter` annotations, relevant class structure
   - Skill domain: fields

6. How do I add a base field to a custom content entity?
   - Expected: `baseFieldDefinitions()`, `FieldStorageDefinition` or `BaseFieldDefinition`
   - Skill domain: fields

### Nodes (skill: nodes)
7. How do I programmatically create a node with field values in Drupal?
   - Expected: `Node::create()`, `setValue()`, `save()`; or Entity API
   - Skill domain: nodes

8. How do I add a view mode to a content type and render it programmatically?
   - Expected: `EntityViewBuilder`, view mode configuration, `entity_view()`
   - Skill domain: nodes

### Taxonomy (skill: taxonomy)
9. How do I load all terms from a vocabulary and render them as links?
   - Expected: `TermStorage::loadTree()`, `\Drupal::entityTypeManager()`, render array
   - Skill domain: taxonomy

10. How do I create a taxonomy term reference field on a content type?
    - Expected: field UI steps OR `FieldConfig::create()` with entity_reference
    - Skill domain: taxonomy

### Theming (skill: theming)
11. How do I create a Twig template override for a specific content type?
    - Expected: template naming convention, `hook_theme_suggestions_HOOK_alter()`, `node--{bundle}.html.twig`
    - Skill domain: theming

12. How do I add a CSS library to a Drupal module?
    - Expected: `*.libraries.yml`, `#attached`, `drupal_add_library()` deprecation note
    - Skill domain: theming

### Forms (skill: forms)
13. How do I build a custom form in Drupal with validation and submission handling?
    - Expected: `FormBase`, `buildForm()`, `validateForm()`, `submitForm()`, `\Drupal::formBuilder()`
    - Skill domain: forms

14. How do I add an AJAX callback to a form element in Drupal?
    - Expected: `#ajax`, `AjaxResponse`, `ReplaceCommand` or similar
    - Skill domain: forms

### Text Formats (skill: text-formats-editors)
15. How do I create a custom text format filter plugin in Drupal?
    - Expected: `@Filter` annotation, `FilterBase`, `process()` method
    - Skill domain: text-formats-editors

### Config Parser (skill: config-parser)
16. How do I define a configuration schema for a custom module in Drupal?
    - Expected: `config/schema/*.schema.yml`, typed config, schema.yml structure
    - Skill domain: config-parser

### Other Content Entities (skill: other-content-entities)
17. How do I create a custom content entity type in Drupal?
    - Expected: `@ContentEntityType` annotation, `ContentEntityBase`, `baseFieldDefinitions()`
    - Skill domain: other-content-entities

### General Module Creation
18. How do I implement hook_entity_presave() to modify an entity before saving?
    - Expected: hook implementation, correct parameter types, `$entity->isNew()` pattern
    - Skill domain: (hook detection, no specific skill)

19. How do I register a custom service in a Drupal module and inject it into a controller?
    - Expected: `*.services.yml`, dependency injection, `ContainerInjectionInterface`
    - Skill domain: (services, no specific skill keyword)

20. How do I use the Drupal Database API to run a custom SELECT query?
    - Expected: `\Drupal::database()->select()`, `->fields()`, `->execute()`, `->fetchAll()`
    - Skill domain: (no specific skill)

---

## Results Log

| # | Score | Skill Detected | Sources Used | Notes |
|---|-------|----------------|--------------|-------|
| 1 | - | - | - | |
| 2 | - | - | - | |
| 3 | - | - | - | |
| 4 | - | - | - | |
| 5 | - | - | - | |
| 6 | - | - | - | |
| 7 | - | - | - | |
| 8 | - | - | - | |
| 9 | - | - | - | |
| 10 | - | - | - | |
| 11 | - | - | - | |
| 12 | - | - | - | |
| 13 | - | - | - | |
| 14 | - | - | - | |
| 15 | - | - | - | |
| 16 | - | - | - | |
| 17 | - | - | - | |
| 18 | - | - | - | |
| 19 | - | - | - | |
| 20 | - | - | - | |

**Total: _/20 ≥ 3/5** | **Pass: _/16 threshold**
