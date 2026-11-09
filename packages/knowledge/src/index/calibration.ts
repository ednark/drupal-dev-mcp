import path from 'node:path';
import * as lancedb from '@lancedb/lancedb';

/**
 * Semantic-score calibration, carried by the build manifest (2026-11-09).
 *
 * History: the semantic↔lexical scale anchors in the query provider were
 * hand-measured on 2026-08-25 against `text-embedding-3-small` cosine
 * distances (see docs/score-calibration.md) and hard-coded as constants.
 * That is a silent-corruption hazard: any embedding-model change re-scales
 * cosine distances, and the old anchors then mis-rank hybrid results with
 * no error anywhere. The constants were "correct" only for one model on one
 * corpus snapshot.
 *
 * Rules now enforced by code, not comments:
 *
 * 1. Calibration travels with the build: every build that creates vectors
 *    also measures its own anchors (buildIndex → measureSemanticCalibration)
 *    and stores them in manifest.json. The provider reads them from the
 *    manifest — swapping the embedding model automatically carries its own
 *    scale.
 * 2. A build whose vectors were embedded with a model that has NO calibration
 *    in the manifest degrades to lexical-only mode (degradedMode) rather
 *    than applying wrong anchors. Never silently mis-rank.
 * 3. The legacy constants remain valid ONLY for the one hand-calibrated
 *    model (LEGACY_CALIBRATED_EMBEDDING_MODEL) — builds from before this
 *    change keep working unchanged.
 * 4. Re-evaluation: `npx tsx packages/knowledge/src/cli.ts calibrate [--write]`
 *    re-measures anchors against a build's existing vector table (same
 *    embedding model — that is the point) and prints or persists them.
 */

/** The only model whose hand-measured anchors (0.8 / 1.05) ship as fallback. */
export const LEGACY_CALIBRATED_EMBEDDING_MODEL = 'text-embedding-3-small';

/** Hand-measured 2026-08-25 (docs/score-calibration.md); legacy fallback only. */
export const LEGACY_SEMANTIC_ANCHORS = { excellent: 0.8, irrelevant: 1.05 } as const;

export interface SemanticCalibration {
  /** Model the vectors AND the probe embeddings were produced with. */
  embeddingModel: string;
  /** Distances at or below this map to relevance 1.0. */
  excellent: number;
  /** Distances at or beyond this map to relevance 0. */
  irrelevant: number;
  measuredAt: string;
  /** Number of probe queries behind the anchors. */
  probeQueries: number;
  /** Derivation rule, so a future reader can reproduce it. */
  method: string;
}

export interface ResolvedSemanticAnchors {
  excellent: number;
  irrelevant: number;
  /** 'manifest' = measured for this build; 'legacy-default' = hand-measured fallback. */
  source: 'manifest' | 'legacy-default';
}

/** Calibration-shaped manifest input (keeps resolveSemanticAnchors unit-testable). */
export interface CalibrationManifestInput {
  embeddingModel?: string;
  semanticCalibration?: SemanticCalibration;
}

export function resolveSemanticAnchors(manifest: CalibrationManifestInput): ResolvedSemanticAnchors | null {
  const calibration = manifest.semanticCalibration;
  if (calibration) {
    // The anchors are only meaningful for the model they were measured with.
    // A mismatch means the manifest was edited post-hoc — refuse rather than
    // guess (rule 2).
    if (!manifest.embeddingModel || calibration.embeddingModel !== manifest.embeddingModel) return null;
    return { excellent: calibration.excellent, irrelevant: calibration.irrelevant, source: 'manifest' };
  }
  if (manifest.embeddingModel === LEGACY_CALIBRATED_EMBEDDING_MODEL) {
    return { ...LEGACY_SEMANTIC_ANCHORS, source: 'legacy-default' };
  }
  return null;
}

/**
 * Deterministic anchor derivation (mirrors the 2026-08-25 hand measurement):
 * - excellent: p10 of on-topic top-K distances, snapped to the 0.05 grid —
 *   only the best ~10% of on-topic hits deserve a perfect score.
 * - irrelevant: median of the best-hit distance across unrelated control
 *   queries, snapped UP to the next 0.05 — nothing at or beyond typical
 *   unrelated-query territory deserves a nonzero score.
 */
