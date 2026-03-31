import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type RecommendationAction =
  | 'keep'
  | 'refine'
  | 'split'
  | 'merge'
  | 'review'
  | 'deprioritize';

export interface EvidenceEntry {
  type: 'description' | 'dependency' | 'signal' | 'metric' | 'test' | 'note';
  description: string;
  path?: string;
}

export interface ToolStats {
  lineCount: number;
  charCount: number;
  importCount: number;
  consoleErrorCount: number;
  chatCalls: number;
  runDeepResearchCalls: number;
  promptCharacters?: number;
}

export interface ToolInventoryRecord {
  id: string;
  name: string;
  filePath: string;
  description?: string;
  inferredPurpose: string;
  handlerNames: string[];
  imports: string[];
  sharedTouchpoints: string[];
  testReferences: string[];
  stats: ToolStats;
  evidence: EvidenceEntry[];
}

export interface DuplicateToolEntry {
  name: string;
  files: string[];
}

export interface InventoryResult {
  generatedAt: string;
  items: ToolInventoryRecord[];
  duplicates: DuplicateToolEntry[];
}

export interface ToolScorecard {
  jobClarity: number;
  boundaryClarity: number;
  evidenceLeverage: number;
  promptBoundedness: number;
  observability: number;
  benchmarkContribution: number;
  costProportionality: number;
  maintenanceBurden: number;
  overall: number;
}

export interface ToolAssessment {
  id: string;
  name: string;
  filePath: string;
  inferredPurpose: string;
  sharedTouchpoints: string[];
  scorecard: ToolScorecard;
  recommendation: RecommendationAction;
  rationale: string;
  evidence: EvidenceEntry[];
  stats: ToolStats;
  testReferences: string[];
}

export interface AssessmentBundle {
  generatedAt: string;
  assessments: ToolAssessment[];
  duplicates: DuplicateToolEntry[];
}

interface ToolMetadata {
  toolName?: string;
  description?: string;
  promptLengths: number[];
}

interface TestCorpusEntry {
  path: string;
  content: string;
}

const TOOL_DIR = ['src', 'tools'];
const TESTS_DIR = ['tests'];

export async function buildToolInventory(rootDir: string): Promise<InventoryResult> {
  const toolDir = path.join(rootDir, ...TOOL_DIR);
  const toolFiles = await listTypeScriptFiles(toolDir);
  const testCorpus = await loadTestCorpus(rootDir);

  const items: ToolInventoryRecord[] = [];

  for (const absoluteFile of toolFiles) {
    const content = await fs.readFile(absoluteFile, 'utf8');
    const relativeFile = toPosix(path.relative(rootDir, absoluteFile));
    const metadata = extractToolMetadata(absoluteFile, content);
    const imports = extractImports(content);
    const handlerNames = extractExportedHandlerNames(content);
    const sharedTouchpoints = detectSharedTouchpoints(imports, content);
    const stats = computeStats(content, metadata.promptLengths);
    const description = metadata.description?.trim();
    const inferredPurpose = buildInferredPurpose(description, handlerNames, relativeFile);
    const toolId = metadata.toolName ?? deriveIdFromFile(relativeFile);
    const testReferences = findTestReferences(testCorpus, [toolId, metadata.toolName, ...handlerNames].filter(Boolean) as string[]);

    const evidence: EvidenceEntry[] = [];
    if (description) {
      evidence.push({ type: 'description', description: truncate(description, 320) });
    }
    for (const dependency of sharedTouchpoints) {
      evidence.push({ type: 'dependency', description: `Touches ${dependency}` });
    }
    if (stats.promptCharacters !== undefined) {
      evidence.push({
        type: 'signal',
        description: `Primary prompt length ≈ ${stats.promptCharacters} characters`,
      });
    }
    if (stats.consoleErrorCount > 0) {
      evidence.push({
        type: 'metric',
        description: `Logs ${stats.consoleErrorCount} console error${stats.consoleErrorCount === 1 ? '' : 's'}`,
      });
    }
    if (testReferences.length > 0) {
      for (const ref of testReferences) {
        evidence.push({ type: 'test', description: `Referenced in ${ref}`, path: ref });
      }
    }

    const record: ToolInventoryRecord = {
      id: toolId,
      name: metadata.toolName ?? toolId,
      filePath: relativeFile,
      description,
      inferredPurpose,
      handlerNames,
      imports,
      sharedTouchpoints,
      testReferences,
      stats,
      evidence,
    };

    items.push(record);
  }

  const duplicates = detectDuplicates(items);

  return {
    generatedAt: new Date().toISOString(),
    items,
    duplicates,
  };
}

