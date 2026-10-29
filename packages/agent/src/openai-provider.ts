import OpenAI from 'openai';
import type { LlmProvider, LlmRequest, LlmUsage } from './types.js';
import { QUERY_SYSTEM, keywordFallback } from './query.js';

/**
 * Output token cap per generation when the caller does not specify one.
 * Configurable because local models (Ollama etc.) are often asked to produce
 * long grounded reports on tighter hardware than hosted frontier models.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.AGENT_MAX_OUTPUT_TOKENS) || 2_000;

/**
 * Any OpenAI-compatible endpoint works (Ollama, LM Studio, vLLM, …): set
 * OPENAI_BASE_URL to its /v1 root. When a custom endpoint is configured the
 * API key becomes an accepted-any-value credential, matching how those
 * servers behave, while OpenAI itself still fails fast without a real key.
 *
 * Per-phase model routing: planning calls (query derivation, research-loop
 * planning) are low-stakes and may use a cheaper model — set
 * OPENAI_AGENT_PLAN_MODEL; it falls back to the main model.
 */
export class OpenAiLlmProvider implements LlmProvider {
  private readonly client: OpenAI;
  private readonly planModel: string;

  constructor(apiKey = process.env.OPENAI_API_KEY ?? (process.env.OPENAI_BASE_URL ? 'local-endpoint' : undefined), private readonly model = process.env.OPENAI_AGENT_MODEL ?? 'gpt-4o-mini') {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for the agent package');
    const baseURL = process.env.OPENAI_BASE_URL;
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    this.planModel = process.env.OPENAI_AGENT_PLAN_MODEL ?? this.model;
  }

  async generate(request: LlmRequest): Promise<string> {
    // OpenAI requires the literal word "json" in the messages when
    // response_format is json_object. Check the SYSTEM text only: relying on
    // the user prompt would mean untrusted corpus excerpts could satisfy (or
    // fail to satisfy) the requirement for a small local model.
    const system = request.responseFormat === 'json' && !/json/i.test(request.system)
      ? `${request.system}\n\nRespond with valid JSON.`
      : request.system;
    const response = await this.client.chat.completions.create({
      model: request.plan ? this.planModel : this.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: request.prompt }],
      max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      response_format: request.responseFormat === 'json' ? { type: 'json_object' } : { type: 'text' },
    });
    if (response.usage) {
      this.last = {
        promptTokens: response.usage.prompt_tokens ?? 0,
        completionTokens: response.usage.completion_tokens ?? 0,
        totalTokens: response.usage.total_tokens ?? 0,
      };
    }
    return response.choices[0]?.message.content?.trim() ?? '';
  }

  /**
   * Token usage of the most recent generate() call. Not thread-safe by
   * design: the MCP server serializes tool calls per session.
   */
  private last: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;

  lastUsage(): LlmUsage | null {
    return this.last ? { ...this.last, calls: 1 } : null;
  }

  async generateQuery(question: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.planModel,
      messages: [
        { role: 'system', content: QUERY_SYSTEM },
        { role: 'user', content: question },
      ],
      max_tokens: 64,
      temperature: 0,
    });
    return response.choices[0]?.message.content?.trim() ?? keywordFallback(question);
  }
}
