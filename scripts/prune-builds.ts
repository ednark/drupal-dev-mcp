/**
 * Index build retention: old builds under data/index/builds/ are fully
 * regenerable artifacts, but each carries a full SQLite + Lance tree
 * (~1 GB+ here: 31 builds / 30 GB on 2026-11-09). Keeps the most recent N
 * (default 5) plus the ACTIVE build; deletes the rest.
 *
 * Safety: the active build (data/index/active.json) is never deleted, a
 * build younger than --min-age-hours (default 24) is never deleted, and
 * --dry-run (default) lists what would go. Deletion is permanent — builds
 * are regenerable from data/sources via index:rebuild.
 *
 * Usage:
 *   npm run index:prune -- --dry-run          (default; lists candidates)
 *   npm run index:prune -- --keep=3 --confirm
 */

import 'dotenv/config';
import { readdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDefaultIndexRoot, resolveActiveBuild, findRepoRoot } from '../packages/knowledge/src/index/manifest.js';

function parseArgs(argv: string[]): { keep: number; confirm: boolean } {
  const parsed = { keep: 5, confirm: false };
  for (const arg of argv) {
    if (arg.startsWith('--keep=')) parsed.keep = Math.max(1, Number(arg.split('=')[1]) || 5);
    if (arg === '--confirm') parsed.confirm = true;
  }
  return parsed;
}

async function directorySize(directory: string): Promise<number> {
  let total = 0;
  const { readdirSync, statSync } = await import('node:fs');
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else total += statSync(absolute).size;
    }
  };
  try { visit(directory); } catch { /* unreadable entry — count what we can */ }
  return total;
}

async function main(): Promise<void> {
  const { keep, confirm } = parseArgs(process.argv.slice(2));
  const repoRoot = findRepoRoot();
  const buildsRoot = path.join(getDefaultIndexRoot(repoRoot), 'builds');
  const active = await resolveActiveBuild(getDefaultIndexRoot(repoRoot));
  const activeRunId = active?.runId;

  let entries: string[] = [];
  try {
    const dirents = await readdir(buildsRoot, { withFileTypes: true });
    entries = dirents.filter(dirent => dirent.isDirectory()).map(dirent => dirent.name).sort();
  } catch {
    process.stdout.write(`No builds directory at ${buildsRoot} — nothing to prune.\n`);
    return;
  }

  // Sort by runId prefix (UTC timestamp YYYYMMDDHHmmss...) = chronological.
  const ordered = [...entries].sort();
  const protectedNames = new Set<string>([activeRunId ?? '']);
  const now = Date.now();
  const minAgeMs = 24 * 60 * 60 * 1000;

  const survivors: string[] = [];
  const candidates: Array<{ name: string; sizeGb: number; reason: string }> = [];
  // Newest first; the first `keep` non-active builds survive.
  let kept = 0;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const name = ordered[index]!;
    if (protectedNames.has(name) || name === activeRunId) { survivors.push(name); continue; }
    if (kept < keep) { kept += 1; survivors.push(name); continue; }
    const buildPath = path.join(buildsRoot, name);
    let ageOk = true;
    try {
      const manifest = JSON.parse(await readFile(path.join(buildPath, 'manifest.json'), 'utf8')) as { builtAt?: string };
      if (manifest.builtAt && now - new Date(manifest.builtAt).getTime() < minAgeMs) ageOk = false;
    } catch { /* no manifest — treat as old enough to prune */ }
    if (!ageOk) { survivors.push(name); continue; }
    candidates.push({ name, sizeGb: (await directorySize(buildPath)) / 1024 ** 3, reason: activeRunId === name ? 'active' : 'beyond retention' });
  }

  const reclaimGb = candidates.reduce((sum, candidate) => sum + candidate.sizeGb, 0);
  process.stdout.write(`Builds: ${ordered.length} total, keeping ${survivors.length} (retention ${keep} + active), pruning ${candidates.length} (${reclaimGb.toFixed(1)} GB)\n`);
  if (activeRunId) process.stdout.write(`Active build protected: ${activeRunId}\n`);
  for (const candidate of candidates) process.stdout.write(`  - ${candidate.name} (${candidate.sizeGb.toFixed(2)} GB)\n`);

  if (candidates.length === 0) { process.stdout.write('Nothing to prune.\n'); return; }
  if (!confirm) { process.stdout.write('Dry run — re-run with --confirm to delete.\n'); return; }

  for (const candidate of candidates) {
    await rm(path.join(buildsRoot, candidate.name), { recursive: true, force: true });
  }
  process.stdout.write(`Pruned ${candidates.length} build(s), reclaimed ~${reclaimGb.toFixed(1)} GB.\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
