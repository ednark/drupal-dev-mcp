export type SourceType =
  | 'core_code'
  | 'api'
  | 'change_record'
  | 'official_guide'
  | 'contrib_code'
  | 'contrib_docs'
  | 'example'
  | 'skill'
  | 'php'
  | 'symfony'
  | 'tutorial'
  | 'training';

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
] as const;

export const SOURCE_BY_KEY = new Map(SOURCE_REGISTRY.map(source => [source.key, source]));
