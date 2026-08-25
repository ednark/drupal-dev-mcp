import OpenAI from 'openai';
import type { LlmProvider, LlmRequest } from './types.js';

export class OpenAiLlmProvider implements LlmProvider {
  private readonly client: OpenAI;

  constructor(apiKey = process.env.OPENAI_API_KEY, private readonly model = process.env.OPENAI_AGENT_MODEL ?? 'gpt-4o-mini') {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for the agent package');
    this.client = new OpenAI({ apiKey });
  }

  async generate(request: LlmRequest): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.prompt }],
      max_tokens: request.maxOutputTokens ?? 2_000,
      response_format: request.responseFormat === 'json' ? { type: 'json_object' } : { type: 'text' },
    });
    return response.choices[0]?.message.content?.trim() ?? '';
  }
}
