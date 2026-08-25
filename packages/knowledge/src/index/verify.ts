import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from '../storage/schema.js';
import { resolveActiveBuild, getDefaultIndexRoot } from './manifest.js';

export interface VerificationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  counts: Record<string, number>;
}

export async function verifyBuild(buildPath: string): Promise<VerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  let db;
  try {
    db = openDatabase(path.join(buildPath, 'knowledge.sqlite'), true);
    for (const table of ['documents', 'chunks', 'entities', 'relations', 'source_snapshots']) {
      counts[table] = Number((db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count);
    }
    const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (!integrity.every(result => result.integrity_check === 'ok')) errors.push('SQLite integrity check failed');
    const foreign = db.pragma('foreign_key_check') as unknown[];
    if (foreign.length) errors.push(`${foreign.length} foreign-key violations`);
    const missingResources = Number((db.prepare(`SELECT count(*) AS count FROM entities e LEFT JOIN nodes n ON n.id=e.id WHERE n.id IS NULL`).get() as { count: number }).count);
    if (missingResources) errors.push(`${missingResources} entities have no resource node`);
    if (!counts.documents) errors.push('Index has no documents');
    if (!counts.chunks) errors.push('Index has no chunks');
    if (!counts.entities) warnings.push('Index has no semantic entities');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally { db?.close(); }
  return { passed: errors.length === 0, errors, warnings, counts };
}

export async function verifyActiveIndex(indexRoot = getDefaultIndexRoot()): Promise<VerificationResult> {
  const active = await resolveActiveBuild(indexRoot);
  if (!active) return { passed: false, errors: ['No active index'], warnings: [], counts: {} };
  const result = await verifyBuild(active.buildPath);
  await writeFile(path.join(active.buildPath, 'verification.runtime.json'), JSON.stringify(result, null, 2));
  return result;
}

export async function readBuildVerification(buildPath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(buildPath, 'verification.json'), 'utf8'));
}
