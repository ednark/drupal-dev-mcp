import test from 'node:test';
import assert from 'node:assert/strict';
import { documentId, contentHash } from '../src/ids.js';
import { extractPhpGraph } from '../src/graph/php.js';
import { extractYamlGraph } from '../src/graph/yaml.js';
import { extractGraph, isGraphEligibleDocument } from '../src/graph/index.js';
import type { NormalizedDocument } from '../src/types.js';

function document(file: string, content: string): NormalizedDocument {
  return {
    id: documentId('drupal_core_11', '11.4', file), sourceKey: 'drupal_core_11', sourceType: 'core_code',
    authority: 100, project: 'drupal', drupalVersion: '11.4', title: file,
    repositoryPath: file, mimeType: 'text/plain', status: 'current', content, contentHash: contentHash(content),
  };
}

test('PHP AST extraction records declarations and confidence-scored relations', () => {
  const result = extractPhpGraph(document('core/modules/example/src/Example.php', `<?php
namespace Drupal\\example;
use Drupal\\Core\\Plugin\\PluginBase;
#[Block(id: 'example')]
class Example extends PluginBase implements ExampleInterface {
  use ExampleTrait;
  public function __construct(HelperInterface $helper) {}
  public function build(): array { return new Helper(); }
  public static function getSubscribedEvents(): array { return ['example.event' => 'onExample']; }
  public function invoke($moduleHandler, $dispatcher): void {
    $moduleHandler->invokeAll('help', []);
    $dispatcher->dispatch(new ExampleEvent(), ExampleEvents::EXAMPLE);
  }
}
function example_help() {}
function hook_help() {}
`));
  assert.deepEqual(result.errors, []);
  assert.ok(result.entities.some(entity => entity.kind === 'class' && entity.canonicalName === 'Drupal\\example\\Example'));
  assert.ok(result.entities.some(entity => entity.kind === 'method' && entity.canonicalName.endsWith('::build')));
  assert.ok(result.relations.some(relation => relation.predicate === 'extends' && relation.confidence === 0.9));
  assert.ok(result.relations.some(relation => relation.predicate === 'uses_trait' && relation.confidence === 0.9));
  assert.ok(result.relations.some(relation => relation.predicate === 'implements_hook' && relation.confidence === 0.75));
  assert.ok(result.entities.some(entity => entity.kind === 'hook' && entity.shortName === 'hook_help'));
  assert.ok(result.relations.some(relation => relation.predicate === 'invokes_hook' && relation.unresolvedTarget === 'hook_help'));
  assert.ok(result.relations.some(relation => relation.predicate === 'injects' && relation.confidence === 0.9));
  assert.ok(result.relations.some(relation => relation.predicate === 'subscribes_to' && relation.confidence === 0.9));
  assert.ok(result.relations.some(relation => relation.predicate === 'dispatches' && relation.confidence === 0.9));
});

test('PHP 8.5 parenthesized clone expressions parse without source rewriting', () => {
  const result = extractPhpGraph(document('core/lib/Drupal/Core/Example.php', `<?php
namespace Drupal\\Core;
final class Example {
  public function copy(object $value): object { return clone($value); }
}
`));
  assert.deepEqual(result.errors, []);
  assert.ok(result.entities.some(entity => entity.canonicalName === 'Drupal\\Core\\Example::copy'));
});

test('CI YAML remains searchable text but is excluded from semantic graph parsing', () => {
  const ci = document('.gitlab-ci.yml', `variables:\n  VALUE: one\nvariables:\n  VALUE: two\n`);
  assert.equal(isGraphEligibleDocument(ci), false);
  assert.deepEqual(extractGraph(ci), { entities: [], relations: [], errors: [] });
});

test('non-definition YAML stays text-only and mints no entities', () => {
  const stray = document('core/tests/fixtures/random-file.yml', `parameters:\n  job: build\n`);
  assert.equal(isGraphEligibleDocument(stray), false);
  assert.deepEqual(extractGraph(stray), { entities: [], relations: [], errors: [] });
  const infoFile = document('core/modules/example/example.info.yml', `name: Example\ndependencies:\n  - drupal:node\n`);
  assert.equal(isGraphEligibleDocument(infoFile), false);
  assert.deepEqual(extractYamlGraph(infoFile), { entities: [], relations: [], errors: [] });
});

