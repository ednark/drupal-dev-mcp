import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { embed, chat } from '../lib/openai.js';
import { vectorSearch } from '../lib/lancedb.js';
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
  description: `Ask a Drupal backend development question. This tool searches a local vector database of official Drupal documentation (PHPDoc from drupal/drupal core, Drupal User Guide) and synthesizes an expert answer using GPT-4o.

Covers: hooks, services, dependency injection, entity API, form API, routing, config management, caching, plugins, migrations, events, Drupal/Symfony patterns.

Also searches contrib module source code (PHP classes, hook implementations, YAML services/routes) from 43 popular contributed modules including views, webform, paragraphs, pathauto, and more.

Does NOT search the internet. Answers are grounded in official Drupal documentation and contrib module source code only.`,
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
const SYSTEM_PROMPT = `You are an expert Drupal backend developer and architect.
Answer using ONLY the documentation excerpts provided below.
Format your response in Markdown with code blocks for PHP/YAML/JSON examples.
Cite every factual statement with [Source N] where N corresponds to the numbered sources.
End your response with a ## Sources section listing the 3-5 most relevant sources used.
If the provided context is insufficient to answer the question, say so clearly — do not hallucinate API names, function names, or class names.
Do not reference deprecated Drupal 7 or Drupal 8 APIs unless the user specifically asks about them.
Always prefer Drupal 10/11 patterns and APIs.
When Code Example sources are provided, prefer showing real working code from those examples rather than synthesizing hypothetical code. Label code examples with their module name and class/function name.`;

