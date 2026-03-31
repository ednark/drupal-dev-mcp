import { promises as fs } from 'node:fs';
import path from 'node:path';

export type SourceFamily =
  | 'official_docs'
  | 'official_code'
  | 'community_docs'
  | 'community_code'
  | 'tutorials'
  | 'upstream'
  | 'certification'
  | 'meta'
  | 'unknown';

export type SourceType =
  | 'html'
  | 'markdown'
  | 'structured_json'
  | 'repo'
  | 'api'
  | 'mixed'
  | 'pdf'
  | 'unknown';

export interface SourceDefinition {
  id: string;
  name: string;
  family: SourceFamily;
  type: SourceType;
  description: string;
  urls: string[];
  dataset?: string;
  fetchScripts: string[];
  parseScripts: string[];
  verifyScripts?: string[];
  dataPaths?: string[];
  docReferences?: string[];
  heuristics: {
    authority: number;
    novelty: number;
    retrievalFit: number;
    redundancyPenalty: number;
    maintenanceCostPenalty: number;
  };
}

export interface ArtifactStatus {
  path: string;
  exists: boolean;
  lastModified?: string;
  type: 'fetch' | 'parse' | 'verify' | 'data' | 'doc';
  notes?: string;
}

export interface SourceInventoryRecord {
  id: string;
  definition: SourceDefinition;
  artifacts: ArtifactStatus[];
  datasetRegistered: boolean;
  latestRevision?: string;
  daysSinceRevision?: number;
  evidence: EvidenceEntry[];
}

export interface EvidenceEntry {
  type: 'fetch-script' | 'parse-script' | 'verify-script' | 'data-path' | 'docs' | 'dataset' | 'note';
  path?: string;
  description: string;
  status?: 'present' | 'missing';
}

export interface Scorecard {
  authority: number;
  freshness: number;
  novelty: number;
  retrievalFit: number;
  redundancyPenalty: number;
  maintenanceCostPenalty: number;
  overall: number;
}

export type RecommendationAction = 'add' | 'keep' | 'review' | 'deprioritize';

export interface SourceAssessment {
  id: string;
  name: string;
  family: SourceFamily;
  type: SourceType;
  dataset?: string;
  urls: string[];
  scorecard: Scorecard;
  recommendation: RecommendationAction;
  rationale: string;
  evidence: EvidenceEntry[];
  latestRevision?: string;
  daysSinceRevision?: number;
}

export interface InventoryResult {
  generatedAt: string;
  items: SourceInventoryRecord[];
  unmappedArtifacts: UnmappedArtifact[];
}

export interface UnmappedArtifact {
  path: string;
  type: 'fetch' | 'parse' | 'verify';
}

export interface AssessmentBundle {
  generatedAt: string;
  assessments: SourceAssessment[];
}

const SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    id: 'drupal_core_docs',
    name: 'Drupal Core Documentation',
    family: 'official_docs',
    type: 'mixed',
    description: 'Core API documentation, user guide, and PHPDoc extracted from Drupal core.',
    urls: [
      'https://api.drupal.org',
      'https://www.drupal.org/docs/user_guide'
    ],
    dataset: 'drupal_core_docs',
    fetchScripts: [
      'scripts/sync-docs.sh'
    ],
    parseScripts: [
      'etl/parser.ts',
      'etl/parse-api-drupal-org.ts',
      'etl/parse-best-practices.ts'
    ],
    verifyScripts: [],
    dataPaths: [
      'data/sources/drupal-core'
    ],
    docReferences: [
      'README.md:151'
    ],
    heuristics: {
      authority: 4.8,
      novelty: 4.2,
      retrievalFit: 4.4,
      redundancyPenalty: 1.2,
      maintenanceCostPenalty: 1.5,
    },
  },
  {
    id: 'api_drupal_org_docs',
    name: 'Drupal API Reference',
    family: 'official_docs',
    type: 'html',
    description: 'Canonical function, hook, and service documentation from api.drupal.org.',
    urls: ['https://api.drupal.org/api'],
    dataset: 'api_drupal_org_docs',
    fetchScripts: ['scripts/fetch-api-drupal-org.sh'],
    parseScripts: ['etl/parse-api-drupal-org.ts'],
    verifyScripts: ['etl/verify-api-drupal-org.ts'],
    dataPaths: ['data/sources/api-drupal-org'],
    docReferences: ['README.md:152'],
    heuristics: {
      authority: 4.9,
      novelty: 4.3,
      retrievalFit: 4.5,
      redundancyPenalty: 0.8,
      maintenanceCostPenalty: 1.8,
    },
  },
  {
    id: 'change_records',
    name: 'Drupal Change Records',
    family: 'official_docs',
    type: 'html',
    description: 'Release-by-release behavioral notes, API changes, and security updates.',
    urls: ['https://www.drupal.org/list-changes'],
    dataset: 'change_records',
    fetchScripts: ['scripts/fetch-change-records.sh'],
    parseScripts: ['etl/parse-change-records.ts'],
    verifyScripts: ['etl/verify-contrib-modules.ts'],
    dataPaths: ['data/sources/change-records'],
    docReferences: ['README.md:154'],
    heuristics: {
      authority: 4.6,
      novelty: 4.4,
      retrievalFit: 4.0,
      redundancyPenalty: 1.0,
      maintenanceCostPenalty: 1.6,
    },
  },
  {
    id: 'core_module_code',
    name: 'Drupal Core Module Source Code',
    family: 'official_code',
    type: 'repo',
    description: 'Source code for Drupal core modules parsed for implementation references.',
    urls: ['https://git.drupalcode.org/project/drupal'],
    dataset: 'core_module_code',
    fetchScripts: ['scripts/sync-docs.sh'],
    parseScripts: ['etl/parse-core-module-code.ts'],
    verifyScripts: ['etl/verify-core-module-code.ts'],
    dataPaths: ['data/sources/drupal-core'],
    docReferences: ['README.md:157'],
    heuristics: {
      authority: 4.7,
      novelty: 4.5,
      retrievalFit: 4.3,
      redundancyPenalty: 1.3,
      maintenanceCostPenalty: 1.4,
    },
  },
  {
    id: 'contrib_module_code',
    name: 'Contrib Module Source Code',
    family: 'community_code',
    type: 'repo',
    description: 'Source code for widely used Drupal contrib modules.',
    urls: ['https://git.drupalcode.org'],
    dataset: 'contrib_module_code',
    fetchScripts: ['scripts/fetch-contrib-module-code.sh'],
    parseScripts: ['etl/parse-contrib-module-code.ts'],
    verifyScripts: ['etl/verify-contrib-module-code.ts'],
    dataPaths: ['data/sources/contrib-module-code'],
    docReferences: ['README.md:158'],
    heuristics: {
      authority: 4.2,
      novelty: 4.3,
      retrievalFit: 4.1,
      redundancyPenalty: 1.6,
      maintenanceCostPenalty: 2.2,
    },
  },
  {
    id: 'contrib_module_docs',
    name: 'Contrib Module README & Handbook',
    family: 'community_docs',
    type: 'markdown',
    description: 'Narrative documentation for popular contrib modules.',
    urls: ['https://www.drupal.org/docs/contributed-modules'],
    dataset: 'contrib_module_docs',
    fetchScripts: ['scripts/fetch-contrib-modules.sh'],
    parseScripts: ['etl/parse-contrib-modules.ts'],
    verifyScripts: ['etl/verify-contrib-modules.ts'],
    dataPaths: ['data/sources/contrib-modules'],
    docReferences: ['README.md:159'],
    heuristics: {
      authority: 3.9,
      novelty: 3.9,
      retrievalFit: 3.8,
      redundancyPenalty: 1.8,
      maintenanceCostPenalty: 2.3,
    },
  },
  {
    id: 'contrib_module_handbook',
    name: 'Contrib Module Handbook',
    family: 'community_docs',
    type: 'markdown',
    description: 'Handbook pages for contrib modules fetched via Jina proxy.',
    urls: ['https://www.drupal.org/docs/contributed-modules'],
    dataset: 'contrib_module_handbook',
    fetchScripts: ['scripts/fetch-contrib-module-handbook.ts'],
    parseScripts: ['etl/parse-contrib-module-handbook.ts'],
    verifyScripts: ['etl/verify-contrib-module-handbook.ts'],
    dataPaths: ['data/sources/contrib-modules'],
    docReferences: ['README.md:159'],
    heuristics: {
      authority: 3.7,
      novelty: 3.5,
      retrievalFit: 3.5,
      redundancyPenalty: 2.4,
      maintenanceCostPenalty: 2.5,
    },
  },
  {
    id: 'drupal_module_handbook',
    name: 'Drupal Module Developer Handbook',
    family: 'official_docs',
    type: 'markdown',
    description: 'Official best practices for building Drupal modules.',
    urls: ['https://www.drupal.org/docs/develop'],
    dataset: 'drupal_module_handbook',
    fetchScripts: ['scripts/fetch-drupal-module-handbook.ts'],
    parseScripts: ['etl/parse-drupal-module-handbook.ts'],
    verifyScripts: ['etl/verify-drupal-module-handbook.ts'],
    dataPaths: ['data/sources/drupal-module-handbook'],
    docReferences: ['README.md:160'],
    heuristics: {
      authority: 4.4,
      novelty: 4.0,
      retrievalFit: 4.0,
      redundancyPenalty: 1.5,
      maintenanceCostPenalty: 2.0,
    },
  },
  {
    id: 'drupal_developer_guides',
    name: 'Drupal Developer Guides',
    family: 'official_docs',
    type: 'markdown',
    description: 'Modern Drupal workflow guidance from developer guides.',
    urls: ['https://www.drupal.org/docs/develop/developer-tools'],
    dataset: 'drupal_developer_guides',
    fetchScripts: ['scripts/fetch-developer-guides.sh', 'scripts/fetch-developer-guides-playwright.sh'],
    parseScripts: ['etl/parse-developer-guides.ts'],
    verifyScripts: ['etl/verify-developer-guides.ts'],
    dataPaths: ['data/sources/developer-guides'],
    docReferences: ['README.md:161'],
    heuristics: {
      authority: 4.5,
      novelty: 4.2,
      retrievalFit: 4.1,
      redundancyPenalty: 1.7,
      maintenanceCostPenalty: 2.1,
    },
  },
  {
    id: 'drupal_tutorials',
    name: 'Drupal Tutorials & Articles',
    family: 'tutorials',
    type: 'html',
    description: 'How-to tutorials and articles for practical Drupal tasks.',
    urls: ['https://www.drupal.org/docs'],
    dataset: 'drupal_tutorials',
    fetchScripts: ['scripts/fetch-tutorials.sh', 'scripts/fetch-drupal-tutorial-articles.ts'],
    parseScripts: ['etl/parse-tutorials.ts'],
    verifyScripts: ['etl/verify-tutorials.ts'],
    dataPaths: ['data/sources/tutorials'],
    docReferences: ['README.md:162'],
    heuristics: {
      authority: 3.6,
      novelty: 3.8,
      retrievalFit: 3.7,
      redundancyPenalty: 2.2,
      maintenanceCostPenalty: 2.4,
    },
  },
  {
    id: 'drupal_examples',
    name: 'Drupal Examples Project',
    family: 'community_code',
    type: 'repo',
    description: 'Runnable example implementations from the Drupal Examples project.',
    urls: ['https://www.drupal.org/project/examples'],
    dataset: 'drupal_examples',
    fetchScripts: ['scripts/fetch-drupal-examples.sh'],
    parseScripts: ['etl/parse-drupal-examples.ts'],
    verifyScripts: [],
    dataPaths: ['data/sources/drupal-examples'],
    docReferences: ['README.md:163'],
    heuristics: {
      authority: 3.8,
      novelty: 4.1,
      retrievalFit: 4.2,
      redundancyPenalty: 1.6,
      maintenanceCostPenalty: 2.0,
    },
  },
  {
    id: 'drupal_best_practices',
    name: 'Drupal Best Practices Guide',
    family: 'community_docs',
    type: 'markdown',
    description: 'Community best practices consolidated into a guide.',
    urls: ['https://www.drupal.org/docs/develop/best-practices'],
    dataset: 'drupal_best_practices',
    fetchScripts: ['scripts/fetch-best-practices.sh'],
    parseScripts: ['etl/parse-best-practices.ts'],
    verifyScripts: [],
    dataPaths: ['data/sources/best-practices'],
    docReferences: ['README.md:164'],
    heuristics: {
      authority: 3.9,
      novelty: 3.6,
      retrievalFit: 3.9,
      redundancyPenalty: 2.1,
      maintenanceCostPenalty: 2.2,
    },
  },
  {
    id: 'php_docs',
    name: 'PHP Manual',
    family: 'upstream',
    type: 'html',
    description: 'Official PHP manual pages relevant to Drupal runtime.',
    urls: ['https://www.php.net/manual/en/'],
    dataset: 'php_docs',
    fetchScripts: ['scripts/fetch-php-manual.sh'],
    parseScripts: ['etl/parse-php-manual.ts'],
    verifyScripts: ['etl/verify-php-manual.ts'],
    dataPaths: ['data/sources/php-manual'],
    docReferences: ['README.md:165'],
    heuristics: {
      authority: 4.3,
      novelty: 3.1,
      retrievalFit: 3.4,
      redundancyPenalty: 2.6,
      maintenanceCostPenalty: 2.0,
    },
  },
  {
    id: 'symfony_docs',
    name: 'Symfony Documentation',
    family: 'upstream',
    type: 'html',
    description: 'Symfony component documentation that Drupal builds upon.',
    urls: ['https://symfony.com/doc/current/index.html'],
    dataset: 'symfony_docs',
    fetchScripts: ['scripts/fetch-symfony-docs.sh'],
    parseScripts: ['etl/parse-symfony.ts'],
    verifyScripts: ['etl/verify-symfony.ts'],
    dataPaths: ['data/sources/symfony'],
    docReferences: ['README.md:166'],
    heuristics: {
      authority: 4.1,
      novelty: 3.7,
      retrievalFit: 3.5,
      redundancyPenalty: 2.3,
      maintenanceCostPenalty: 2.2,
    },
  },
  {
    id: 'certification_docs',
    name: 'Acquia Certification Study Guides',
    family: 'certification',
    type: 'pdf',
    description: 'Acquia certification study guide material supporting exam prep.',
    urls: ['https://www.acquia.com/academy'],
    dataset: undefined,
    fetchScripts: ['scripts/fetch-certification-docs.sh', 'scripts/fetch-acquia-certification-study-guides.ts'],
    parseScripts: ['etl/parse-certification-docs.ts'],
    verifyScripts: ['etl/verify-certification-docs.ts'],
    dataPaths: ['data/sources/certification'],
    docReferences: ['README.md:167'],
    heuristics: {
      authority: 3.5,
      novelty: 3.9,
      retrievalFit: 3.2,
      redundancyPenalty: 2.7,
      maintenanceCostPenalty: 2.5,
    },
  },
];

