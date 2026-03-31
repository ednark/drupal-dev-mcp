import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { validateConfig } from '../src/config.js';
import { chat } from '../src/lib/openai.js';
import {
  buildToolInventory,
  scoreToolInventory,
  createMarkdownReport,
  AssessmentBundle,
} from '../src/lib/research-tools/index.js';

interface CliOptions {
  outputDir: string;
  llmSummary: boolean;
}

const DEFAULT_OUTPUT_DIR = path.join('data', 'cache', 'research-tools');

async function main(): Promise<void> {
  const options = parseArgs();
  const rootDir = process.cwd();
  const outputDir = path.resolve(rootDir, options.outputDir);

  console.error('[research-tools] Building tool inventory...');
  const inventory = await buildToolInventory(rootDir);

  console.error('[research-tools] Scoring inventory...');
  const bundle = scoreToolInventory(inventory);

  console.error('[research-tools] Preparing outputs...');
  await mkdir(outputDir, { recursive: true });

  const inventoryPath = path.join(outputDir, 'inventory.json');
  const evaluationPath = path.join(outputDir, 'evaluation.json');
  const recommendationsPath = path.join(outputDir, 'recommendations.md');

  let llmSummary: string | null = null;
  if (options.llmSummary) {
    llmSummary = await maybeSummarize(bundle);
  }

  await writeFile(inventoryPath, JSON.stringify(inventory, null, 2));

  const evaluationPayload = {
    generatedAt: bundle.generatedAt,
    assessments: bundle.assessments,
    duplicates: bundle.duplicates,
    summary: llmSummary,
  } satisfies AssessmentBundle & { summary: string | null };

  await writeFile(evaluationPath, JSON.stringify(evaluationPayload, null, 2));

  const markdown = createMarkdownReport(bundle, llmSummary);
  await writeFile(recommendationsPath, markdown, 'utf8');

  console.error('[research-tools] Written artifacts:');
  console.error(`  • ${relativePath(rootDir, inventoryPath)}`);
  console.error(`  • ${relativePath(rootDir, evaluationPath)}`);
  console.error(`  • ${relativePath(rootDir, recommendationsPath)}`);

  console.error('[research-tools] Complete.');
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
  console.log('Usage: npx tsx scripts/research-tools.ts [options]\n');
  console.log('Options:');
  console.log('  -o, --output <dir>    Output directory (default: data/cache/research-tools)');
  console.log('      --llm-summary     Request optional LLM-written summary (requires OPENAI_API_KEY)');
  console.log('  -h, --help            Show this help message');
}

async function maybeSummarize(bundle: AssessmentBundle): Promise<string | null> {
  try {
    validateConfig();
  } catch {
    console.error('[research-tools] Skipping LLM summary: OpenAI config missing.');
    return null;
  }

  try {
    const model = process.env.RESEARCH_TOOLS_SUMMARY_MODEL ?? 'gpt-4o-mini';
    const systemPrompt = 'You are a cautious maintenance analyst reviewing Drupal MCP tools. Summarize overlaps, boundary issues, and quick wins in concise Markdown bullets.';
    const userMessage = JSON.stringify(
      {
        generated_at: bundle.generatedAt,
        assessments: bundle.assessments.map((assessment) => ({
          id: assessment.id,
          name: assessment.name,
          action: assessment.recommendation,
          overall: assessment.scorecard.overall,
          job_clarity: assessment.scorecard.jobClarity,
          boundary_clarity: assessment.scorecard.boundaryClarity,
          shared_touchpoints: assessment.sharedTouchpoints,
          rationale: assessment.rationale,
        })),
        duplicates: bundle.duplicates,
      },
      null,
      2,
    );

    const response = await chat(systemPrompt, userMessage, model);
    const trimmed = response.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    console.error('[research-tools] Failed to produce LLM summary:', error);
    return null;
  }
}

function relativePath(root: string, target: string): string {
  return path.relative(root, target) || '.';
}

main().catch((error) => {
  console.error('[research-tools] Fatal error:', error);
  process.exit(1);
});

