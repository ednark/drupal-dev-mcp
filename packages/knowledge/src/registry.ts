export type SourceType =
  | 'core_code'
  | 'api'
  | 'change_record'
  | 'security_advisory'
  | 'official_guide'
  | 'contrib_code'
  | 'contrib_docs'
  | 'example'
  | 'skill'
  | 'php'
  | 'symfony'
  | 'tutorial'
  | 'training'
  | 'user_guide'
  | 'tooling'
  | 'standards'
  | 'methodology'
  | 'guidance';

export interface SourceDefinition {
  key: string;
  displayName: string;
  type: SourceType;
  authority: number;
  defaultSearch: boolean;
  fetcher: string;
  parser: string;
  canonicalBaseUrl: string;
  versionPolicy: 'core_snapshot' | 'core_compatibility' | 'agnostic' | 'upstream';
  lexical: boolean;
  vector: boolean;
  graph: boolean;
}

export const SOURCE_REGISTRY: readonly SourceDefinition[] = [
  { key: 'drupal_core_10', displayName: 'Drupal core 10.6', type: 'core_code', authority: 100, defaultSearch: true, fetcher: 'git', parser: 'drupal-code', canonicalBaseUrl: 'https://git.drupalcode.org/project/drupal/-/blob/10.6.x', versionPolicy: 'core_snapshot', lexical: true, vector: true, graph: true },
  { key: 'drupal_core_11', displayName: 'Drupal core 11.4', type: 'core_code', authority: 100, defaultSearch: true, fetcher: 'git', parser: 'drupal-code', canonicalBaseUrl: 'https://git.drupalcode.org/project/drupal/-/blob/11.4.x', versionPolicy: 'core_snapshot', lexical: true, vector: true, graph: true },
  { key: 'drupal_core_12', displayName: 'Drupal core 12.0', type: 'core_code', authority: 100, defaultSearch: true, fetcher: 'git', parser: 'drupal-code', canonicalBaseUrl: 'https://git.drupalcode.org/project/drupal/-/blob/12.0.x', versionPolicy: 'core_snapshot', lexical: true, vector: true, graph: true },
  { key: 'api_drupal_org', displayName: 'Drupal API', type: 'api', authority: 100, defaultSearch: true, fetcher: 'api-drupal-org', parser: 'api-drupal-org', canonicalBaseUrl: 'https://api.drupal.org/api/drupal', versionPolicy: 'core_snapshot', lexical: true, vector: true, graph: false },
  { key: 'change_records', displayName: 'Drupal change records', type: 'change_record', authority: 98, defaultSearch: true, fetcher: 'change-records', parser: 'change-records', canonicalBaseUrl: 'https://www.drupal.org/list-changes', versionPolicy: 'core_snapshot', lexical: true, vector: true, graph: false },
  { key: 'developer_guides', displayName: 'Drupal developer guides', type: 'official_guide', authority: 95, defaultSearch: true, fetcher: 'developer-guides', parser: 'markdown', canonicalBaseUrl: 'https://www.drupal.org/docs/develop', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'module_handbook', displayName: 'Drupal module handbook', type: 'official_guide', authority: 95, defaultSearch: true, fetcher: 'module-handbook', parser: 'markdown', canonicalBaseUrl: 'https://www.drupal.org/docs/develop/creating-modules', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'contrib_code', displayName: 'Curated contrib source', type: 'contrib_code', authority: 85, defaultSearch: true, fetcher: 'contrib-git', parser: 'drupal-code', canonicalBaseUrl: 'https://git.drupalcode.org/project', versionPolicy: 'core_compatibility', lexical: true, vector: true, graph: true },
  { key: 'contrib_docs', displayName: 'Contrib documentation', type: 'contrib_docs', authority: 78, defaultSearch: true, fetcher: 'contrib-docs', parser: 'markdown', canonicalBaseUrl: 'https://www.drupal.org/docs/contributed-modules', versionPolicy: 'core_compatibility', lexical: true, vector: true, graph: false },
  { key: 'drupal_examples', displayName: 'Drupal examples', type: 'example', authority: 88, defaultSearch: true, fetcher: 'examples-git', parser: 'drupal-code', canonicalBaseUrl: 'https://git.drupalcode.org/project/examples', versionPolicy: 'core_compatibility', lexical: true, vector: true, graph: true },
  { key: 'drupal_skills', displayName: 'Drupal skill guides', type: 'skill', authority: 82, defaultSearch: true, fetcher: 'skills-git', parser: 'markdown', canonicalBaseUrl: 'https://github.com/joachim-n/drupal-core-development', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'tutorials', displayName: 'Drupal tutorials', type: 'tutorial', authority: 70, defaultSearch: true, fetcher: 'tutorials', parser: 'markdown', canonicalBaseUrl: 'https://www.drupal.org/docs', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'symfony_docs', displayName: 'Symfony documentation', type: 'symfony', authority: 75, defaultSearch: true, fetcher: 'symfony-git', parser: 'markdown', canonicalBaseUrl: 'https://symfony.com/doc/current', versionPolicy: 'upstream', lexical: true, vector: true, graph: false },
  { key: 'php_docs', displayName: 'PHP manual', type: 'php', authority: 75, defaultSearch: true, fetcher: 'php-manual', parser: 'html', canonicalBaseUrl: 'https://www.php.net/manual/en', versionPolicy: 'upstream', lexical: true, vector: true, graph: false },
  { key: 'certification', displayName: 'Certification material', type: 'training', authority: 55, defaultSearch: false, fetcher: 'certification', parser: 'markdown', canonicalBaseUrl: 'https://www.acquia.com/support/training-certification', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'drupal_user_guide', displayName: 'Drupal user guide', type: 'user_guide', authority: 95, defaultSearch: true, fetcher: 'supplemental-docs', parser: 'markdown', canonicalBaseUrl: 'https://www.drupal.org/docs/user_guide/en', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'drush_docs', displayName: 'Drush documentation', type: 'tooling', authority: 88, defaultSearch: true, fetcher: 'supplemental-docs', parser: 'markdown', canonicalBaseUrl: 'https://www.drush.org/13.x', versionPolicy: 'upstream', lexical: true, vector: true, graph: false },
  { key: 'twig_docs', displayName: 'Twig documentation', type: 'tooling', authority: 88, defaultSearch: true, fetcher: 'supplemental-docs', parser: 'markdown', canonicalBaseUrl: 'https://twig.symfony.com/doc/3.x', versionPolicy: 'upstream', lexical: true, vector: true, graph: false },
  { key: 'drupal_coding_standards', displayName: 'Drupal coding standards', type: 'standards', authority: 95, defaultSearch: true, fetcher: 'supplemental-docs', parser: 'markdown', canonicalBaseUrl: 'https://www.drupal.org/docs/develop/coding-standards', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'php_fig', displayName: 'PHP-FIG PSR standards', type: 'standards', authority: 90, defaultSearch: true, fetcher: 'supplemental-docs', parser: 'markdown', canonicalBaseUrl: 'https://www.php-fig.org/psr', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'twelve_factor', displayName: 'Twelve-Factor App methodology', type: 'methodology', authority: 80, defaultSearch: true, fetcher: 'supplemental-docs', parser: 'markdown', canonicalBaseUrl: 'https://12factor.net', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'fowler', displayName: 'Martin Fowler articles and patterns', type: 'methodology', authority: 85, defaultSearch: true, fetcher: 'fowler', parser: 'markdown', canonicalBaseUrl: 'https://martinfowler.com', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'ms_cloud_patterns', displayName: 'Cloud design patterns', type: 'methodology', authority: 85, defaultSearch: true, fetcher: 'supplemental-docs', parser: 'markdown', canonicalBaseUrl: 'https://learn.microsoft.com/en-us/azure/architecture/patterns', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'eip_patterns', displayName: 'Enterprise integration patterns', type: 'methodology', authority: 85, defaultSearch: true, fetcher: 'supplemental-docs', parser: 'markdown', canonicalBaseUrl: 'https://www.enterpriseintegrationpatterns.com/patterns/messaging', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'gof_patterns', displayName: 'Design patterns (GoF catalog)', type: 'methodology', authority: 80, defaultSearch: true, fetcher: 'supplemental-docs', parser: 'markdown', canonicalBaseUrl: 'https://sourcemaking.com/design_patterns', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'drupal_theming_guide', displayName: 'Drupal theming guide', type: 'official_guide', authority: 95, defaultSearch: true, fetcher: 'theming-guide', parser: 'markdown', canonicalBaseUrl: 'https://www.drupal.org/docs/develop/theming-drupal', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'drupal_placement_guidance', displayName: 'Drupal change placement guidance (curated)', type: 'guidance', authority: 90, defaultSearch: true, fetcher: 'curated-local', parser: 'markdown', canonicalBaseUrl: 'https://www.drupal.org/docs', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'drupal_anti_patterns', displayName: 'Drupal AI-frequent anti-patterns (curated)', type: 'guidance', authority: 90, defaultSearch: true, fetcher: 'curated-local', parser: 'markdown', canonicalBaseUrl: 'https://www.drupal.org/docs', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'drupal_validation_tooling', displayName: 'Drupal validation tooling guidance (curated)', type: 'tooling', authority: 88, defaultSearch: true, fetcher: 'curated-local', parser: 'markdown', canonicalBaseUrl: 'https://www.drupal.org/docs', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'phpstan_drupal', displayName: 'phpstan-drupal extension (primary source)', type: 'tooling', authority: 92, defaultSearch: true, fetcher: 'phpstan-drupal', parser: 'markdown', canonicalBaseUrl: 'https://github.com/mglaman/phpstan-drupal', versionPolicy: 'upstream', lexical: true, vector: true, graph: false },
  { key: 'security_advisories', displayName: 'Drupal core security advisories', type: 'security_advisory', authority: 98, defaultSearch: true, fetcher: 'security-advisories', parser: 'markdown', canonicalBaseUrl: 'https://www.drupal.org/security', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
  { key: 'drupal_concept_bridge', displayName: 'Drupal concept-bridge guidance (curated)', type: 'guidance', authority: 90, defaultSearch: true, fetcher: 'curated-local', parser: 'markdown', canonicalBaseUrl: 'https://www.drupal.org/docs', versionPolicy: 'agnostic', lexical: true, vector: true, graph: false },
] as const;

export const SOURCE_BY_KEY = new Map(SOURCE_REGISTRY.map(source => [source.key, source]));