export function getSourceDefinitions(): SourceDefinition[] {
  return SOURCE_DEFINITIONS.slice();
}

const FETCH_PATTERN = /^fetch-.*\.(?:sh|ts)$/;
const VERIFY_PATTERN = /^verify-.*\.ts$/;
const PARSE_PATTERN = /^parse-.*\.ts$/;

export async function buildInventory(rootDir: string): Promise<InventoryResult> {
  const definitions = getSourceDefinitions();
  const now = new Date();
  const items = await Promise.all(
    definitions.map(async (definition) => buildInventoryRecord(rootDir, definition)),
  );

  const unmappedArtifacts = await findUnmappedArtifacts(rootDir, definitions);

  return {
    generatedAt: now.toISOString(),
    items,
    unmappedArtifacts,
  };
}

async function buildInventoryRecord(rootDir: string, definition: SourceDefinition): Promise<SourceInventoryRecord> {
  const artifacts: ArtifactStatus[] = [];
  const evidence: EvidenceEntry[] = [];

  const fetchStatuses = await gatherArtifactStatuses(rootDir, definition.fetchScripts, 'fetch');
  artifacts.push(...fetchStatuses.statuses);
  evidence.push(...fetchStatuses.evidence);

  const parseStatuses = await gatherArtifactStatuses(rootDir, definition.parseScripts, 'parse');
  artifacts.push(...parseStatuses.statuses);
  evidence.push(...parseStatuses.evidence);

  if (definition.verifyScripts && definition.verifyScripts.length > 0) {
    const verifyStatuses = await gatherArtifactStatuses(rootDir, definition.verifyScripts, 'verify');
    artifacts.push(...verifyStatuses.statuses);
    evidence.push(...verifyStatuses.evidence);
  }

  if (definition.dataPaths && definition.dataPaths.length > 0) {
    const dataStatuses = await gatherArtifactStatuses(rootDir, definition.dataPaths, 'data');
    artifacts.push(...dataStatuses.statuses);
    evidence.push(...dataStatuses.evidence);
  }

  if (definition.docReferences && definition.docReferences.length > 0) {
    for (const ref of definition.docReferences) {
      evidence.push({
        type: 'docs',
        description: `Documented in ${ref}`,
        status: 'present',
      });
    }
  }

  const datasetRegistered = definition.dataset !== undefined;
  evidence.push({
    type: 'dataset',
    description: datasetRegistered
      ? `Dataset registered in retrieval: ${definition.dataset}`
      : 'Dataset not yet registered in retrieval tiers',
    status: datasetRegistered ? 'present' : 'missing',
  });

  const latest = computeLatestRevision(artifacts);

  return {
    id: definition.id,
    definition,
    artifacts,
    datasetRegistered,
    latestRevision: latest?.toISOString(),
    daysSinceRevision: latest ? daysBetween(latest, new Date()) : undefined,
    evidence,
  };
}