export function deriveAnchors(onTopicDistances: number[], unrelatedBestDistances: number[]): { excellent: number; irrelevant: number } {
  if (onTopicDistances.length === 0 || unrelatedBestDistances.length === 0) {
    throw new Error('Calibration requires both on-topic and unrelated-control distances');
  }
  const quantile = (values: number[], q: number): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(q * (sorted.length - 1)));
    return sorted[index]!;
  };
  const snap = (value: number, direction: 'nearest' | 'up'): number =>
    direction === 'nearest'
      ? Math.round(value / 0.05) * 0.05
      : Math.ceil(value / 0.05) * 0.05;
  return {
    excellent: Number(snap(quantile(onTopicDistances, 0.10), 'nearest').toFixed(2)),
    irrelevant: Number(snap(quantile(unrelatedBestDistances, 0.5), 'up').toFixed(2)),
  };
}

/** Calibration probe queries: what agents actually ask, plus unrelated controls. */
export const CALIBRATION_PROBES = {
  // Natural-language concept questions — the paraphrase regime vectors serve.
  onTopic: [
    'Drupal 11 implementation best practices',
    'how to invalidate a custom block when its content is edited',
    'cache tags versus cache contexts for node lists',
    'prevent XSS in Twig templates with user submitted data',
    'dependency injection into a custom block plugin',
    'migrate API process pipeline for multivalued fields',
    'render array with lazy builder and placeholders',
    'entity reference field target bundles configuration',
  ],
  // Identifier-style probes: lexical handles these; they must NOT drag the
  // excellent anchor down (they are excluded from on-topic scoring here).
  identifier: ['hook_entity_presave', 'EntityTypeManagerInterface', 'BaseFieldDefinition'],
  // Deliberately out-of-domain controls — their best-hit distance is the
  // empirical irrelevance floor.
  unrelated: [
    'sourdough bread starter feeding schedule',
    '1998 FIFA World Cup final winner',
    'knitting pattern for a wool scarf',
    'weather forecast Paris next week',
  ],
} as const;

export interface MeasureCalibrationOptions {
  buildPath: string;
  embeddingModel: string;
  /** Embeds texts with the SAME model that built the vectors. */
  embed: (texts: string[]) => Promise<number[][]>;
  /** Hits per probe query (default 8, mirroring the original measurement). */
  topK?: number;
}

/**
 * Measures semantic anchors for an existing vector index by embedding probe
 * queries and sampling LanceDB distances. Throws on any failure — callers
 * decide whether that is a build warning or a hard error.
 */
export async function measureSemanticCalibration(options: MeasureCalibrationOptions): Promise<SemanticCalibration> {
  const { buildPath, embeddingModel, embed } = options;
  const topK = options.topK ?? 8;
  const vectorDb = await lancedb.connect(path.join(buildPath, 'vectors.lance'));
  const table = await vectorDb.openTable('chunk_vectors');

  const probe = async (query: string): Promise<number[]> => {
    const [vector] = await embed([query]);
    if (!vector) throw new Error(`Calibration embedder returned no vector for: ${query}`);
    const rows = await table.vectorSearch(vector).limit(topK).toArray() as unknown as Array<{ _distance: number }>;
    return rows.map(row => row._distance);
  };

  const onTopicTopK: number[] = [];
  for (const query of CALIBRATION_PROBES.onTopic) onTopicTopK.push(...await probe(query));
  const unrelatedBest: number[] = [];
  for (const query of CALIBRATION_PROBES.unrelated) {
    const distances = await probe(query);
    if (distances.length > 0) unrelatedBest.push(Math.min(...distances));
  }

  const { excellent, irrelevant } = deriveAnchors(onTopicTopK, unrelatedBest);
  return {
    embeddingModel,
    excellent,
    irrelevant,
    measuredAt: new Date().toISOString(),
    probeQueries: CALIBRATION_PROBES.onTopic.length + CALIBRATION_PROBES.unrelated.length,
    method: 'excellent=p10(on-topic top-8 distances, 0.05 grid); irrelevant=p50(unrelated best-hit distances, snapped up to 0.05)',
  };
}
