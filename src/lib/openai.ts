import OpenAI from 'openai';
import { validateConfig } from '../config.js';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const config = validateConfig();
    client = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return client;
}

/**
 * Generate a single embedding vector using text-embedding-3-small (1536 dims).
 */
export async function embed(text: string): Promise<number[]> {
  const openai = getClient();
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Call OpenAI chat completion.
 */
export async function chat(
  systemPrompt: string,
  userMessage: string,
  model: string = 'gpt-4o',
): Promise<string> {
  const openai = getClient();
  const response = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 2048,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });
  return response.choices[0]?.message?.content ?? '';
}
