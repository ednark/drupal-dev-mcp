import test from 'node:test';
import assert from 'node:assert/strict';
import { documentId, contentHash } from '../src/ids.js';
import { extractPhpGraph } from '../src/graph/php.js';
import { extractYamlGraph } from '../src/graph/yaml.js';
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
