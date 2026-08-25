import test from 'node:test';
import assert from 'node:assert/strict';
import type { KnowledgeProvider, SearchResult } from '@drupal-dev-mcp/knowledge';
import { DrupalAgent } from '../src/agent.js';
import type { AgentEvent, LlmProvider, LlmRequest } from '../src/types.js';

function evidence(id = 'doc_fixture'): SearchResult {
  return {
    id, resultType: 'document', title: `Evidence ${id}`, snippet: 'Use dependency injection.', score: 0.9,
    exactMatch: false, sourceType: 'official_guide', authority: 95, project: 'drupal', drupalVersion: '11.4',
    compatibility: 'compatible', freshness: '2026-01-01T00:00:00.000Z',
    provenance: { sourceKey: 'developer_guides', sourceType: 'official_guide', authority: 95 },
    status: 'current', canonicalUrl: 'https://www.drupal.org/docs/example', resourceUri: `drupal://document/${id}`,
  };
}

function provider(results: SearchResult[]): KnowledgeProvider {
  return {
    async search() { return { query: 'q', appliedFilters: {}, index: await this.getIndexStatus(), results }; },
    async getEntity() { return { status: 'not_found' }; },
    async getEntities() { return { results: [] }; },
    async exploreRelationships() { throw new Error('not used'); },
    async readResource() { return null; },
    async getIndexStatus() { return { ready: true, schemaVersion: 1, defaultDrupalVersion: '11.4', availableDrupalVersions: ['11.4'], counts: {} }; },
  };
}

class RecordingLlm implements LlmProvider {
  readonly requests: LlmRequest[] = [];
  constructor(private readonly responses: string[]) {}
  async generate(request: LlmRequest): Promise<string> { this.requests.push(request); return this.responses.shift() ?? ''; }
}

test('ask admits only provider evidence and emits stable citations', async () => {
  const llm = new RecordingLlm(['Dependency injection is recommended [drupal://document/doc_fixture].']);
  const events: AgentEvent[] = [];
  const agent = new DrupalAgent({ knowledge: provider([evidence()]), llm, onEvent: event => events.push(event) });
  const answer = await agent.ask('How should a service be accessed?', { drupalVersion: '11.4' });
  assert.equal(answer.stopReason, 'completed');
  assert.equal(answer.citations[0].resourceUri, 'drupal://document/doc_fixture');
  assert.match(llm.requests[0].prompt, /drupal:\/\/document\/doc_fixture/);
  assert.equal(events.filter(event => event.type === 'evidence_admitted').length, 1);
});

test('ask does not invoke the LLM when evidence is insufficient', async () => {
  const llm = new RecordingLlm([]);
  const answer = await new DrupalAgent({ knowledge: provider([]), llm }).ask('Unknown topic');
  assert.equal(answer.insufficientEvidence, true);
  assert.equal(answer.stopReason, 'insufficient_evidence');
  assert.equal(llm.requests.length, 0);
});

test('research observes iteration and evidence budgets', async () => {
  const llm = new RecordingLlm(['{"queries":["follow-up"]}', 'Grounded report [drupal://document/doc_fixture].']);
  const events: AgentEvent[] = [];
  const agent = new DrupalAgent({ knowledge: provider([evidence()]), llm, onEvent: event => events.push(event) });
  const answer = await agent.research('Architecture?', { maxIterations: 2, evidenceBudget: 5 });
  assert.equal(answer.iterations, 2);
  assert.equal(answer.stopReason, 'max_iterations');
  assert.ok(events.some(event => event.type === 'iteration_complete' && event.iteration === 2));
});