interface GatherResult {
  statuses: ArtifactStatus[];
  evidence: EvidenceEntry[];
}

async function gatherArtifactStatuses(
  rootDir: string,
  relativePaths: string[],
  type: ArtifactStatus['type'],
): Promise<GatherResult> {
  const statuses: ArtifactStatus[] = [];
  const evidence: EvidenceEntry[] = [];
  for (const relativePath of relativePaths) {
    const absolute = path.join(rootDir, relativePath);
    try {
      const stat = await fs.stat(absolute);
      const status: ArtifactStatus = {
        path: relativePath,
        exists: true,
        lastModified: stat.mtime.toISOString(),
        type,
      };
      statuses.push(status);
      evidence.push({
        type: mapArtifactTypeToEvidence(type),
        path: relativePath,
        description: `${humanizeArtifact(type)} present (${relativePath})`,
        status: 'present',
      });
    } catch {
      const status: ArtifactStatus = {
        path: relativePath,
        exists: false,
        type,
      };
      statuses.push(status);
      evidence.push({
        type: mapArtifactTypeToEvidence(type),
        path: relativePath,
        description: `${humanizeArtifact(type)} missing (${relativePath})`,
        status: 'missing',
      });
    }
  }
  return { statuses, evidence };
}

function mapArtifactTypeToEvidence(type: ArtifactStatus['type']): EvidenceEntry['type'] {
  switch (type) {
    case 'fetch':
      return 'fetch-script';
    case 'parse':
      return 'parse-script';
    case 'verify':
      return 'verify-script';
    case 'data':
      return 'data-path';
    default:
      return 'note';
  }
}

