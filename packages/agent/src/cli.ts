#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import { getDefaultIndexRoot, SqliteKnowledgeProvider } from '@drupal-dev-mcp/knowledge';
import { DrupalAgent } from './agent.js';
import { OpenAiLlmProvider } from './openai-provider.js';

async function run(mode: 'ask' | 'research', question: string, options: Record<string, string>): Promise<void> {
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const knowledge = await SqliteKnowledgeProvider.open(getDefaultIndexRoot(repoRoot));
  try {
    const events: unknown[] = [];
    const agent = new DrupalAgent({ knowledge, llm: new OpenAiLlmProvider(), onEvent: event => events.push(event) });
    const result = mode === 'ask'
      ? await agent.ask(question, { drupalVersion: options.version, format: options.format as 'json' | 'markdown' })
      : await agent.research(question, { drupalVersion: options.version, format: options.format as 'json' | 'markdown', maxIterations: Number(options.maxIterations) });
    if (options.format === 'json') console.log(JSON.stringify({ ...result, events }, null, 2));
    else console.log(`${result.answer}\n\n## Evidence\n${result.citations.map(citation => `- ${citation.title}: ${citation.resourceUri}${citation.canonicalUrl ? ` (${citation.canonicalUrl})` : ''}`).join('\n')}`);
  } finally { knowledge.close(); }
}

const program = new Command().name('drupal-agent').version('0.2.0');
program.command('ask').argument('<question>').option('--drupal-version <version>', 'Drupal version', '11.4').option('--format <format>', 'json or markdown', 'markdown').action((question, options) => run('ask', question, options));
program.command('research').argument('<question>').option('--drupal-version <version>', 'Drupal version', '11.4').option('--max-iterations <number>', 'Iteration limit', '4').option('--format <format>', 'json or markdown', 'markdown').action((question, options) => run('research', question, options));
program.parseAsync().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
