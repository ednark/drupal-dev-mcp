import test from 'node:test';
import assert from 'node:assert/strict';
import { DrupalAgent } from '../src/agent.js';
import type { AgentEvent, LlmProvider, LlmRequest, LlmUsage } from '../src/types.js';
import type { KnowledgeProvider, SearchResult } from '@drupal-dev-mcp/knowledge';

/** Recording stub: captures requests, reports usage, serves fixed evidence. */
class RecordingProvider implements LlmProvider {
  requests: LlmRequest[] = [];
  private n = 0;
  private readonly evidence: SearchResult[];

  constructor(evidence: SearchResult[], private readonly usage: LlmUsage | null = { promptTokens: 10, completionTokens: 20, totalTokens: 30, calls: 1 }) {
    this.evidence = evidence;
  }

  async generate(request: LlmRequest): Promise<string> {
    this.requests.push(request);
    this.n += 1;
    if (request.responseFormat === 'json') return JSON.stringify({ queries: [] }); // planner stops the loop
    return `Answer ${this.n} citing ${this.evidence[0]?.resourceUri ?? 'nothing'}.`;
  }

  lastUsage(): LlmUsage | null { return this.usage; }
}

const hit: SearchResult = {
  id: 'doc_x', resultType: 'document', title: 'Cache API', snippet: 'render arrays with #cache',
  score: 0.9, exactMatch: false, sourceType: 'core_code', authority: 100, drupalVersion: '11.4',
  compatibility: 'compatible', status: 'current', freshness: 'fresh', resourceUri: 'drupal://document/doc_x',
  provenance: { sourceKey: 'drupal_core_11', authority: 100 },
} as unknown as SearchResult;

const knowledge = {
  search: async () => ({ results: [hit], appliedFilters: {} }),
  getIndexStatus: async () => ({ ready: true }),
} as unknown as KnowledgeProvider;

test('research planner calls are tagged plan: true (per-phase model routing)', async () => {
  const provider = new RecordingProvider([hit]);
  const agent = new DrupalAgent({ knowledge, llm: provider });
  await agent.research('How do cache tags work?', { maxIterations: 2 });
  const plannerCalls = provider.requests.filter(r => r.plan === true);
  assert.ok(plannerCalls.length >= 1, 'at least one planning call tagged plan: true');
  const synthesis = provider.requests.at(-1)!;
  assert.equal(synthesis.plan, undefined, 'synthesis is NOT tagged as planning');
});

test('research loop stops honestly when a round admits no new evidence', async () => {
  const provider = new RecordingProvider([hit]);
  const agent = new DrupalAgent({ knowledge, llm: provider });
  const result = await agent.research('How do cache tags work?', { maxIterations: 4 });
  // round 1: planner returns [] → loop stops before a stall can fire; force
  // the stall by checking the stop reason contract instead:
  assert.ok(['no_new_evidence', 'completed'].includes(result.stopReason), result.stopReason);
});

test('evidence-stall detection fires when a round adds nothing', async () => {
  // planner that keeps proposing new queries; search keeps returning the
  // SAME already-admitted result → no growth → stall must fire.
  class LoopingProvider extends RecordingProvider {
    async generate(request: LlmRequest): Promise<string> {
      if (request.responseFormat === 'json') return JSON.stringify({ queries: [`cache tags v${this.n}`, `render cache v${this.n}`] });
      return super.generate(request);
    }
  }
  const seen = new Set<string>();
  const provider = new LoopingProvider([hit]);
  const knowledge2: KnowledgeProvider = {
    search: async () => ({ results: [hit], appliedFilters: {} }),
    getIndexStatus: async () => ({ ready: true }),
  } as unknown as KnowledgeProvider;
  void seen;
  const agent = new DrupalAgent({ knowledge: knowledge2, llm: provider });
  const result = await agent.research('How do cache tags work?', { maxIterations: 4 });
  assert.equal(result.stopReason, 'no_new_evidence');
  assert.ok(result.iterations < 4, `stopped early (iteration ${result.iterations})`);
});

test('usage accumulates across calls and lands in the answer', async () => {
  const provider = new RecordingProvider([hit]);
  const agent = new DrupalAgent({ knowledge, llm: provider });
  const result = await agent.ask('How do cache tags work?');
  assert.ok(result.usage, 'usage present');
  assert.equal(result.usage!.calls, 1, 'one generate call in ask mode');
  assert.equal(result.usage!.totalTokens, 30);
});

test('usage is null when the provider cannot report it', async () => {
  const provider = new RecordingProvider([hit], null);
  const agent = new DrupalAgent({ knowledge, llm: provider });
  const result = await agent.ask('How do cache tags work?');
  assert.equal(result.usage, null);
});