function humanizeArtifact(type: ArtifactStatus['type']): string {
  switch (type) {
    case 'fetch':
      return 'Fetch script';
    case 'parse':
      return 'Parser script';
    case 'verify':
      return 'Verification script';
    case 'data':
      return 'Data directory';
    case 'doc':
      return 'Documentation reference';
    default:
      return 'Artifact';
  }
}

function computeLatestRevision(artifacts: ArtifactStatus[]): Date | undefined {
  const timestamps = artifacts
    .map((artifact) => (artifact.lastModified ? new Date(artifact.lastModified) : undefined))
    .filter((value): value is Date => Boolean(value));
  if (timestamps.length === 0) return undefined;
  return timestamps.reduce((latest, current) => (current > latest ? current : latest));
}

function daysBetween(from: Date, to: Date): number {
  const diff = to.getTime() - from.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

async function findUnmappedArtifacts(
  rootDir: string,
  definitions: SourceDefinition[],
): Promise<UnmappedArtifact[]> {
  const mappedFetch = new Set(definitions.flatMap((def) => def.fetchScripts));
  const mappedParse = new Set(definitions.flatMap((def) => def.parseScripts));
  const mappedVerify = new Set((definitions.flatMap((def) => def.verifyScripts ?? [])));

  const scriptDir = path.join(rootDir, 'scripts');
  const etlDir = path.join(rootDir, 'etl');
  const unmapped: UnmappedArtifact[] = [];

  try {
    const scriptFiles = await fs.readdir(scriptDir);
    for (const file of scriptFiles) {
      const relative = path.posix.join('scripts', file);
      if (FETCH_PATTERN.test(file) && !mappedFetch.has(relative)) {
        unmapped.push({ path: relative, type: 'fetch' });
      }
      if (VERIFY_PATTERN.test(file) && !mappedVerify.has(relative)) {
        unmapped.push({ path: relative, type: 'verify' });
      }
    }
  } catch {
    // ignore folder read errors
  }

  try {
    const etlFiles = await fs.readdir(etlDir);
    for (const file of etlFiles) {
      const relative = path.posix.join('etl', file);
      if (PARSE_PATTERN.test(file) && !mappedParse.has(relative)) {
        unmapped.push({ path: relative, type: 'parse' });
      }
      if (VERIFY_PATTERN.test(file) && !mappedVerify.has(relative)) {
        unmapped.push({ path: relative, type: 'verify' });
      }
    }
  } catch {
    // ignore folder read errors
  }

  return unmapped;
}

export function scoreInventory(inventory: InventoryResult): AssessmentBundle {
  const assessments = inventory.items.map((item) => scoreItem(item));
  return {
    generatedAt: inventory.generatedAt,
    assessments,
  };
}

function scoreItem(item: SourceInventoryRecord): SourceAssessment {
  const {
    definition,
    datasetRegistered,
    latestRevision,
    daysSinceRevision,
    evidence,
  } = item;

  const freshness = computeFreshnessScore(daysSinceRevision);
  const maintenanceCostPenalty = adjustPenalty(
    definition.heuristics.maintenanceCostPenalty,
    item.artifacts,
  );
  const redundancyPenalty = definition.heuristics.redundancyPenalty;
  const authority = definition.heuristics.authority;
  const novelty = definition.heuristics.novelty;
  const retrievalFit = adjustRetrievalFit(
    definition.heuristics.retrievalFit,
    item.artifacts,
  );

  const scorecard = computeScorecard({
    authority,
    freshness,
    novelty,
    retrievalFit,
    redundancyPenalty,
    maintenanceCostPenalty,
  });

  const recommendation = classifyRecommendation(scorecard, {
    datasetRegistered,
    missingArtifacts: countMissingArtifacts(item.artifacts),
  });

  const rationale = buildRationale(definition, scorecard, daysSinceRevision, {
    datasetRegistered,
    missingArtifacts: countMissingArtifacts(item.artifacts),
  });

  return {
    id: item.id,
    name: definition.name,
    family: definition.family,
    type: definition.type,
    dataset: definition.dataset,
    urls: definition.urls,
    scorecard,
    recommendation,
    rationale,
    evidence,
    latestRevision,
    daysSinceRevision,
  };
}

function computeFreshnessScore(daysSinceRevision?: number): number {
  if (daysSinceRevision === undefined) return 2.5;
  if (daysSinceRevision <= 30) return 4.6;
  if (daysSinceRevision <= 90) return 4.2;
  if (daysSinceRevision <= 180) return 3.8;
  if (daysSinceRevision <= 365) return 3.2;
  if (daysSinceRevision <= 540) return 2.8;
  if (daysSinceRevision <= 720) return 2.4;
  return 2.0;
}

function adjustPenalty(base: number, artifacts: ArtifactStatus[]): number {
  const missingFetch = artifacts.filter((artifact) => artifact.type === 'fetch' && !artifact.exists).length;
  const missingParse = artifacts.filter((artifact) => artifact.type === 'parse' && !artifact.exists).length;
  const penalty = base + missingFetch * 0.3 + missingParse * 0.3;
  return clamp(penalty, 0, 5);
}

function adjustRetrievalFit(base: number, artifacts: ArtifactStatus[]): number {
  const missingParse = artifacts.filter((artifact) => artifact.type === 'parse' && !artifact.exists).length;
  if (missingParse > 0) {
    return clamp(base - 0.5 * missingParse, 0, 5);
  }
  return base;
}

interface ScorecardInput {
  authority: number;
  freshness: number;
  novelty: number;
  retrievalFit: number;
  redundancyPenalty: number;
  maintenanceCostPenalty: number;
}

function computeScorecard(input: ScorecardInput): Scorecard {
  const weights = {
    authority: 0.25,
    freshness: 0.2,
    novelty: 0.18,
    retrievalFit: 0.2,
    redundancyPenalty: 0.07,
    maintenanceCostPenalty: 0.1,
  } as const;

  const positive =
    input.authority * weights.authority +
    input.freshness * weights.freshness +
    input.novelty * weights.novelty +
    input.retrievalFit * weights.retrievalFit;

  const penalty =
    input.redundancyPenalty * weights.redundancyPenalty +
    input.maintenanceCostPenalty * weights.maintenanceCostPenalty;

  const overall = clamp(
    (positive - penalty) /
      (weights.authority + weights.freshness + weights.novelty + weights.retrievalFit),
    0,
    5,
  );

  return {
    authority: round(input.authority),
    freshness: round(input.freshness),
    novelty: round(input.novelty),
    retrievalFit: round(input.retrievalFit),
    redundancyPenalty: round(input.redundancyPenalty),
    maintenanceCostPenalty: round(input.maintenanceCostPenalty),
    overall: round(overall),
  };
}

function classifyRecommendation(
  scorecard: Scorecard,
  context: { datasetRegistered: boolean; missingArtifacts: number },
): RecommendationAction {
  if (!context.datasetRegistered && scorecard.overall >= 3.6) {
    return 'add';
  }
  if (context.missingArtifacts > 0 && scorecard.overall >= 3.0) {
    return 'review';
  }
  if (scorecard.overall >= 4.0) {
    return 'keep';
  }
  if (scorecard.overall <= 2.6) {
    return 'deprioritize';
  }
  return 'review';
}

function buildRationale(
  definition: SourceDefinition,
  scorecard: Scorecard,
  daysSinceRevision: number | undefined,
  context: { datasetRegistered: boolean; missingArtifacts: number },
): string {
  const parts: string[] = [];
  parts.push(`${definition.name} scored ${scorecard.overall.toFixed(1)} overall`);
  if (!context.datasetRegistered) {
    parts.push('not currently part of retrieval tiers');
  }
  if (context.missingArtifacts > 0) {
    parts.push(`missing ${context.missingArtifacts} pipeline artifact${context.missingArtifacts === 1 ? '' : 's'}`);
  }
  if (daysSinceRevision !== undefined) {
    parts.push(`last touched ${daysSinceRevision} day${daysSinceRevision === 1 ? '' : 's'} ago`);
  }
  if (scorecard.authority >= 4.5) {
    parts.push('high-authority source');
  }
  if (scorecard.maintenanceCostPenalty >= 2.5) {
    parts.push('requires higher maintenance effort');
  }
  return parts.join('; ');
}

function countMissingArtifacts(artifacts: ArtifactStatus[]): number {
  return artifacts.filter((artifact) => !artifact.exists && artifact.type !== 'doc').length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function createMarkdownReport(bundle: AssessmentBundle, summary?: string | null): string {
  const grouped = groupByAction(bundle.assessments);
  const lines: string[] = [];
  lines.push(`# research-sources recommendations`);
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
  for (const action of ['add', 'keep', 'review', 'deprioritize'] as RecommendationAction[]) {
    const assessments = grouped[action] ?? [];
    const avg =
      assessments.length > 0
        ? (assessments.reduce((sum, item) => sum + item.scorecard.overall, 0) / assessments.length).toFixed(2)
        : '—';
    lines.push(`| ${action} | ${assessments.length} | ${avg} |`);
  }
  lines.push('');

  for (const action of ['add', 'keep', 'review', 'deprioritize'] as RecommendationAction[]) {
    const assessments = grouped[action] ?? [];
    if (assessments.length === 0) continue;
    lines.push(`## ${capitalize(action)}`);
    lines.push('');
    for (const assessment of assessments.sort((a, b) => b.scorecard.overall - a.scorecard.overall)) {
      lines.push(`### ${assessment.name} (${assessment.scorecard.overall.toFixed(1)})`);
      lines.push('');
      lines.push(`- **Family**: ${assessment.family}`);
      if (assessment.dataset) {
        lines.push(`- **Dataset**: ${assessment.dataset}`);
      } else {
        lines.push(`- **Dataset**: _(not registered)_`);
      }
      lines.push(`- **Action**: ${assessment.recommendation}`);
      lines.push(`- **Rationale**: ${assessment.rationale}`);
      if (assessment.daysSinceRevision !== undefined) {
        lines.push(`- **Last pipeline change**: ${assessment.daysSinceRevision} day${assessment.daysSinceRevision === 1 ? '' : 's'} ago`);
      }
      lines.push('');
      lines.push('| Dimension | Score |');
      lines.push('| --- | ---: |');
      lines.push(`| Authority | ${assessment.scorecard.authority.toFixed(1)} |`);
      lines.push(`| Freshness | ${assessment.scorecard.freshness.toFixed(1)} |`);
      lines.push(`| Novelty | ${assessment.scorecard.novelty.toFixed(1)} |`);
      lines.push(`| Retrieval fit | ${assessment.scorecard.retrievalFit.toFixed(1)} |`);
      lines.push(`| Redundancy penalty | ${assessment.scorecard.redundancyPenalty.toFixed(1)} |`);
      lines.push(`| Maintenance cost penalty | ${assessment.scorecard.maintenanceCostPenalty.toFixed(1)} |`);
      lines.push('');
      lines.push('**Key Evidence**');
      lines.push('');
      for (const ev of assessment.evidence.slice(0, 5)) {
        const statusPrefix = ev.status ? `${ev.status === 'present' ? '✅' : '⚠️'} ` : '';
        const pathSuffix = ev.path ? ` (${ev.path})` : '';
        lines.push(`- ${statusPrefix}${ev.description}${pathSuffix}`);
      }
      lines.push('');
    }
  }

  if (bundle.assessments.length === 0) {
    lines.push('_No sources evaluated._');
  }

  return lines.join('\n');
}

function groupByAction(assessments: SourceAssessment[]): Record<RecommendationAction, SourceAssessment[]> {
  return assessments.reduce((acc, item) => {
    if (!(item.recommendation in acc)) {
      acc[item.recommendation] = [];
    }
    acc[item.recommendation].push(item);
    return acc;
  },
  {
    add: [] as SourceAssessment[],
    keep: [] as SourceAssessment[],
    review: [] as SourceAssessment[],
    deprioritize: [] as SourceAssessment[],
  });
}

function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1);
}

export function summarizeUnmapped(unmapped: UnmappedArtifact[]): string[] {
  return unmapped.map((artifact) => `${artifact.type} :: ${artifact.path}`);
}
