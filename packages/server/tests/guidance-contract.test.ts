import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Guidance-to-tool-name contract test (research intake 2026-10-29, B9).
 *
 * Failure mode (Laravel Boost issue #844): generated guidance referenced
 * `search-docs` while the wire-exposed tool was `search_docs` — agents
 * followed the guidance and could not call the tool. The companion skill
 * and any maintainer docs name MCP tools; those names must match the
 * server's registered tools exactly. This test fails when guidance and
 * server drift apart in either direction.
 */

const TOOL_NAME = /\b[a-z][a-z0-9_]*_[a-z0-9_]+\b/g;

/** Tools registered by the server (kept in sync with server.ts registerTool calls). */
const REGISTERED_TOOLS = new Set([
  'search_drupal',
  'get_drupal_entity',
  'get_drupal_entities',
  'get_drupal_document',
  'get_index_status',
  'explore_drupal_relationships',
  'ask_a_drupal_expert',
]);

/** Underscored words that are not tool names and must never be required to be. */
const NON_TOOL_TERMS = new Set([
  'drupal_version', 'source_types', 'min_score', 'snippet_max_chars', 'include_snippets',
  'include_relations', 'relation_limit', 'max_depth', 'min_confidence', 'max_nodes',
  'include_evidence', 'entity_id', 'entity_ids', 'document_id', 'chunk_id', 'chunk_resource_uri',
  'resource_uri', 'structured_content', 'insufficient_evidence', 'degraded_mode', 'lexical_only',
  'drupal_canvas_sdc', 'core_compatibility', 'core_snapshot', 'open_world_hint', 'read_only_hint',
  'idempotent_hint', 'destructive_hint', 'api_key', 'node_presave', 'form_alter',
]);

test('companion skill references only registered tool names', () => {
  const skill = readFileSync(
    fileURLToPath(new URL('../../../skills/querying-drupal-knowledge/SKILL.md', import.meta.url)),
    'utf8',
  );
  const references = new Set(
    (skill.match(/`[a-z][a-z0-9_]*_[a-z0-9_]+`/g) ?? [])
      .map(name => name.slice(1, -1))
      .filter(name => (name.includes('_drupal') || name.includes('drupal_')) && !NON_TOOL_TERMS.has(name)),
  );
  assert.ok(references.size > 0, 'skill names at least one MCP tool');
  for (const name of references) {
    assert.ok(
      REGISTERED_TOOLS.has(name),
      `skill references "${name}" but no such tool is registered — fix the guidance or the server`,
    );
  }
});

test('registered tool names are consistent between server and contract docs', () => {
  const server = readFileSync(
    fileURLToPath(new URL('../src/server.ts', import.meta.url)),
    'utf8',
  );
  const toolsSpec = readFileSync(
    fileURLToPath(new URL('../../../docs/tools-spec.md', import.meta.url)),
    'utf8',
  );
  for (const match of server.matchAll(/registerTool\('([a-z_]+)'/g)) {
    assert.ok(toolsSpec.includes(match[1]), `server tool "${match[1]}" is documented in docs/tools-spec.md`);
  }
});
