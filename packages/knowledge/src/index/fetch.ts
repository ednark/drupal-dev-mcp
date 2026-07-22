import { access, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const CORE_REPOSITORY = 'https://git.drupalcode.org/project/drupal.git';
const CORE_LINES = [
  { version: '10.6', branch: '10.6.x', directory: 'drupal-core-10.6' },
  { version: '11.4', branch: '11.4.x', directory: 'drupal-core-11.4' },
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
