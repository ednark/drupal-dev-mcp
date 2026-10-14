import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkId, documentId, entityId } from '../src/ids.js';
import { constraintIncludes, isCompatible, normalizeDrupalVersion } from '../src/version.js';

test('opaque IDs are stable and namespaced', () => {
  assert.equal(entityId('drupal', '11.4', 'class', 'Drupal\\Core\\Entity\\EntityTypeManager'), entityId('drupal', '11.4', 'class', 'Drupal\\Core\\Entity\\EntityTypeManager'));
  assert.match(entityId('drupal', '11.4', 'class', 'Example'), /^ent_/);
  assert.match(documentId('core', '11.4', 'core/lib/Foo.php'), /^doc_/);
  assert.match(chunkId('doc_abc', 'class:Foo', 0, 'hash'), /^chk_/);
  assert.notEqual(entityId('drupal', '10.6', 'class', 'Example'), entityId('drupal', '11.4', 'class', 'Example'));
});

test('version labels and contrib constraints normalize consistently', () => {
  assert.equal(normalizeDrupalVersion('general').versionScope, 'agnostic');
  assert.equal(normalizeDrupalVersion('11.x').versionLine, '11.4');
  assert.equal(normalizeDrupalVersion('10.6.x').versionLine, '10.6');
  assert.equal(normalizeDrupalVersion('12.x').versionLine, '12.0');
  assert.equal(normalizeDrupalVersion('12.0.x').versionLine, '12.0');
  assert.equal(constraintIncludes('^10.3 || ^11', '11.4'), true);
  assert.equal(constraintIncludes('^10.3', '11.4'), false);
  assert.equal(isCompatible('10.6.x', '10.6'), true);
  assert.equal(isCompatible('10.6.x', '11.4'), false);
  assert.equal(isCompatible('10.6.x', '12.0'), false);
  assert.equal(isCompatible('11.4.x', '12.0'), false);
  assert.equal(isCompatible('12.0.x', '12.0'), true);
  assert.equal(isCompatible('all', '11.4'), true);
});
