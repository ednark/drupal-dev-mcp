# Service locator calls instead of dependency injection

Intent: replacing `\Drupal::service()` / `\Drupal::<service>()` calls inside classes with injected dependencies.

Source: https://www.drupal.org/docs/develop/creating-modules/dependency-injection

## Why it keeps appearing

`\Drupal::service()` is the shortest working path and dominates older tutorials and Drupal Answers snippets, so generators reach for it. It works — and hides a global dependency that makes the class untestable in isolation and tied to the built container.

## The anti-pattern

```php
public function load(string $id): ?EntityInterface {
  return \Drupal::entityTypeManager()->getStorage('node')->load($id);
}
```

Also flagged: `\Drupal::database()`, `\Drupal::messenger()`, `\Drupal::config()`, `\Drupal::currentUser()` inside class methods (acceptable only in genuine procedural entry points).

## The current pattern

Declare the dependency in the constructor; the container wires it:

```php
public function __construct(
  private readonly EntityTypeManagerInterface $entityTypeManager,
) {}

public function load(string $id): ?EntityInterface {
  return $this->entityTypeManager->getStorage('node')->load($id);
}
```

- **Services**: list the argument in `*.services.yml` (or `autowire: true`, solid in core since 10.2) and type-hint the interface.
- **Plugins, forms, blocks**: implement `ContainerInjectionInterface` / `ContainerFactoryPluginInterface` with a static `create()` that pulls services from `$container` into the constructor.
- **Procedural hooks**: keep them thin wrappers that call an injected service (see `02-hook-implementations-in-module-file.md`).

## Detection

PHPStan (class-usage rules), PHPCS DrupalSniff, grep for `\\Drupal::(service|database|messenger|config|currentUser)` inside `src/`. Runtime tests will not catch it.

Validator: PHPStan with the Drupal extension is the mechanical check (see `drupal-validation-tooling/01-phpstan.md`); PHPCS DrupalPractice catches some cases; the rest is grep.

## Version notes

- DI container: since Drupal 8; unchanged concept through 11.x/12.x.
- Constructor property promotion and `readonly`: PHP 8+, fine in 10.x+.
- Autowiring in core service YAML: reliable since 10.2.