export function scoreToolInventory(inventory: InventoryResult): AssessmentBundle {
  const assessments = inventory.items.map((item) => scoreItem(item));
  return {
    generatedAt: inventory.generatedAt,
    assessments,
    duplicates: inventory.duplicates,
  };
}

export function createMarkdownReport(bundle: AssessmentBundle, summary?: string | null): string {
  const grouped = groupByAction(bundle.assessments);
  const lines: string[] = [];
  lines.push('# research-tools recommendations');
  lines.push('');
  lines.push(`Generated at: ${bundle.generatedAt}`);
  lines.push('');

  if (summary) {
    lines.push('## LLM Summary');
    lines.push('');
    lines.push(summary.trim());
    lines.push('');
  }

  lines.push('## Summary');
  lines.push('');
  lines.push('| Action | Count | Avg Overall |');
  lines.push('| --- | ---: | ---: |');
  for (const action of ['keep', 'refine', 'split', 'merge', 'review', 'deprioritize'] as RecommendationAction[]) {
    const list = grouped[action] ?? [];
    const avg = list.length > 0 ? (list.reduce((sum, item) => sum + item.scorecard.overall, 0) / list.length).toFixed(2) : '—';
    lines.push(`| ${action} | ${list.length} | ${avg} |`);
  }
  lines.push('');

  if (bundle.duplicates.length > 0) {
    lines.push('## Duplicate tool identifiers');
    lines.push('');
    for (const entry of bundle.duplicates) {
      lines.push(`- ${entry.name}: ${entry.files.join(', ')}`);
    }
    lines.push('');
  }

  for (const action of ['keep', 'refine', 'split', 'merge', 'review', 'deprioritize'] as RecommendationAction[]) {
    const list = grouped[action]?.slice() ?? [];
    if (list.length === 0) continue;
    lines.push(`## ${capitalize(action)}`);
    lines.push('');
    list.sort((a, b) => b.scorecard.overall - a.scorecard.overall);
    for (const assessment of list) {
      const { scorecard } = assessment;
      lines.push(`### ${assessment.name} (${scorecard.overall.toFixed(1)})`);
      lines.push('');
      lines.push(`- **File**: ${assessment.filePath}`);
      lines.push(`- **Action**: ${assessment.recommendation}`);
      lines.push(`- **Purpose**: ${assessment.inferredPurpose}`);
      if (assessment.sharedTouchpoints.length > 0) {
        lines.push(`- **Shared touchpoints**: ${assessment.sharedTouchpoints.join(', ')}`);
      }
      if (assessment.testReferences.length > 0) {
        lines.push(`- **Test references**: ${assessment.testReferences.join(', ')}`);
      }
      lines.push(`- **Rationale**: ${assessment.rationale}`);
      lines.push('');
      lines.push('| Dimension | Score |');
      lines.push('| --- | ---: |');
      lines.push(`| Job clarity | ${scorecard.jobClarity.toFixed(1)} |`);
      lines.push(`| Boundary clarity | ${scorecard.boundaryClarity.toFixed(1)} |`);
      lines.push(`| Evidence leverage | ${scorecard.evidenceLeverage.toFixed(1)} |`);
      lines.push(`| Prompt boundedness | ${scorecard.promptBoundedness.toFixed(1)} |`);
      lines.push(`| Observability | ${scorecard.observability.toFixed(1)} |`);
      lines.push(`| Benchmark contribution | ${scorecard.benchmarkContribution.toFixed(1)} |`);
      lines.push(`| Cost proportionality | ${scorecard.costProportionality.toFixed(1)} |`);
      lines.push(`| Maintenance burden | ${scorecard.maintenanceBurden.toFixed(1)} |`);
      lines.push('');
      lines.push('**Key Evidence**');
      lines.push('');
      for (const ev of assessment.evidence.slice(0, 6)) {
        const suffix = ev.path ? ` (${ev.path})` : '';
        lines.push(`- [${ev.type}] ${ev.description}${suffix}`);
      }
      lines.push('');
    }
  }

  if (bundle.assessments.length === 0) {
    lines.push('_No tools evaluated._');
  }

  return lines.join('\n');
}

async function listTypeScriptFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
    results.push(path.join(dir, entry.name));
  }
  return results;
}