test('SDC component definitions extract one component entity with prop and requires edges', () => {
  const result = extractYamlGraph(document('core/themes/example/components/pager/pager.component.yml', `$schema: https://git.drupalcode.org/project/drupal/-/raw/HEAD/core/assets/schemas/v1/metadata.schema.json
name: Pager
status: stable
props:
  type: object
  required:
    - heading_id
  properties:
    heading_id:
      type: string
      title: Pagination heading ID
    items:
      type: Drupal\\Core\\Template\\Attribute
      title: Items
slots:
  pages:
    title: Pages
requires:
  drupal/core: '>=10.2'
`));
  assert.deepEqual(result.errors, []);
  const component = result.entities.find(entity => entity.kind === 'component');
  assert.ok(component && component.shortName === 'pager' && component.canonicalName === 'drupal:component:pager');
  // Exactly one component per file: `name`/`status`/`props` are fields, not entities.
  assert.equal(result.entities.length, 1);
  assert.ok(result.relations.some(relation => relation.predicate === 'defines_property' && relation.unresolvedTarget === 'pager#heading_id:string'));
  assert.ok(result.relations.some(relation => relation.predicate === 'defines_property' && relation.unresolvedTarget === 'pager#items:Drupal\\Core\\Template\\Attribute'));
  assert.ok(result.relations.some(relation => relation.predicate === 'references' && relation.unresolvedTarget === 'drupal/core' && relation.confidence === 0.75));
  // Slots are not props: no defines_property edge for them.
  assert.ok(!result.relations.some(relation => relation.unresolvedTarget?.includes('#pages')));
});

test('config schema definitions extract config_schema entities per config prefix with mapping-key edges', () => {
  const result = extractYamlGraph(document('core/modules/system/config/schema/system.schema.yml', `system.site:
  type: config_object
  label: 'Basic site configuration'
  mapping:
    name:
      type: label
    slogan:
      type: label
system.maintenance:
  type: config_object
  mapping:
    message:
      type: text
`));
  assert.deepEqual(result.errors, []);
  assert.ok(result.entities.some(entity => entity.kind === 'config_schema' && entity.shortName === 'system.site' && entity.canonicalName === 'drupal:config_schema:system.site'));
  assert.ok(result.entities.some(entity => entity.kind === 'config_schema' && entity.shortName === 'system.maintenance'));
  assert.ok(result.relations.some(relation => relation.predicate === 'defines_property' && relation.unresolvedTarget === 'system.site#name' && relation.confidence === 0.9));
  assert.ok(result.relations.some(relation => relation.predicate === 'defines_property' && relation.unresolvedTarget === 'system.maintenance#message'));
});

test('Drupal YAML extraction records services, injection, tags, routes, and handlers', () => {
  const services = extractYamlGraph(document('core/modules/example/example.services.yml', `services:
  class: Drupal\\example\\ExampleService
  arguments: ['@entity_type.manager']
  tags:
    - { name: event_subscriber }
`));
  assert.deepEqual(services.errors, []);
  assert.ok(services.entities.some(entity => entity.kind === 'service'));
  assert.ok(services.relations.some(relation => relation.predicate === 'injects' && relation.confidence === 1));
  assert.ok(services.relations.some(relation => relation.predicate === 'tagged_with' && relation.confidence === 1));

  const routes = extractYamlGraph(document('core/modules/example/example.routing.yml', `example.page:
  path: /example
  defaults:
    _controller: Drupal\\example\\Controller\\ExampleController::page
  requirements:
    _permission: access content
`));
  assert.ok(routes.entities.some(entity => entity.kind === 'route'));
  assert.ok(routes.relations.some(relation => relation.predicate === 'handled_by' && relation.confidence === 1));
  assert.ok(routes.relations.some(relation => relation.predicate === 'references' && relation.confidence === 0.75));
});
