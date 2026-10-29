import type { KnowledgeProvider, SearchResult } from '@drupal-dev-mcp/knowledge';
import type { GroundingStats } from './grounding.js';

export interface LlmRequest {
  system: string;
  prompt: string;
  responseFormat: 'text' | 'json';
  maxOutputTokens?: number;
  /**
   * Marks a low-stakes planning call (query derivation, research-loop
   * planning). Providers may route these to a cheaper model
   * (OPENAI_AGENT_PLAN_MODEL) — per-phase model routing.
   */
  plan?: boolean;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Number of LLM calls that produced this usage. */
  calls: number;
}

export interface LlmProvider {
  generate(request: LlmRequest): Promise<string>;
  /**
   * Optional: token usage of the most recent generate() call, for cost
   * observability. Null when the provider cannot report usage.
   */
  lastUsage?(): LlmUsage | null;
  /**
   * Optional: generate a short index-friendly search query from a natural
   * language question. Used by the agent to keyword-rewrite its first
   * evidence round; when absent, the agent searches the raw question.
   */
  generateQuery?(question: string): Promise<string>;
}

export type AgentEvent =
  | { type: 'tool_call'; tool: 'search'; input: Record<string, unknown>; iteration: number }
  | { type: 'evidence_admitted'; resourceUri: string; score: number; iteration: number }
  | { type: 'iteration_complete'; iteration: number; admitted: number }
  | { type: 'stop'; reason: AgentStopReason; iterations: number };

export type AgentStopReason =
  | 'completed'
  | 'insufficient_evidence'
  | 'max_iterations'
  | 'evidence_budget'
  | /** A full research round admitted no new evidence: further iterations
      * would burn tokens rephrasing the same queries (loop detection). */
    'no_new_evidence';

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
  /** Token usage of the LLM calls behind this answer (cost observability). */
  usage: LlmUsage | null;
}