async function loadTestCorpus(rootDir: string): Promise<TestCorpusEntry[]> {
  const base = path.join(rootDir, ...TESTS_DIR);
  const corpus: TestCorpusEntry[] = [];
  await collectTestsRecursive(base, corpus);
  return corpus;
}

async function collectTestsRecursive(current: string, corpus: TestCorpusEntry[]): Promise<void> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await collectTestsRecursive(absolute, corpus);
      continue;
    }
    if (!/\.(ts|md|json)$/i.test(entry.name)) continue;
    try {
      const content = await fs.readFile(absolute, 'utf8');
      corpus.push({ path: toPosix(path.relative(process.cwd(), absolute)), content });
    } catch {
      // ignore read failures
    }
  }
}

function extractToolMetadata(filePath: string, content: string): ToolMetadata {
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const metadata: ToolMetadata = { promptLengths: [] };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (name === 'TOOL_DEFINITION' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        for (const property of node.initializer.properties) {
          if (!ts.isPropertyAssignment(property) || !property.name) continue;
          const propName = getPropertyName(property.name);
          if (!propName) continue;
          if (propName === 'name' && isStringLike(property.initializer)) {
            metadata.toolName = extractString(property.initializer);
          }
          if (propName === 'description' && isStringLike(property.initializer)) {
            metadata.description = extractString(property.initializer);
          }
        }
      }
      if (name.includes('PROMPT') && node.initializer) {
        const length = computePromptLength(node.initializer);
        if (length !== undefined) {
          metadata.promptLengths.push(length);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);

  return metadata;
}

function extractImports(content: string): string[] {
  const regex = /import[^;]+from\s+['"]([^'"]+)['"];?/g;
  const imports = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    imports.add(match[1]);
  }
  return Array.from(imports);
}

function extractExportedHandlerNames(content: string): string[] {
  const regex = /export\s+(?:async\s+)?function\s+(handle[\w$]+)/g;
  const result: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    result.push(match[1]);
  }
  return result;
}

function detectSharedTouchpoints(imports: string[], content: string): string[] {
  const touchpoints = new Set<string>();
  for (const entry of imports) {
    if (entry.includes('retrieval')) touchpoints.add('retrieval');
    if (entry.includes('deep-research')) touchpoints.add('deep-research');
    if (entry.includes('openai')) touchpoints.add('openai');
    if (entry.includes('@modelcontextprotocol')) touchpoints.add('mcp-sdk');
    if (entry.includes('research-sources')) touchpoints.add('research-sources');
    if (entry.includes('drupal-best-practices')) touchpoints.add('best-practices-data');
  }
  if (content.includes('retrieveContext(') || content.includes('retrieve(')) {
    touchpoints.add('retrieval');
  }
  if (content.includes('runDeepResearch(')) {
    touchpoints.add('deep-research');
  }
  if (content.includes('chat(')) {
    touchpoints.add('openai');
  }
  if (content.includes('validateConfig(')) {
    touchpoints.add('config-validation');
  }
  return Array.from(touchpoints).sort();
}

