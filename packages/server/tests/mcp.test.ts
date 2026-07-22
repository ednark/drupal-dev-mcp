import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { KnowledgeProvider } from '@drupal-dev-mcp/knowledge';
import { createDrupalMcpServer } from '../src/server.js';

const entity = {
  id: 'ent_fixture', kind: 'class' as const, canonicalName: 'Drupal\\example\\Example', shortName: 'Example',
  project: 'drupal', drupalVersion: '11.4', status: 'current', resourceUri: 'drupal://entity/ent_fixture',
};

const provider: KnowledgeProvider = {
  async search(request) {
    return {
      query: request.query, appliedFilters: { drupalVersion: request.drupalVersion }, index: await this.getIndexStatus(),
      degradedMode: 'lexical_only',
      results: [{
        id: entity.id, resultType: 'entity', title: entity.canonicalName, score: 1, exactMatch: true,
        sourceType: 'core_code', authority: 100, project: 'drupal', drupalVersion: '11.4', status: 'current',
        compatibility: 'compatible', freshness: '2026-01-01T00:00:00.000Z',
        provenance: { sourceKey: 'drupal_core_11', sourceType: 'core_code', authority: 100 },
        resourceUri: entity.resourceUri,
      }],
    };
  },
  async getEntity(request) {
    if (request.entityId === entity.id || request.identifier === entity.canonicalName) return { status: 'found', entity, incoming: [], outgoing: [] };
    return { status: 'not_found' };
  },
  async exploreRelationships() { return { startEntity: entity, nodes: [], edges: [], truncated: false }; },
  async readResource(uri) {
    if (uri === 'drupal://index/status') return { uri, mimeType: 'application/json', text: JSON.stringify(await this.getIndexStatus()) };
    if (uri === entity.resourceUri) return { uri, mimeType: 'application/json', text: JSON.stringify({ entity }) };
    return null;
  },
  async getIndexStatus() {
    return { ready: true, schemaVersion: 1, defaultDrupalVersion: '11.4', availableDrupalVersions: ['10.6', '11.4'], counts: { entities: 1 } };
  },
};

test('MCP exposes exactly three closed-world read tools and three resource surfaces', async () => {
  const server = createDrupalMcpServer(provider);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['explore_drupal_relationships', 'get_drupal_entity', 'search_drupal']);
    for (const tool of tools.tools) {
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.equal(tool.annotations?.idempotentHint, true);
      assert.equal(tool.annotations?.openWorldHint, false);
      assert.ok(tool.inputSchema);
      assert.ok(tool.outputSchema);
    }
    const resources = await client.listResources();
    assert.deepEqual(resources.resources.map(resource => resource.uri), ['drupal://index/status']);
    const templates = await client.listResourceTemplates();
    assert.deepEqual(templates.resourceTemplates.map(template => template.uriTemplate).sort(), ['drupal://document/{id}', 'drupal://entity/{id}']);

    const result = await client.callTool({ name: 'search_drupal', arguments: { query: 'Example', mode: 'lexical' } });
    assert.equal(result.isError, undefined);
    assert.equal((result.structuredContent as { results: unknown[] }).results.length, 1);
    assert.ok(result.content.some(content => content.type === 'resource_link' && content.uri === entity.resourceUri));
    const resource = await client.readResource({ uri: 'drupal://index/status' });
    assert.equal(resource.contents[0].mimeType, 'application/json');
  } finally {
    await client.close();
    await server.close();
  }
});
