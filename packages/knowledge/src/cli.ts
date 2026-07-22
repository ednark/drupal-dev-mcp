#!/usr/bin/env node
import path from 'node:path';
import { buildIndex } from './index/builder.js';
import { fetchCoreSnapshots } from './index/fetch.js';
import { findRepoRoot, getDefaultIndexRoot, resolveActiveBuild, statusFromManifest } from './index/manifest.js';
import { verifyActiveIndex } from './index/verify.js';

async function main(): Promise<void> {
  const [command = 'status', ...args] = process.argv.slice(2);
  const repoRoot = findRepoRoot(process.cwd());
  const indexRoot = getDefaultIndexRoot(repoRoot);
  const withEmbeddings = args.includes('--with-embeddings');
  const fixtureArg = args.find(argument => argument.startsWith('--fixture-limit='));
  const fixtureLimit = fixtureArg ? Number(fixtureArg.split('=')[1]) : undefined;
  if (command === 'fetch') {
    await fetchCoreSnapshots(repoRoot);
    return;
  }
  if (command === 'build' || command === 'rebuild') {
    if (command === 'rebuild' && args.includes('--fetch')) await fetchCoreSnapshots(repoRoot);
    const result = await buildIndex({ repoRoot, indexRoot, fixtureLimit, withEmbeddings, activate: !args.includes('--no-activate') });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.verification.passed) process.exitCode = 1;
    return;
  }
  if (command === 'verify') {
    const result = await verifyActiveIndex(indexRoot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
    return;
  }
  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(statusFromManifest(await resolveActiveBuild(indexRoot)), null, 2)}\n`);
    return;
  }
  throw new Error(`Unknown command: ${command}. Use fetch, build, rebuild, verify, or status.`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
