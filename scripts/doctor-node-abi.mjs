#!/usr/bin/env node
/**
 * Native-module ABI doctor.
 *
 * better-sqlite3 compiles (or downloads a prebuild) for one specific Node ABI.
 * After a major Node upgrade the existing binary fails to load with a cryptic
 * ERR_DLOPEN_FAILED wall. This check runs before the test suite and turns
 * that failure into a one-line fix.
 *
 * Wired as the root package.json `pretest` lifecycle script, so it gates
 * `npm test` and `npm run check`.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.close();
  console.log(`doctor: node ${process.version} (ABI ${process.versions.modules}) — better-sqlite3 loads ok`);
} catch (error) {
  const firstLine = String(error.message).split('\n')[0];
  console.error(`
✖ better-sqlite3's native module failed to load under node ${process.version} (ABI ${process.versions.modules}).

  Likely cause: a Node major upgrade changed the ABI, and the compiled module
  targets a different one (or a matching prebuild does not exist for this
  Node version — older better-sqlite3 releases stop prebuilding new ABIs).

  Fix:    npm rebuild better-sqlite3
  If the rebuild compiles from source and fails, upgrade better-sqlite3 to a
  release that supports this Node version.

  (${firstLine})
`);
  process.exit(1);
}