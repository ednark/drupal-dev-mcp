# SDC components and Twig field rendering: runtime pitfalls

Intent: Drupal 12 SDC component and Twig field-rendering behaviors that fail silently or crash — verified live during the nps.gov/yell duplication test. Companion to 06 (views and field YAML pitfalls).

Source: https://www.drupal.org/docs/develop/theming-drupal/using-single-directory-components

## SDC: an empty required:[] array throws at render

A component definition with `required: []` (empty array) fails schema validation on every render:

```
InvalidComponentException: In component nps_yell:accordion:
[props.required] There must be a minimum of 1 items in the array, 0 found
```

The component must **omit the `required` key entirely** when no props are required — an empty array is not a valid value. No import-time error: the component installs fine and throws only when rendered.

## SDC: prop defaults are not applied via include() (observed)

A prop with `default:` in the `.component.yml` was **not applied** when the component was invoked through Twig `include('theme:name', {...})` — a `heading_level` default of h3 rendered as an empty variable, producing malformed markup (`< class="nps-accordion__question">`).

Working practice until the failing layer is isolated:

- Pass **every prop explicitly** through include(); do not rely on yml defaults.
- If a prop has only one sensible value across all consumers, remove the prop and hardcode it (see the overengineering anti-pattern).
- Single observation: the failing layer (Twig include bridge vs the schema validator) is not yet isolated; re-verify per Drupal version.

## Twig: the |view filter does not exist

`{{ referenced_node.field_answer|view }}` throws `Twig\Error\SyntaxError: Unknown "view" filter` — Drupal registers no such filter. Rendering a field of an arbitrary (non-rendered) entity is a **preprocess responsibility**:

```php
// nps_yell.theme
function nps_yell_preprocess_node__park_info(array &$variables): void {
  $view_builder = \Drupal::entityTypeManager()->getViewBuilder('node');
  foreach ($node->get('field_faqs')->referencedEntities() as $faq) {
    $variables['faq_items'][] = [
      'question' => $faq->label(),
      'answer' => $view_builder->viewField($faq->get('field_answer')),
    ];
  }
}
```

```twig
{{ include('nps_yell:accordion_item', { question: item.question, answer: item.answer }, with_context = false) }}
```

Pattern: **PHP assembles, Twig presents.** Render arrays pass through SDC slots and Twig unchanged.

## Renderer::render() takes its argument by reference

`Renderer::render()` cannot be called on an expression result:

```php
// PHPStan: Parameter #1 $elements is passed by reference
$html = \Drupal::service('renderer')->render($entity->get('field_body')->view());
```

Pass a variable, or better: don't render in PHP at all — pass the render **array** through to the template; Twig renders it (render arrays survive SDC slots and preprocess variables).

## Related corpus entries

- corpus-issues: sdc-empty-required-throws, sdc-prop-defaults-not-applied-via-include, twig-no-view-filter-referenced-entity-rendering
- Anti-pattern 03 (Twig raw/escaping) for the security dimension of field rendering.
