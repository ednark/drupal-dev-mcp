import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { EntityBatchItem, KnowledgeProvider } from '@drupal-dev-mcp/knowledge';
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
  async getEntities(request) {
    const results: EntityBatchItem[] = [];
    for (const entityId of request.entityIds) {
      const response = await this.getEntity({ entityId });
      results.push(response.entity ? { entityId, status: 'found', entity: response.entity, incoming: [], outgoing: [] } : { entityId, status: 'not_found' });
    }
    return { results };
  },
  async exploreRelationships() { return { startEntity: entity, nodes: [], edges: [], truncated: false }; },
  async readResource(uri) {
    if (uri === 'drupal://index/status') return { uri, mimeType: 'application/json', text: JSON.stringify(await this.getIndexStatus()) };
    if (uri === entity.resourceUri) return { uri, mimeType: 'application/json', text: JSON.stringify({ entity }) };
    if (uri === 'drupal://document/doc_fixture') return { uri, mimeType: 'text/plain', text: '# Fixture document\n\nEvidence text.' };
    return null;
  },
  async getIndexStatus() {
    return { ready: true, schemaVersion: 1, defaultDrupalVersion: '11.4', availableDrupalVersions: ['10.6', '11.4'], counts: { entities: 1 } };
  },
};

test('MCP exposes exactly seven closed-world read tools and three resource surfaces', async () => {
  const server = createDrupalMcpServer(provider);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), [
      'ask_a_drupal_expert', 'explore_drupal_relationships', 'get_drupal_document', 'get_drupal_entities', 'get_drupal_entity', 'get_index_status', 'search_drupal',
    ]);
    for (const tool of tools.tools) {
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.ok(tool.inputSchema);
      assert.ok(tool.outputSchema);
    }
    const retrievalTools = tools.tools.filter(tool => tool.name !== 'ask_a_drupal_expert');
    for (const tool of retrievalTools) {
      assert.equal(tool.annotations?.idempotentHint, true);
      assert.equal(tool.annotations?.openWorldHint, false);
    }
    const resources = await client.listResources();
    assert.deepEqual(resources.resources.map(resource => resource.uri), ['drupal://index/status']);
    const templates = await client.listResourceTemplates();
    assert.deepEqual(templates.resourceTemplates.map(template => template.uriTemplate).sort(), ['drupal://document/{id}', 'drupal://entity/{id}']);

    const result = await client.callTool({ name: 'search_drupal', arguments: { query: 'Example', mode: 'lexical', snippet_max_chars: 200 } });
    assert.equal(result.isError, undefined);
    assert.equal((result.structuredContent as { results: unknown[] }).results.length, 1);
    assert.ok(result.content.some(content => content.type === 'resource_link' && content.uri === entity.resourceUri));
    const textContent = result.content.find(content => content.type === 'text');
    assert.ok(textContent && textContent.type === 'text' && !textContent.text.includes('\n'), 'text fallback is compact JSON');

    const status = await client.callTool({ name: 'get_index_status', arguments: {} });
    assert.equal((status.structuredContent as { ready: boolean }).ready, true);

    const batch = await client.callTool({ name: 'get_drupal_entities', arguments: { entity_ids: [entity.id, 'ent_missing'] } });
    const batchResults = (batch.structuredContent as { results: Array<{ entityId: string; status: string }> }).results;
    assert.deepEqual(batchResults.map(item => [item.entityId, item.status]), [[entity.id, 'found'], ['ent_missing', 'not_found']]);
    assert.ok(batch.content.some(content => content.type === 'resource_link' && content.uri === entity.resourceUri));

    const document = await client.callTool({ name: 'get_drupal_document', arguments: { document_id: 'doc_fixture' } });
    assert.equal((document.structuredContent as { status: string }).status, 'found');
    assert.match((document.structuredContent as { text: string }).text, /Evidence text\./);
    const missingDocument = await client.callTool({ name: 'get_drupal_document', arguments: { document_id: 'doc_missing' } });
    assert.equal((missingDocument.structuredContent as { status: string }).status, 'not_found');

    const resource = await client.readResource({ uri: 'drupal://index/status' });
    assert.equal(resource.contents[0].mimeType, 'application/json');

    const priorKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const expert = await client.callTool({ name: 'ask_a_drupal_expert', arguments: { question: 'Where do style changes live?' } });
      assert.equal((expert.structuredContent as { status: string }).status, 'unavailable');
    } finally {
      if (priorKey !== undefined) process.env.OPENAI_API_KEY = priorKey;
    }
  } finally {
    await client.close();
    await server.close();
  }
});
