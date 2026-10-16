# Shipping default configuration and content as one unit

## The question callers ask

- "How can a module or distribution ship default configuration and content
  so another site can apply it as one unit?"
- "How do I package starter content and settings a site can install in one
  step?"
- "What is the modern replacement for install profiles' default content?"
- "How do I deliver a preconfigured feature (content type + fields + view +
  sample content) to another site?"

## The Drupal system: Recipes

Drupal 10.3+ ships **recipes** (in core, stable in the 10.4/11 era): a
recipe is a directory with a `recipe.yml` declaring the configuration,
content, and module/theme dependencies to apply — as one unit, onto an
existing site. `php core/scripts/drupal recipe path/to/recipe` applies it.
Recipes compose (a recipe can apply other recipes) and are the
Drupal CMS-era packaging unit.

```
my_recipe/
  recipe.yml        # name, description, install: [config, content, modules...]
  config/           # configuration to import
  content/          # exported default content
```

## Decision rules

- Ship default config + content to be applied to an EXISTING site, one
  unit, composable? **Recipe**.
- Ship a full site blueprint that defines the site at install time? An
  install profile (legacy for this use; recipes are the modern direction).
- Ship only configuration, no content, as part of a module's own install?
  The module's `config/install` directory (plain module default config).
- Need editorial "sample content" without code? Default content tooling
  exported into a recipe's `content/` directory.

## Citations

- Recipes overview (drupal.org): https://www.drupal.org/docs/extending-drupal/recipes
- RecipeRunner source (indexed in this corpus): core/recipes
- Drupal CMS packaging (recipes in practice): https://www.drupal.org/project/drupal_cms
