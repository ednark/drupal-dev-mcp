import { access, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const CORE_REPOSITORY = 'https://git.drupalcode.org/project/drupal.git';
const CORE_LINES = [
  { version: '10.6', branch: '10.6.x', directory: 'drupal-core-10.6' },
  { version: '11.4', branch: '11.4.x', directory: 'drupal-core-11.4' },
  // Drupal 12.0 is pre-release (12.0.0 ships the week of Dec 7, 2026); pin the
  // stable 12.0.x branch rather than `main`, which rolls to 12.1.x afterwards.
  { version: '12.0', branch: '12.0.x', directory: 'drupal-core-12.0' },
] as const;

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

export async function fetchCoreSnapshots(repoRoot: string): Promise<void> {
  const sources = path.join(repoRoot, 'data', 'sources');
  await mkdir(sources, { recursive: true });
  for (const core of CORE_LINES) {
    const target = path.join(sources, core.directory);
    try {
      await access(path.join(target, '.git'));
      await run('git', ['fetch', '--depth=1', 'origin', core.branch], target);
      await run('git', ['reset', '--hard', 'FETCH_HEAD'], target);
    } catch {
      await run('git', ['clone', '--depth=1', '--single-branch', '--branch', core.branch, CORE_REPOSITORY, target], sources);
    }
  }
}

/**
 * Idempotent refresh scripts for the remaining git-based sources, relative
 * to the repo root. Each script tolerates per-module failures internally and
 * exits non-zero only when the script itself cannot run.
 */
export const GIT_SOURCE_SCRIPTS = [
  'scripts/fetch-contrib-module-code.sh',
  'scripts/fetch-drupal-examples.sh',
  'scripts/fetch-drupal-skills.sh',
  'scripts/fetch-symfony-docs.sh',
  'scripts/fetch-phpstan-drupal.sh',
] as const;

export interface FetchSummary {
  succeeded: string[];
  failed: string[];
}

/**
 * One-command refresh of every git-based source: core snapshots plus
 * contrib code, examples, skills, and symfony docs. Web-fetched sources
 * (guides, API docs, change records, …) keep their per-family scripts and
 * are intentionally out of scope here.
 */
export async function fetchGitSources(repoRoot: string): Promise<FetchSummary> {
  await fetchCoreSnapshots(repoRoot);
  const succeeded = ['drupal-core'];
  const failed: string[] = [];
  for (const script of GIT_SOURCE_SCRIPTS) {
    try {
      await run('bash', [script], repoRoot);
      succeeded.push(script);
    } catch {
      failed.push(script);
    }
  }
  if (failed.length) throw new Error(`Git source refresh failed for: ${failed.join(', ')}`);
  return { succeeded, failed };
}
