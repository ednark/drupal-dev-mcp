import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IndexStatus } from '../types.js';

export interface ActiveManifest {
  schemaVersion: number;
  runId: string;
  buildPath: string;
  builtAt: string;
  defaultDrupalVersion: '11.4';
  availableDrupalVersions: string[];
  embeddingModel?: string;
  counts: Record<string, number>;
  /** Per-directory file cap used at build time, if any (fixture builds). */
  fixtureLimit?: number;
  verification: { passed: boolean; errors: string[]; warnings: string[] };
}

export function findRepoRoot(start = process.cwd()): string {
  let current = path.resolve(start);
  while (path.dirname(current) !== current) {
    try {
      const packagePath = path.join(current, 'package.json');
      // Synchronous-free existence check is not needed here; callers use known repo paths.
      if (current.endsWith('drupal-dev-mcp')) return current;
      if (packagePath && current === process.cwd() && path.basename(current) === 'drupal-dev-mcp') return current;
    } catch { /* continue */ }
    current = path.dirname(current);
  }
  return path.resolve(start);
}

export function getDefaultIndexRoot(repoRoot = findRepoRoot()): string {
  return process.env.DRUPAL_MCP_INDEX_ROOT
    ? path.resolve(process.env.DRUPAL_MCP_INDEX_ROOT)
    : path.join(repoRoot, 'data', 'index');
}

export async function resolveActiveBuild(indexRoot = getDefaultIndexRoot()): Promise<ActiveManifest | null> {
  const activePath = path.join(indexRoot, 'active.json');
  try {
    await access(activePath);
    return JSON.parse(await readFile(activePath, 'utf8')) as ActiveManifest;
  } catch {
    return null;
  }
}

export function statusFromManifest(manifest: ActiveManifest | null): IndexStatus {
  if (!manifest) {
    return {
      ready: false,
      schemaVersion: 1,
      defaultDrupalVersion: '11.4',
      availableDrupalVersions: ['10.6', '11.4', '12.0'],
      counts: {},
      verification: { passed: false, errors: ['No active index build'], warnings: [] },
    };
  }
  return {
    ready: manifest.verification.passed,
    schemaVersion: manifest.schemaVersion,
    runId: manifest.runId,
    builtAt: manifest.builtAt,
    defaultDrupalVersion: manifest.defaultDrupalVersion,
    availableDrupalVersions: manifest.availableDrupalVersions,
    counts: manifest.counts,
    embeddingModel: manifest.embeddingModel,
    buildPath: manifest.buildPath,
    fixtureLimit: manifest.fixtureLimit,
    verification: manifest.verification,
  };
}
