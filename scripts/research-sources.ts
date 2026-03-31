import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { validateConfig } from '../src/config.js';
import {
  buildInventory,
  scoreInventory,
  createMarkdownReport,
  summarizeUnmapped,
  AssessmentBundle,
} from '../src/lib/research-sources/index.js';
import { chat } from '../src/lib/openai.js';

interface CliOptions {
  outputDir: string;
  llmSummary: boolean;
}

const DEFAULT_OUTPUT_DIR = path.join('data', 'cache', 'research-sources');

async function main(): Promise<void> {
  const options = parseArgs();
  const rootDir = process.cwd();
  const outputDir = path.resolve(rootDir, options.outputDir);

  console.error('[research-sources] Building inventory...');
  const inventory = await buildInventory(rootDir);
  const unmapped = summarizeUnmapped(inventory.unmappedArtifacts);

  console.error('[research-sources] Scoring inventory...');
  const bundle = scoreInventory(inventory);

  console.error('[research-sources] Preparing outputs...');
  await mkdir(outputDir, { recursive: true });

  const discoveryPath = path.join(outputDir, 'discovery.json');
  const evaluationPath = path.join(outputDir, 'evaluation.json');
  const recommendationsPath = path.join(outputDir, 'recommendations.md');

  let llmSummary: string | null = null;
  if (options.llmSummary) {
    llmSummary = await maybeSummarize(bundle);
  }

  await writeFile(discoveryPath, JSON.stringify(inventory, null, 2));

  const evaluationPayload = {
    generatedAt: bundle.generatedAt,
    assessments: bundle.assessments,
    summary: llmSummary,
    unmappedArtifacts: inventory.unmappedArtifacts,
  } satisfies AssessmentBundle & {
    summary: string | null;
    unmappedArtifacts: typeof inventory.unmappedArtifacts;
  };

  await writeFile(evaluationPath, JSON.stringify(evaluationPayload, null, 2));

  const markdown = createMarkdownReport(bundle, llmSummary);
  await writeFile(recommendationsPath, markdown, 'utf8');

  console.error('[research-sources] Written artifacts:');
  console.error(`  • ${relativePath(rootDir, discoveryPath)}`);
  console.error(`  • ${relativePath(rootDir, evaluationPath)}`);
  console.error(`  • ${relativePath(rootDir, recommendationsPath)}`);

  if (unmapped.length > 0) {
    console.error('[research-sources] Unmapped artifacts detected:');
    for (const entry of unmapped) {
      console.error(`  - ${entry}`);
    }
  } else {
    console.error('[research-sources] No unmapped fetch/parse/verify artifacts.');
  }

  console.error('[research-sources] Complete.');
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let outputDir = DEFAULT_OUTPUT_DIR;
  let llmSummary = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--output' || arg === '-o') {
      const next = args[i + 1];
      if (!next) {
        throw new Error('--output flag requires a directory path');
      }
      outputDir = next;
      i += 1;
      continue;
    }
    if (arg === '--llm-summary') {
      llmSummary = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { outputDir, llmSummary };
}

function printHelp(): void {
  console.log('Usage: npx tsx scripts/research-sources.ts [options]\n');
  console.log('Options:');
  console.log('  -o, --output <dir>    Output directory (default: data/cache/research-sources)');
  console.log('      --llm-summary     Request optional LLM-written summary (requires OPENAI_API_KEY)');
  console.log('  -h, --help            Show this help message');
}

async function maybeSummarize(bundle: AssessmentBundle): Promise<string | null> {
  try {
    validateConfig();
  } catch (error) {
    console.error('[research-sources] Skipping LLM summary: OpenAI config missing.');
    return null;
  }

  try {
    const model = process.env.RESEARCH_SOURCES_SUMMARY_MODEL ?? 'gpt-4o-mini';
    const systemPrompt = 'You are a meticulous research maintenance analyst for Drupal documentation sources. Write a concise summary of the current recommendation set using markdown bullet points. Highlight notable adds, keeps, reviews, or deprioritizations.';
    const userMessage = JSON.stringify(
      {
        generated_at: bundle.generatedAt,
        assessments: bundle.assessments.map((assessment) => ({
          id: assessment.id,
          name: assessment.name,
          action: assessment.recommendation,
          overall: assessment.scorecard.overall,
          authority: assessment.scorecard.authority,
          freshness: assessment.scorecard.freshness,
          maintenance_penalty: assessment.scorecard.maintenanceCostPenalty,
          rationale: assessment.rationale,
        })),
      },
      null,
      2,
    );

    const response = await chat(systemPrompt, userMessage, model);
    const trimmed = response.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    console.error('[research-sources] Failed to produce LLM summary:', error);
    return null;
  }
}

function relativePath(root: string, target: string): string {
  return path.relative(root, target) || '.';
}

main().catch((error) => {
  console.error('[research-sources] Fatal error:', error);
  process.exit(1);
});

