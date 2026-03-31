import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { chat } from '../lib/openai.js';
import { retrieveContext } from '../lib/retrieval.js';
import path from 'path';
import fs from 'fs';

// ── Skill-Aware Query Routing ────────────────────────────────
interface Skill {
  id: string;
  title: string;
  raw_text: string;
  trimmed_text: string; // Description + Usage + Guardrails sections only
}

// Loaded at module init — maps domain slug to parsed Skill object
const skillMap = new Map<string, Skill>();

// Keyword map: domain → array of trigger phrases (lowercased)
// Build from keywords in each SKILL.md's Description/Usage/Guardrails
const SKILL_KEYWORDS: Record<string, string[]> = {
  views: ['views', 'view display', 'view block', 'contextual filter', 'exposed filter', 'views module', 'add view', 'create view', 'view page', 'views ui'],
  blocks: ['block', 'block type', 'custom block', 'block plugin', 'block layout', 'place block', 'block region', 'block visibility'],
  fields: ['field', 'field type', 'field widget', 'field formatter', 'field storage', 'add field', 'field config', 'field module', 'base field', 'bundle field'],
  nodes: ['node', 'content type', 'node bundle', 'node type', 'create content type', 'node entity', 'node form', 'article', 'page content'],
  taxonomy: ['taxonomy', 'vocabulary', 'term', 'taxonomy term', 'tag', 'category', 'taxonomy reference', 'create vocabulary'],
  theming: ['twig', 'template', 'theme', 'theme hook', 'preprocess', 'theme function', 'template suggestion', 'render array', 'theme override', 'theme registry'],
  forms: ['form api', 'form element', 'form alter', 'form validate', 'form submit', 'buildform', 'submitform', 'validateform', 'custom form', '#type', 'drupal form'],
  'text-formats-editors': ['text format', 'text editor', 'ckeditor', 'wysiwyg', 'filter format', 'allowed html', 'input format', 'editor configuration'],
  'config-parser': ['config', 'configuration', 'yaml', 'config schema', 'config entity', 'drush config', 'config export', 'config import', 'config split', 'settings.php'],
  'other-content-entities': ['custom entity', 'content entity', 'entity type', 'base fields', 'entity definition', 'entity annotation', 'entitytypemanager'],
};

async function loadSkills(): Promise<void> {
  const skillsRoot = path.join(process.cwd(), 'data/sources/drupal-best-practices/ai/skills');
  const domains = Object.keys(SKILL_KEYWORDS);
  let loaded = 0;
  for (const domain of domains) {
    const skillPath = path.join(skillsRoot, domain, 'SKILL.md');
    try {
      const raw = await fs.promises.readFile(skillPath, 'utf-8');
      // Extract title from frontmatter or first heading
      const titleMatch = raw.match(/^title:\s*(.+)$/m) ?? raw.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : domain;
      // Trimmed: keep Description, Usage, Guardrails sections; strip References/frontmatter
      const trimmed = extractTrimmedSkill(raw);
      skillMap.set(domain, { id: domain, title, raw_text: raw, trimmed_text: trimmed });
      loaded++;
    } catch {
      // SKILL.md missing for this domain — skip silently
    }
  }
  console.error(`[skill-loader] Loaded ${loaded}/${domains.length} skill domains: ${[...skillMap.keys()].join(', ')}`);
}

