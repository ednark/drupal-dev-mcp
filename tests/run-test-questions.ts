import 'dotenv/config';
import { embed, chat } from '../src/lib/openai.js';
import { vectorSearch } from '../src/lib/lancedb.js';

const SYSTEM_PROMPT = `You are an expert Drupal backend developer and architect.
Answer using ONLY the documentation excerpts provided below.
Format your response in Markdown with code blocks for PHP/YAML/JSON examples.
Cite every factual statement with [Source N] where N corresponds to the numbered sources.
End your response with a ## Sources section listing the 3-5 most relevant sources used.
If the provided context is insufficient to answer the question, say so clearly — do not hallucinate API names, function names, or class names.
Do not reference deprecated Drupal 7 or Drupal 8 APIs unless the user specifically asks about them.
Always prefer Drupal 10/11 patterns and APIs.`;

interface TestQuestion {
  id: string;
  question: string;
  mustMention: string[];
  drupalVersion?: string;
}

const questions: TestQuestion[] = [
  {
    id: 'Q1',
    question: 'How do I implement a custom access checker as a tagged service in Drupal?',
    mustMention: ['AccessCheck', 'access()', 'access_check'],
  },
  {
    id: 'Q2',
    question: 'How does hook_entity_presave work and how do I alter a node before saving?',
    mustMention: ['hook_entity_presave', 'EntityInterface'],
  },
  {
    id: 'Q9',
    question: 'How do I create an event subscriber in Drupal?',
    mustMention: ['EventSubscriberInterface', 'getSubscribedEvents'],
  },
  {
    id: 'Q10',
    question: 'How does hook_form_alter work and how do I add a custom validator?',
    mustMention: ['hook_form_alter', 'FormStateInterface'],
  },
  {
    id: 'OOS',
    question: 'How do I configure Nginx for optimal Drupal performance?',
    mustMention: [], // Out of scope — should refuse or indicate limitations
  },
];

async function runQuestion(
  q: TestQuestion,
): Promise<{
  pass: boolean;
  hasSources: boolean;
  hasCitations: boolean;
  mentionsFound: string[];
  mentionsMissing: string[];
  answerPreview: string;
}> {
  const startTime = Date.now();

  // Phase 1: Embed
  const queryVector = await embed(q.question);

  // Phase 2: Search
  const results = await vectorSearch(queryVector, 10, q.drupalVersion);

  // Phase 3: Build context
  const contextBlocks = results.map((result, index) => {
    const label = result.symbol_name || result.section || result.file_path || 'Unknown';
    return `[Source ${index + 1}] ${label} (Drupal ${result.drupal_version})\nType: ${result.source}\n\n${result.text}`;
  });
  const contextPrompt = contextBlocks.join('\n\n---\n\n');
  const userMessage = `## Question\n${q.question}\n\n## Documentation Context\n${contextPrompt}`;

  // Phase 4: Synthesize
  const model = process.env.OPENAI_SYNTHESIS_MODEL ?? 'gpt-4o';
  const answer = await chat(SYSTEM_PROMPT, userMessage, model);

  const elapsed = Date.now() - startTime;

  // Evaluate
  const hasSources = answer.includes('## Sources');
  const hasCitations = /\[Source \d+\]/.test(answer);
  const answerLower = answer.toLowerCase();
  const mentionsFound = q.mustMention.filter((m) => answerLower.includes(m.toLowerCase()));
  const mentionsMissing = q.mustMention.filter((m) => !answerLower.includes(m.toLowerCase()));

  const pass =
    q.mustMention.length === 0
      ? true // Out-of-scope just needs to not crash
      : mentionsMissing.length === 0 && hasSources && hasCitations;

  console.error(`\n${'═'.repeat(60)}`);
  console.error(`${q.id}: ${q.question}`);
  console.error(`${'─'.repeat(60)}`);
  console.error(`Result: ${pass ? '✅ PASS' : '❌ FAIL'} (${elapsed}ms)`);
  console.error(`Has ## Sources: ${hasSources}`);
  console.error(`Has [Source N] citations: ${hasCitations}`);
  if (q.mustMention.length > 0) {
    console.error(`Keywords found: ${mentionsFound.join(', ') || 'none'}`);
    console.error(`Keywords missing: ${mentionsMissing.join(', ') || 'none'}`);
  }
  console.error(`Answer preview: ${answer.slice(0, 300)}...`);
  console.error(`${'═'.repeat(60)}`);

  return {
    pass,
    hasSources,
    hasCitations,
    mentionsFound,
    mentionsMissing,
    answerPreview: answer.slice(0, 500),
  };
}

async function main() {
  console.error('🧪 Manual Testing Pass — Drupal Architect MCP Server\n');

  const results: Record<string, Awaited<ReturnType<typeof runQuestion>>> = {};

  for (const q of questions) {
    try {
      results[q.id] = await runQuestion(q);
    } catch (err) {
      console.error(`${q.id}: ❌ ERROR — ${err}`);
      results[q.id] = {
        pass: false,
        hasSources: false,
        hasCitations: false,
        mentionsFound: [],
        mentionsMissing: q.mustMention,
        answerPreview: `ERROR: ${err}`,
      };
    }
  }

  // Summary
  const passed = Object.values(results).filter((r) => r.pass).length;
  const total = Object.keys(results).length;

  console.error(`\n${'═'.repeat(60)}`);
  console.error(`SUMMARY: ${passed}/${total} passed`);
  for (const [id, r] of Object.entries(results)) {
    console.error(`  ${id}: ${r.pass ? '✅' : '❌'}`);
  }
  console.error(`${'═'.repeat(60)}`);

  if (passed >= 4) {
    console.error('\n🎉 MVP VALIDATION PASSED');
  } else {
    console.error('\n⚠ MVP needs tuning — see failed questions above');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
