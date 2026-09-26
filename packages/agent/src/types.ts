import type { KnowledgeProvider, SearchResult } from '@drupal-dev-mcp/knowledge';
import type { GroundingStats } from './grounding.js';

export interface LlmRequest {
  system: string;
  prompt: string;
  responseFormat: 'text' | 'json';
  maxOutputTokens?: number;
}

export interface LlmProvider {
  generate(request: LlmRequest): Promise<string>;
}

export type AgentEvent =
  | { type: 'tool_call'; tool: 'search'; input: Record<string, unknown>; iteration: number }
  | { type: 'evidence_admitted'; resourceUri: string; score: number; iteration: number }
  | { type: 'iteration_complete'; iteration: number; admitted: number }
  | { type: 'stop'; reason: AgentStopReason; iterations: number };

export type AgentStopReason = 'completed' | 'insufficient_evidence' | 'max_iterations' | 'evidence_budget';

export interface AgentOptions {
  knowledge: KnowledgeProvider;
  llm: LlmProvider;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentAnswer {
  question: string;
  drupalVersion: string;
  answer: string;
  evidence: SearchResult[];
  citations: Array<{ resourceUri: string; canonicalUrl?: string; title: string }>;
  iterations: number;
  stopReason: AgentStopReason;
  insufficientEvidence: boolean;
  /** Mechanical grounding-density measurement of the answer prose. */
  grounding: GroundingStats;
}