function extractTrimmedSkill(raw: string): string {
  // Strip YAML frontmatter
  const withoutFrontmatter = raw.replace(/^---[\s\S]*?---\n/, '');
  // Keep only sections up to (but not including) ## References
  const refIndex = withoutFrontmatter.search(/^## References/m);
  return refIndex > 0 ? withoutFrontmatter.slice(0, refIndex).trim() : withoutFrontmatter.trim();
}

function detectSkillDomain(query: string): string | null {
  const q = query.toLowerCase();
  let bestDomain: string | null = null;
  let bestScore = 0;
  for (const [domain, keywords] of Object.entries(SKILL_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (q.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }
  // Only return a domain if at least one keyword matched AND it's loaded in skillMap
  if (bestScore > 0 && skillMap.has(bestDomain!)) return bestDomain;
  return null;
}

// ── General Rules (site-building best practices) ──────────────
// Read at module load time; gracefully fall back if the file is absent.
const GENERAL_RULES_PATH = path.join(process.cwd(), 'data', 'sources', 'drupal-best-practices', 'ai', 'rules', 'general-rules.md');
let generalRulesContent = '';
try {
  generalRulesContent = fs.readFileSync(GENERAL_RULES_PATH, 'utf-8');
} catch {
  // File not found — best-practices injection will be skipped gracefully.
}

// ── Hook-Query Detection ─────────────────────────────────────
/**
 * Returns true when the query is about Drupal hooks (hook implementations,
 * hook invocations, alter hooks, etc.).  Used to suppress `php_docs` results
 * that would otherwise be polluted by PHP 8.4 property-hook syntax.
 */
function isHookRelatedQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    lower.includes('hook_') ||          // explicit hook name prefix
    /\bhook\b/.test(lower)              // the word "hook" as a standalone word
  );
}

// ── Entity-Query Detection ────────────────────────────────────
/**
 * Returns true when the query is about entity loading, EntityQuery,
 * EntityTypeManager, loadByProperties(), or EntityStorageInterface.
 *
 * `api_drupal_org_docs` has the richest entity-API coverage (dist ~1.05 for
 * entity-loading queries) but was historically missing from the search dataset.
 * This helper is used to log that the entity path is active; the table is now
 * always included, but the flag lets us adjust top-K or routing in future.
 */
function isEntityQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    lower.includes('entityquery') ||
    lower.includes('entity_query') ||
    lower.includes('loadbyproperties') ||
    lower.includes('load_by_properties') ||
    lower.includes('entitytypemanager') ||
    lower.includes('entity_type.manager') ||
    lower.includes('entitystorageinterface') ||
    /\bload entit/i.test(query) ||
    /\bentit\w*\s+query\b/i.test(query) ||
    /\bquery\s+\w*\s*entit/i.test(query)
  );
}

// ── Site-Building Query Detection ────────────────────────────
/**
 * Returns true when the query touches site-building concepts: Views, Blocks,
 * Fields, Taxonomy, theming, config, content types, naming conventions, etc.
 * Used to decide whether to prepend the curated general-rules.md best-practices
 * summary to the GPT-4o system prompt.
 */
function isSiteBuildingQuery(query: string): boolean {
  const lower = query.toLowerCase();
  const keywords = [
    'views', 'blocks', 'fields', 'taxonomy', 'theming', 'theme',
    'config', 'content type', 'node type', 'naming', 'text format',
    'formatter', 'widgets', 'roles', 'permissions', 'site building', 'site-building',
  ];
  return keywords.some(kw => lower.includes(kw));
}

// ── Tutorial Query Detection ──────────────────────────────────
/**
 * Returns true when the query is asking for examples, how-tos, walkthroughs,
 * or step-by-step tutorials.  Used to boost `drupal_tutorials` results in Tier 2.
 */
function isTutorialQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes('example') ||
    q.includes('how do i') ||
    q.includes('how to') ||
    q.includes('tutorial') ||
    q.includes('step by step') ||
    q.includes('show me') ||
    q.includes('walkthrough') ||
    q.includes('getting started with') ||
    q.includes('sample code')
  );
}

// ── Distance Thresholds ──────────────────────────────────────
// php_docs results with distance > this value are dropped before the merge step.
// Prevents irrelevant PHP manual sections (RADIUS attrs, generator methods, etc.)
// from displacing relevant Drupal content.
const PHP_DOCS_MAX_DISTANCE = 1.3;

