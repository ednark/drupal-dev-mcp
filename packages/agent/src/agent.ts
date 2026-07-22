import type { SearchResult } from '@drupal-dev-mcp/knowledge';
import type { AgentAnswer, AgentOptions, AgentStopReason } from './types.js';

function evidencePrompt(question: string, evidence: SearchResult[]): string {
  return JSON.stringify({
    question,
    evidence: evidence.map(item => ({
      title: item.title,
      excerpt: item.snippet,
      resource_uri: item.resourceUri,
      canonical_url: item.canonicalUrl,
      drupal_version: item.drupalVersion,
      project: item.project,
      status: item.status,
    })),
  }, null, 2);
}

export class DrupalAgent {
  constructor(private readonly options: AgentOptions) {}

  async ask(question: string, settings: { drupalVersion?: string; limit?: number; format?: 'json' | 'markdown' } = {}): Promise<AgentAnswer> {
    const drupalVersion = settings.drupalVersion ?? '11.4';
    const input = { query: question, drupalVersion, mode: 'hybrid' as const, limit: settings.limit ?? 8 };
    this.options.onEvent?.({ type: 'tool_call', tool: 'search', input, iteration: 1 });
    const found = await this.options.knowledge.search(input);
    found.results.forEach(item => this.options.onEvent?.({ type: 'evidence_admitted', resourceUri: item.resourceUri, score: item.score, iteration: 1 }));
    this.options.onEvent?.({ type: 'iteration_complete', iteration: 1, admitted: found.results.length });
    if (found.results.length === 0) return this.finish(question, drupalVersion, '', [], 1, 'insufficient_evidence');
    const answer = await this.options.llm.generate({
      system: 'Answer only from the supplied Drupal evidence. Cite claims with the exact drupal:// resource URI. If evidence is insufficient, say so explicitly. Do not use outside knowledge.',
      prompt: evidencePrompt(question, found.results),
      responseFormat: settings.format === 'json' ? 'json' : 'text',
    });
    return this.finish(question, drupalVersion, answer, found.results, 1, answer ? 'completed' : 'insufficient_evidence');
  }

  async research(question: string, settings: {
    drupalVersion?: string; maxIterations?: number; queriesPerIteration?: number;
    evidenceBudget?: number; format?: 'json' | 'markdown';
  } = {}): Promise<AgentAnswer> {
    const drupalVersion = settings.drupalVersion ?? '11.4';
    const maxIterations = Math.min(6, Math.max(1, settings.maxIterations ?? 4));
    const evidenceBudget = Math.min(100, Math.max(5, settings.evidenceBudget ?? 24));
    const admitted = new Map<string, SearchResult>();
    let queries = [question];
    let iterations = 0;
    let reason: AgentStopReason = 'max_iterations';
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      iterations = iteration;
      for (const query of queries.slice(0, settings.queriesPerIteration ?? 2)) {
        const input = { query, drupalVersion, mode: 'hybrid' as const, limit: 8 };
        this.options.onEvent?.({ type: 'tool_call', tool: 'search', input, iteration });
        const result = await this.options.knowledge.search(input);
        for (const item of result.results) {
          if (admitted.size >= evidenceBudget) { reason = 'evidence_budget'; break; }
          if (!admitted.has(item.resourceUri)) {
            admitted.set(item.resourceUri, item);
            this.options.onEvent?.({ type: 'evidence_admitted', resourceUri: item.resourceUri, score: item.score, iteration });
          }
        }
      }
      this.options.onEvent?.({ type: 'iteration_complete', iteration, admitted: admitted.size });
      if (reason === 'evidence_budget' || iteration === maxIterations) break;
      const queryJson = await this.options.llm.generate({
        system: 'Generate focused follow-up search queries using only the question and evidence inventory. Return JSON {"queries":[...]}.',
        prompt: evidencePrompt(question, [...admitted.values()]), responseFormat: 'json', maxOutputTokens: 400,
      });
      try {
        const parsed = JSON.parse(queryJson) as { queries?: unknown[] };
        queries = (parsed.queries ?? []).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      } catch { queries = []; }
      if (queries.length === 0) { reason = admitted.size ? 'completed' : 'insufficient_evidence'; break; }
    }
    if (admitted.size === 0) return this.finish(question, drupalVersion, '', [], iterations, 'insufficient_evidence');
    const answer = await this.options.llm.generate({
      system: 'Produce a Drupal research report using only supplied evidence. Cite every substantive claim with exact drupal:// resource URIs. Identify contradictions and missing evidence.',
      prompt: evidencePrompt(question, [...admitted.values()]),
      responseFormat: settings.format === 'json' ? 'json' : 'text',
    });
    return this.finish(question, drupalVersion, answer, [...admitted.values()], iterations, answer ? reason : 'insufficient_evidence');
  }

  private finish(question: string, drupalVersion: string, answer: string, evidence: SearchResult[], iterations: number, stopReason: AgentStopReason): AgentAnswer {
    this.options.onEvent?.({ type: 'stop', reason: stopReason, iterations });
    return {
      question, drupalVersion,
      answer: answer || 'Insufficient indexed evidence to answer this question.',
      evidence,
      citations: evidence.map(item => ({ resourceUri: item.resourceUri, canonicalUrl: item.canonicalUrl, title: item.title })),
      iterations, stopReason,
      insufficientEvidence: stopReason === 'insufficient_evidence',
    };
  }
}