function computeStats(content: string, promptLengths: number[]): ToolStats {
  const lineCount = content.split(/\r?\n/).length;
  const charCount = content.length;
  const importCount = (content.match(/\bimport\b/g) ?? []).length;
  const consoleErrorCount = (content.match(/console\.error/g) ?? []).length;
  const chatCalls = Math.max((content.match(/\bchat\s*\(/g) ?? []).length, 0);
  const runDeepResearchCalls = Math.max((content.match(/runDeepResearch\s*\(/g) ?? []).length, 0);
  const promptCharacters = promptLengths.length > 0 ? Math.max(...promptLengths) : undefined;

  return {
    lineCount,
    charCount,
    importCount,
    consoleErrorCount,
    chatCalls,
    runDeepResearchCalls,
    promptCharacters,
  };
}

function buildInferredPurpose(description: string | undefined, handlerNames: string[], filePath: string): string {
  if (description && description.length > 0) {
    return truncate(description, 200);
  }
  if (handlerNames.length > 0) {
    return `Handler(s): ${handlerNames.join(', ')}`;
  }
  return `See ${filePath}`;
}

function deriveIdFromFile(relativeFile: string): string {
  const base = path.basename(relativeFile, path.extname(relativeFile));
  return base.replace(/[^a-z0-9_]/gi, '_');
}

function findTestReferences(corpus: TestCorpusEntry[], tokens: string[]): string[] {
  const unique = new Set<string>();
  const keywords = tokens.map((token) => token.toLowerCase()).filter(Boolean);
  if (keywords.length === 0) return [];

  for (const entry of corpus) {
    const haystack = entry.content.toLowerCase();
    if (keywords.some((needle) => needle && haystack.includes(needle))) {
      unique.add(entry.path);
    }
  }
  return Array.from(unique).sort();
}

function detectDuplicates(items: ToolInventoryRecord[]): DuplicateToolEntry[] {
  const map = new Map<string, string[]>();
  for (const item of items) {
    const files = map.get(item.name) ?? [];
    files.push(item.filePath);
    map.set(item.name, files);
  }
  const duplicates: DuplicateToolEntry[] = [];
  for (const [name, files] of map.entries()) {
    if (files.length > 1) {
      duplicates.push({ name, files: files.sort() });
    }
  }
  return duplicates.sort((a, b) => a.name.localeCompare(b.name));
}

function scoreItem(item: ToolInventoryRecord): ToolAssessment {
  const scorecard = computeScorecard(item);
  const recommendation = classify(scorecard, item);
  const rationale = buildRationale(item, scorecard);
  return {
    id: item.id,
    name: item.name,
    filePath: item.filePath,
    inferredPurpose: item.inferredPurpose,
    sharedTouchpoints: item.sharedTouchpoints,
    scorecard,
    recommendation,
    rationale,
    evidence: item.evidence,
    stats: item.stats,
    testReferences: item.testReferences,
  };
}

function computeScorecard(item: ToolInventoryRecord): ToolScorecard {
  const jobClarity = clamp(computeJobClarity(item), 0, 5);
  const boundaryClarity = clamp(computeBoundaryClarity(item), 0, 5);
  const evidenceLeverage = clamp(computeEvidenceLeverage(item), 0, 5);
  const promptBoundedness = clamp(computePromptBoundedness(item), 0, 5);
  const observability = clamp(computeObservability(item), 0, 5);
  const benchmarkContribution = clamp(computeBenchmarkContribution(item), 0, 5);
  const costProportionality = clamp(computeCostProportionality(item), 0, 5);
  const maintenanceBurden = clamp(computeMaintenanceBurden(item), 0, 5);

  const weights = {
    jobClarity: 0.2,
    boundaryClarity: 0.16,
    evidenceLeverage: 0.14,
    promptBoundedness: 0.12,
    observability: 0.12,
    benchmarkContribution: 0.1,
    costProportionality: 0.08,
    maintenanceBurden: 0.08,
  } as const;

  const overall = clamp(
    jobClarity * weights.jobClarity +
      boundaryClarity * weights.boundaryClarity +
      evidenceLeverage * weights.evidenceLeverage +
      promptBoundedness * weights.promptBoundedness +
      observability * weights.observability +
      benchmarkContribution * weights.benchmarkContribution +
      costProportionality * weights.costProportionality +
      maintenanceBurden * weights.maintenanceBurden,
    0,
    5,
  );

  return {
    jobClarity: round(jobClarity),
    boundaryClarity: round(boundaryClarity),
    evidenceLeverage: round(evidenceLeverage),
    promptBoundedness: round(promptBoundedness),
    observability: round(observability),
    benchmarkContribution: round(benchmarkContribution),
    costProportionality: round(costProportionality),
    maintenanceBurden: round(maintenanceBurden),
    overall: round(overall),
  };
}

function computeJobClarity(item: ToolInventoryRecord): number {
  let score = 2.6;
  if (item.description && item.description.length > 40) score += 0.8;
  if (item.description && item.description.length > 120) score += 0.6;
  if (!item.description) score -= 0.8;
  if (item.handlerNames.length === 1) score += 0.3;
  return score;
}

function computeBoundaryClarity(item: ToolInventoryRecord): number {
  let score = 3.4;
  if (item.sharedTouchpoints.length > 3) {
    score -= 0.8;
  } else if (item.sharedTouchpoints.length <= 2) {
    score += 0.3;
  }
  if (item.handlerNames.length > 1) score -= 0.4;
  if (item.imports.length > 12) score -= 0.4;
  return score;
}

function computeEvidenceLeverage(item: ToolInventoryRecord): number {
  let score = 1.8;
  if (item.sharedTouchpoints.includes('retrieval')) score += 1.3;
  if (item.sharedTouchpoints.includes('deep-research')) score += 1.0;
  if (item.sharedTouchpoints.includes('openai')) score += 0.5;
  if (item.stats.chatCalls > 0 && item.sharedTouchpoints.includes('retrieval')) score += 0.3;
  return score;
}

function computePromptBoundedness(item: ToolInventoryRecord): number {
  if (item.stats.chatCalls === 0 && !item.sharedTouchpoints.includes('openai')) {
    return 4.2;
  }
  const promptLength = item.stats.promptCharacters ?? 0;
  if (promptLength === 0) {
    return 3.0;
  }
  if (promptLength <= 1200) return 4.2;
  if (promptLength <= 2400) return 3.5;
  if (promptLength <= 3600) return 2.8;
  return 2.2;
}

function computeObservability(item: ToolInventoryRecord): number {
  let score = 1.8;
  if (item.stats.consoleErrorCount >= 4) score += 1.2;
  else if (item.stats.consoleErrorCount > 0) score += 0.8;
  if (item.evidence.some((ev) => ev.description.includes('metrics'))) score += 0.4;
  return score;
}

function computeBenchmarkContribution(item: ToolInventoryRecord): number {
  if (item.testReferences.length === 0) return 1.6;
  if (item.testReferences.length === 1) return 2.6;
  if (item.testReferences.length === 2) return 3.0;
  return 3.6;
}

function computeCostProportionality(item: ToolInventoryRecord): number {
  let score = 3.8;
  if (item.stats.chatCalls > 0) score -= 0.6;
  if (item.stats.runDeepResearchCalls > 0) score -= 1.0;
  if (item.stats.lineCount > 350) score -= 0.4;
  return score;
}

function computeMaintenanceBurden(item: ToolInventoryRecord): number {
  let score = 3.6;
  if (item.stats.lineCount > 400 || item.stats.charCount > 16000) score -= 1.0;
  if (item.stats.importCount > 14) score -= 0.4;
  if (item.stats.consoleErrorCount === 0) score -= 0.2; // fewer guardrails increases burden
  if (item.testReferences.length > 0) score += 0.3;
  return score;
}

function classify(scorecard: ToolScorecard, item: ToolInventoryRecord): RecommendationAction {
  if (scorecard.overall >= 4.1 && scorecard.jobClarity >= 4.0 && scorecard.boundaryClarity >= 3.5) {
    return 'keep';
  }
  if (scorecard.overall <= 2.4) {
    return 'deprioritize';
  }
  if (scorecard.boundaryClarity < 2.6 && item.sharedTouchpoints.length > 3) {
    return 'split';
  }
  if (scorecard.evidenceLeverage < 2.4 && scorecard.jobClarity < 3.2) {
    return 'merge';
  }
  if (scorecard.overall >= 3.2) {
    return 'refine';
  }
  return 'review';
}

function buildRationale(item: ToolInventoryRecord, scorecard: ToolScorecard): string {
  const notes: string[] = [];
  notes.push(`Overall ${scorecard.overall.toFixed(1)}`);
  if (scorecard.jobClarity >= 4.0) {
    notes.push('clear job definition');
  } else if (scorecard.jobClarity < 3.0) {
    notes.push('job definition needs clarification');
  }
  if (scorecard.boundaryClarity < 3.0) {
    notes.push('boundaries overlap with shared layers');
  }
  if (scorecard.evidenceLeverage >= 3.5) {
    notes.push('reuses retrieval evidence effectively');
  }
  if (scorecard.promptBoundedness < 3.0) {
    notes.push('prompt may be overly large');
  }
  if (scorecard.observability < 2.5) {
    notes.push('low logging/metrics');
  }
  if (scorecard.benchmarkContribution < 2.5) {
    notes.push('add benchmark coverage');
  }
  return notes.join('; ');
}

function groupByAction(assessments: ToolAssessment[]): Record<RecommendationAction, ToolAssessment[]> {
  return assessments.reduce(
    (acc, assessment) => {
      acc[assessment.recommendation].push(assessment);
      return acc;
    },
    {
      keep: [] as ToolAssessment[],
      refine: [] as ToolAssessment[],
      split: [] as ToolAssessment[],
      merge: [] as ToolAssessment[],
      review: [] as ToolAssessment[],
      deprioritize: [] as ToolAssessment[],
    },
  );
}

function getPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return null;
}

function isStringLike(node: ts.Expression): node is ts.StringLiteralLike | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function extractString(node: ts.Expression): string {
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return node.getText();
}

function computePromptLength(node: ts.Expression): number | undefined {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text.length;
  }
  if (ts.isTemplateExpression(node)) {
    return node.getText().length;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toPosix(p: string): string {
  return p.split(path.sep).join(path.posix.sep);
}