// ── Handler ──────────────────────────────────────────────────
export async function handleAskDrupalExpert(args: { question: string; drupal_version?: string }): Promise<string> {
  const { question, drupal_version } = args;
  const queryStartTime = Date.now();

  console.error(`[ask_drupal_expert] Question: "${question}"${drupal_version ? ` (version: ${drupal_version})` : ''}`);

  // Phase 1: Embed the question
  console.error('[ask_drupal_expert] Phase 1: Embedding question...');
  const queryVector = await embed(question);

  // Phase 2: Vector search in LanceDB with source tiering
  console.error('[ask_drupal_expert] Phase 2: Searching LanceDB with source tiering...');

  // Query classification for conditional Tier 3 logic.
  // php_docs is excluded for hook-related queries because PHP 8.4 property-hook
  // syntax causes false-positive matches (distance ~1.3–1.55) that pollute results.
  // api_drupal_org_docs is prioritised for entity queries: it has the richest entity-API and
  // hook-reference coverage (e.g. EntityStorageInterface, loadByProperties, EntityQuery)
  // that drupal_core_docs PHPDoc stubs only cover with empty {@inheritdoc} entries.
  const hookQuery = isHookRelatedQuery(question);
  const entityQuery = isEntityQuery(question);
  const tutorialQuery = isTutorialQuery(question);

  // ── Tier 1 (Primary): High-yield sources with limit=6 ──
  // Includes official Drupal core, API reference, developer guides, high-quality
  // contrib module source code implementations, and change records for version-aware
  // and deprecation-safe answers.
  const primaryDocDatasets = [
    'drupal_core_docs',
    'api_drupal_org_docs',
    'drupal_developer_guides',
    'drupal_module_handbook',
    'contrib_module_code',
    'drupal_examples',
    'core_module_code',
    'change_records',
  ];

  // ── Tier 2 (Secondary): Supplementary sources with limit=3 ──
  // Includes framework patterns (Symfony), tutorials, contributed module documentation,
  // and site-building best practices.
  const secondaryDocDatasets = [
    'symfony_docs',
    'drupal_tutorials',
    'contrib_module_docs',
    'contrib_module_handbook',
    'drupal_best_practices',
  ];

  // ── Tier 3 (Explicit Fallback): PHP docs with limit=3 ──
  // Only searched for non-hook and non-entity queries to avoid polluting results with
  // false-positive matches from PHP 8.4 property-hook syntax or generic PHP documentation.
  const shouldSearchPhpDocs = !hookQuery && !entityQuery;

  if (hookQuery) {
    console.error('[ask_drupal_expert] Hook-related query detected — excluding php_docs from search');
  }
  if (entityQuery) {
    console.error('[ask_drupal_expert] Entity-related query detected — api_drupal_org_docs prioritised');
  }
  if (tutorialQuery) {
    console.error('[ask_drupal_expert] Tutorial query detected — boosting drupal_tutorials in Tier 2');
  }

  // Perform tiered searches: Tier 1 all parallel, then Tier 2 all parallel, then optional Tier 3.
  // This prioritises high-quality official documentation before falling back to supplementary sources.
  const tier1Results = await Promise.all(
    primaryDocDatasets.map(ds =>
      vectorSearch(queryVector, (ds === 'api_drupal_org_docs' && entityQuery) ? 8 : 6, ds)
        .then(r => r.map(x => ({ ...x, dataset: ds, tier: 1 as const })))
        .catch(() => [] as Array<Awaited<ReturnType<typeof vectorSearch>>[number] & { dataset: string; tier: 1 }>),
    ),
  ).then(r => r.flat());

  console.error(`[ask_drupal_expert] Tier 1 search complete: ${tier1Results.length} results across ${primaryDocDatasets.length} sources`);

  const tier2Results = await Promise.all(
    secondaryDocDatasets.map(ds =>
      vectorSearch(queryVector, ds === 'drupal_tutorials' && tutorialQuery ? 5 : 3, ds)
        .then(r => r.map(x => ({ ...x, dataset: ds, tier: 2 as const })))
        .catch(() => [] as Array<Awaited<ReturnType<typeof vectorSearch>>[number] & { dataset: string; tier: 2 }>),
    ),
  ).then(r => r.flat());

  console.error(`[ask_drupal_expert] Tier 2 search complete: ${tier2Results.length} results across ${secondaryDocDatasets.length} sources`);

  let tier3Results: Array<Awaited<ReturnType<typeof vectorSearch>>[number] & { dataset: string; tier: 3 }> = [];
  if (shouldSearchPhpDocs) {
    tier3Results = await vectorSearch(queryVector, 3, 'php_docs')
      .then(r => r.map(x => ({ ...x, dataset: 'php_docs', tier: 3 as const })))
      .then(r => r.filter(x => x._distance <= PHP_DOCS_MAX_DISTANCE))
      .catch(() => []);
    console.error(`[ask_drupal_expert] Tier 3 search complete: ${tier3Results.length} results from php_docs (distance filtered)`);
  } else {
    console.error('[ask_drupal_expert] Tier 3 search skipped (hook or entity query)');
  }

  // Merge and sort: prioritise Tier 1, then Tier 2, then Tier 3 by distance.
  // Ensure at least 4 results from Tier 1 if available; then fill with Tier 2/3 sorted by distance.
  const tier1Sorted = tier1Results
    .sort((a, b) => a._distance - b._distance)
    .slice(0, 8); // cap at 8

  const tier1Count = tier1Sorted.length;
  let results: Array<Awaited<ReturnType<typeof vectorSearch>>[number] & { dataset: string; tier?: number }>;

  if (tier1Count >= 4) {
    // Tier 1 has at least 4 results; fill up to total of 8 with Tier 2/3.
    const remainingSlots = 8 - tier1Count;
    const tier23Merged = [...tier2Results, ...tier3Results]
      .sort((a, b) => a._distance - b._distance)
      .slice(0, remainingSlots);
    results = [...tier1Sorted, ...tier23Merged];
  } else {
    // Tier 1 has fewer than 4 results; take all available and fill the rest.
    const remainingSlots = 8 - tier1Count;
    const tier23Merged = [...tier2Results, ...tier3Results]
      .sort((a, b) => a._distance - b._distance)
      .slice(0, remainingSlots);
    results = [...tier1Sorted, ...tier23Merged];
  }

  // Reorder final results by distance for consistent presentation.
  // Per-dataset distance thresholds — drop results noisier than their dataset baseline.
  // (php_docs is already filtered by PHP_DOCS_MAX_DISTANCE above; this is a safety net
  //  for other datasets whose noise floor has been empirically measured.)
  const DATASET_MAX_DISTANCE: Record<string, number> = {
    contrib_module_docs: 1.25,
    contrib_module_handbook: 1.25,
    drupal_tutorials: 1.3,
    symfony_docs: 1.3,
    drupal_best_practices: 1.2,
    php_docs: 1.3,
  };

  const beforeFilter = results.length;
  results = results.filter(r => {
    const maxDist = DATASET_MAX_DISTANCE[r.dataset];
    return maxDist === undefined || r._distance <= maxDist;
  });
  const droppedByDistance = beforeFilter - results.length;
  if (droppedByDistance > 0) {
    console.error(`[ask_drupal_expert] Dropped ${droppedByDistance} results by dataset distance thresholds`);
  }

  // Sort results: keep tier ordering, then prefer code chunks that have a
  // symbol_name (concrete implementations) over anonymous/prose chunks within
  // the same tier, and finally fall back to ascending distance.
  results.sort((a, b) => {
    // Preserve tier ordering first
    if (a.tier !== b.tier) return (a.tier ?? 3) - (b.tier ?? 3);
    // Within the same tier, prefer code datasets that carry a symbol_name
    const codeDatasets = ['contrib_module_code', 'drupal_examples', 'core_module_code', 'drupal_module_handbook'];
    const aIsCode = codeDatasets.includes(a.dataset);
    const bIsCode = codeDatasets.includes(b.dataset);
    if (aIsCode && a.symbol_name && (!bIsCode || !b.symbol_name)) return -1;
    if (bIsCode && b.symbol_name && (!aIsCode || !a.symbol_name)) return 1;
    // Otherwise sort by ascending distance
    return a._distance - b._distance;
  });

  if (results.length === 0) {
    return 'No relevant documentation found in the local Drupal documentation database. Try rephrasing your question or removing the version filter.';
  }

  // Log when change_records results are included
  const changeRecordsResults = results.filter(r => r.dataset === 'change_records');
  if (changeRecordsResults.length > 0) {
    console.error(`[ask_drupal_expert] Change records included: ${changeRecordsResults.length} result(s) — version-aware recommendations available`);
  }

  const drupalExamplesResults = results.filter(r => r.dataset === 'drupal_examples');
  if (drupalExamplesResults.length > 0) {
    console.error(`[ask_drupal_expert] Drupal Examples included: ${drupalExamplesResults.length} result(s)`);
  }

  const coreModuleCodeResults = results.filter(r => r.dataset === 'core_module_code');
  if (coreModuleCodeResults.length > 0) {
    console.error(`[ask_drupal_expert] Core module code included: ${coreModuleCodeResults.length} result(s)`);
  }

  console.error(`[ask_drupal_expert] Found ${results.length} relevant chunks from tiered search`);

  // Phase 3: Build context prompt
  console.error('[ask_drupal_expert] Phase 3: Building context prompt...');
  const contextBlocks = results.map((result, index) => {
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
    tiers_searched: (
      [
        tier1Results.length > 0 ? 1 : null,
        tier2Results.length > 0 ? 2 : null,
        tier3Results.length > 0 ? 3 : null,
      ] as Array<number | null>
    ).filter((t): t is number => t !== null),
    result_counts: {
      tier1: tier1Results.length,
      tier2: tier2Results.length,
      tier3: tier3Results.length,
      total_after_filter: results.length,
    },
    datasets_used: [...new Set(results.map(r => r.dataset))],
    top_distance: results.length > 0 ? Math.min(...results.map(r => r._distance)) : null,
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
