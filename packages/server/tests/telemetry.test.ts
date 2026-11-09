import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTelemetry } from '../src/telemetry.js';
import { createDrupalMcpServer } from '../src/server.js';
import type { KnowledgeProvider } from '@drupal-dev-mcp/knowledge';

function tempLog(): string {
  return join(mkdtempSync(join(tmpdir(), 'drupal-dev-mcp-telemetry-')), 'tool-calls.jsonl');
}

function readLines(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
}

/** Minimal fixture provider: one search hit, enough for the tool contract. */
const provider = {
  async search(request: { query: string }) {
    return {
      query: request.query,
      appliedFilters: {},
      index: { ready: true },
      results: [{
        id: 'ent_fixture', resultType: 'entity', title: 'Example', score: 0.9, exactMatch: true,
        sourceType: 'core_code', authority: 100, drupalVersion: '11.4', status: 'current',
        compatibility: 'compatible', freshness: '2026-01-01T00:00:00.000Z',
        provenance: {}, resourceUri: 'drupal://entity/ent_fixture',
      }],
    };
  },
  async getEntity() { return { status: 'not_found' }; },
  async getEntities() { return { results: [] }; },
  async exploreRelationships() { return { startEntity: {}, nodes: [], edges: [], truncated: false }; },
  async readResource() { return null; },
  async getIndexStatus() { return { ready: true, schemaVersion: 1, defaultDrupalVersion: '11.4', availableDrupalVersions: ['10.6', '11.4', '12.0'], counts: {} }; },
} as unknown as KnowledgeProvider;

test('instrument records one JSONL line with args and mechanical outcome', async () => {
  const logFile = tempLog();
  const telemetry = createTelemetry({ logFile, sessionId: 'ses_test' });
  const wrapped = telemetry.instrument('search_drupal', async (args: { query: string }) => {
    return {
      structuredContent: {
        status: 'ok',
        results: [
          { id: 'ent_a', title: 'A', score: 0.9 },
          { id: 'ent_b', title: 'B', score: 0.5 },
        ],
      },
    };
  });
  await wrapped({ query: 'hook_entity_presave' }, {});

  assert.equal(existsSync(logFile), true, 'log file written');
  const [record] = readLines(logFile);
  assert.equal(record.sessionId, 'ses_test');
  assert.equal(record.tool, 'search_drupal');
  assert.equal(record.ok, true);
  assert.deepEqual(record.args, { query: 'hook_entity_presave' });
  const outcome = record.outcome as Record<string, unknown>;
  assert.equal(outcome.resultCount, 2);
  assert.equal(outcome.topScore, 0.9);
  assert.deepEqual((outcome.topHits as unknown[]).length, 2);
  assert.ok(typeof record.durationMs === 'number');
  assert.ok(typeof record.ts === 'string');
});

test('instrument rethrows handler errors and records ok:false', async () => {
  const logFile = tempLog();
  const telemetry = createTelemetry({ logFile });
  const wrapped = telemetry.instrument('search_drupal', async () => {
    throw new Error('index closed');
  });
  await assert.rejects(() => wrapped({}, {}));
  const [record] = readLines(logFile);
  assert.equal(record.ok, false);
  assert.match(record.error as string, /index closed/);
});

test('DRUPAL_DEV_MCP_TELEMETRY=off disables by default; explicit options.win', async () => {
  const prior = process.env.DRUPAL_DEV_MCP_TELEMETRY;
  process.env.DRUPAL_DEV_MCP_TELEMETRY = 'off';
  try {
    const disabled = createTelemetry();
    assert.equal(disabled.enabled, false);
    const logFile = tempLog();
    await disabled.instrument('search_drupal', async () => 'ok')({}, {});
    assert.equal(existsSync(logFile), false, 'no file written when disabled via env');

    const forced = createTelemetry({ enabled: true, logFile });
    assert.equal(forced.enabled, true);
  } finally {
    if (prior === undefined) delete process.env.DRUPAL_DEV_MCP_TELEMETRY;
    else process.env.DRUPAL_DEV_MCP_TELEMETRY = prior;
  }
});

test('server integration: tool calls are logged; enabled:false writes nothing', async () => {
  const logFile = tempLog();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const server = createDrupalMcpServer(provider, { logFile });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await client.callTool({ name: 'search_drupal', arguments: { query: 'EntityTypeManagerInterface' } });
    const [record] = readLines(logFile);
    assert.equal(record.tool, 'search_drupal');
    assert.deepEqual((record.args as Record<string, unknown>).query, 'EntityTypeManagerInterface');
    assert.equal((record.outcome as Record<string, unknown>).resultCount, 1);
  } finally {
    await Promise.all([server.close(), client.close()]);
  }

  const quietFile = tempLog();
  const quietServer = createDrupalMcpServer(provider, { enabled: false });
  const [quietClientTransport, quietServerTransport] = InMemoryTransport.createLinkedPair();
  const quietClient = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([quietServer.connect(quietServerTransport), quietClient.connect(quietClientTransport)]);
  try {
    await quietClient.callTool({ name: 'search_drupal', arguments: { query: 'x' } });
    assert.equal(existsSync(quietFile), false, 'no telemetry when disabled');
  } finally {
    await Promise.all([quietServer.close(), quietClient.close()]);
  }
});