// ── Tool Definition ──────────────────────────────────────────
export const TOOL_DEFINITION = {
  name: 'ask_drupal_expert',
  description: `Provide conversational, citation-backed explanations for human Drupal backend developers. This tool searches local Drupal documentation and source code, then synthesizes an educational answer tailored to people seeking conceptual clarity.

Primary audience: human developers learning or implementing Drupal backend features.
Primary use case: conversational synthesis, explaining concepts, and clarifying how to apply retrieved evidence in practice.

Covers hooks, services, dependency injection, entity API, form API, routing, config management, caching, plugins, migrations, events, and Drupal/Symfony patterns using official documentation plus vetted contrib module sources.

Does NOT search the internet. All guidance is grounded in the local Drupal corpus.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      question: {
        type: 'string',
        description: 'The Drupal development question to answer',
      },
      drupal_version: {
        type: 'string',
        description: 'Optional Drupal version filter (e.g., "11.x"). If omitted, searches all versions.',
      },
    },
    required: ['question'],
  },
};

// ── System Prompt ────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Ask Drupal Expert, a senior Drupal educator speaking to human developers.
Your role is to teach: interpret the provided evidence, explain the concepts step by step, and highlight why each cited source matters for real-world implementation.
Answer using ONLY the documentation excerpts supplied in the context.
Format your response in Markdown, using PHP/YAML/JSON code blocks when sharing examples.
Cite every factual statement with [Source N] where N corresponds to the numbered sources in the context block.
Begin with a concise summary, then elaborate with practical guidance, best practices, and cautions suited to human developers.
End with a ## Sources section listing the 3-5 most relevant sources you relied on.
If the context is insufficient, say so directly and recommend next steps instead of guessing.
Favor Drupal 10/11 APIs unless the user explicitly requests older versions, and prefer real code from the evidence over hypothetical snippets.`;

// ── Handler ──────────────────────────────────────────────────
export async function handleAskDrupalExpert(args: { question: string; drupal_version?: string }): Promise<string> {
  const { question, drupal_version } = args;
  const queryStartTime = Date.now();

  console.error(`[ask_drupal_expert] Question: "${question}"${drupal_version ? ` (version: ${drupal_version})` : ''}`);

  // Phase 1 & 2: Retrieve normalized evidence context
  console.error('[ask_drupal_expert] Phase 1: Retrieving documentation context...');
  const retrievalResponse = await retrieveContext({
    query: question,
    drupalVersion: drupal_version,
    strategy: 'tiered',
    includeText: true,
    overallLimit: 12,
  });

  const results = retrievalResponse.hits;

  console.error(
    `[ask_drupal_expert] Retrieval complete: ${retrievalResponse.total_hits_after_filter}/${retrievalResponse.total_hits_before_filter} hits after filtering across ${retrievalResponse.datasets_searched.length} datasets (strategy=${retrievalResponse.strategy})`,
  );

  if (results.length === 0) {
    return 'No relevant documentation found in the local Drupal documentation database. Try rephrasing your question or removing the version filter.';
  }

  const contextHits = results.slice(0, 8);

  const changeRecordsResults = contextHits.filter(r => r.dataset === 'change_records');
  if (changeRecordsResults.length > 0) {
    console.error(`[ask_drupal_expert] Change records included: ${changeRecordsResults.length} result(s) — version-aware recommendations available`);
  }

  const drupalExamplesResults = contextHits.filter(r => r.dataset === 'drupal_examples');
  if (drupalExamplesResults.length > 0) {
    console.error(`[ask_drupal_expert] Drupal Examples included: ${drupalExamplesResults.length} result(s)`);
  }

  const coreModuleCodeResults = contextHits.filter(r => r.dataset === 'core_module_code');
  if (coreModuleCodeResults.length > 0) {
    console.error(`[ask_drupal_expert] Core module code included: ${coreModuleCodeResults.length} result(s)`);
  }

  console.error(`[ask_drupal_expert] Using ${contextHits.length} hits for synthesis context`);

  // Phase 3: Build context prompt
  console.error('[ask_drupal_expert] Phase 3: Building context prompt...');
  const contextBlocks = contextHits.map((result, index) => {
    const label = result.symbol_name || result.section || result.file_path || 'Unknown';
    const sourceType = result.source;
    const version = result.drupal_version;

    // Format code examples (module source datasets) with module context.
    if (['contrib_module_code', 'drupal_examples', 'core_module_code'].includes(result.dataset)) {
      // Extract module name from section field: "{module}: {symbolType}"
      const moduleName = result.section?.split(': ')[0] ?? sourceType;
      const codeLabel = result.symbol_name ?? label;
      return `[Source ${index + 1}] **[Code Example from ${moduleName}]** ${codeLabel} (Drupal ${version})\nType: ${sourceType}\n\n${result.text}`;
    }

    // Format tutorial results with module context.
    if (result.dataset === 'drupal_tutorials') {
      const tutorialModule = result.symbol_name;
      return `[Source ${index + 1}] **[Tutorial${tutorialModule ? ': ' + tutorialModule : ''}]** ${label} (Drupal ${version})\nType: ${sourceType}\n\n${result.text}`;
    }

    return `[Source ${index + 1}] ${label} (Drupal ${version})\nType: ${sourceType}\n\n${result.text}`;
  });

  const contextPrompt = contextBlocks.join('\n\n---\n\n');
  const userMessage = `## Question\n${question}\n\n## Documentation Context\n${contextPrompt}`;

  // Phase 4: GPT-4o synthesis
  console.error('[ask_drupal_expert] Phase 4: Synthesizing answer with GPT-4o...');

  // Skill-aware prompt injection
  const detectedDomain = detectSkillDomain(question);
  let effectiveSystemPrompt = SYSTEM_PROMPT;
  if (detectedDomain) {
    const skill = skillMap.get(detectedDomain);
    if (skill) {
      const skillBlock = `## Skill Guidance: ${skill.title}\n\n${skill.trimmed_text}\n\n---\n`;
      effectiveSystemPrompt = skillBlock + (generalRulesContent ? `## Site-Building Rules\n\n${generalRulesContent}\n\n---\n` : '') + SYSTEM_PROMPT;
      console.error(`[ask_drupal_expert] Skill domain detected: ${detectedDomain}`);
    }
  } else if (generalRulesContent) {
    const hasBestPracticesResults = results.some(r => r.dataset === 'drupal_best_practices');
    const siteBuildingContext = isSiteBuildingQuery(question) || hasBestPracticesResults;
    if (siteBuildingContext) {
      effectiveSystemPrompt = `## Site-Building Rules\n\n${generalRulesContent}\n\n---\n` + SYSTEM_PROMPT;
      console.error('[ask_drupal_expert] Site-building context detected — prepending general-rules.md to system prompt');
    }
  }

  const model = process.env.OPENAI_SYNTHESIS_MODEL ?? 'gpt-4o';
  const answer = await chat(effectiveSystemPrompt, userMessage, model);

  console.error('[ask_drupal_expert] ✓ Answer generated');

  // Structured query metrics — emitted to stderr as a single JSON line for log aggregation
  const queryHash = Buffer.from(question).toString('base64').slice(0, 12);
  const metricsLog = {
    query_hash: queryHash,
    skill_detected: detectedDomain ?? null,
    tiers_searched: Array.from(new Set(contextHits.map(hit => hit.tier).filter((tier): tier is number => typeof tier === 'number'))),
    result_counts: {
      tier1: contextHits.filter(hit => hit.tier === 1).length,
      tier2: contextHits.filter(hit => hit.tier === 2).length,
      tier3: contextHits.filter(hit => hit.tier === 3).length,
      total_after_filter: contextHits.length,
    },
    datasets_used: [...new Set(results.map(r => r.dataset))],
    top_distance: results.length > 0 ? Math.min(...results.map(r => r.distance)) : null,
    latency_ms: Date.now() - queryStartTime,
  };
  console.error(`[metrics] ${JSON.stringify(metricsLog)}`);

  return answer;
}

// Load skill domains at module initialisation (non-blocking — errors are logged not thrown)
loadSkills().catch(err => console.error('[skill-loader] Failed to load skills:', err));

// ── Registration ─────────────────────────────────────────────
export function registerAskDrupalExpert(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [TOOL_DEFINITION],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'ask_drupal_expert') {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const args = request.params.arguments as { question: string; drupal_version?: string };

    if (!args.question || typeof args.question !== 'string') {
      return {
        content: [{ type: 'text', text: 'Error: "question" parameter is required and must be a string.' }],
        isError: true,
      };
    }

    try {
      const answer = await handleAskDrupalExpert(args);
      return {
        content: [{ type: 'text', text: answer }],
      };
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ask_drupal_expert] Error: ${message}`);
      return {
        content: [{ type: 'text', text: `Error processing question: ${message}` }],
        isError: true,
      };
    }
  });
}
