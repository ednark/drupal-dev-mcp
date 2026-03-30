/**
 * Verification script for the Drupal module handbook parser.
 *
 * Usage:
 *   npx tsx etl/verify-drupal-module-handbook.ts
 *
 * Expected output when the drupal_module_handbook LanceDB table exists:
 *   Verifying drupal_module_handbook LanceDB dataset...
 *   ✅ Verified drupal_module_handbook table with <N> rows.
 *   Sample rows:
 *   [1] section=..., file_path=..., source=drupal_module_handbook
 *   ...
 *   Unique file paths (handbook files): <M>
 *   ✅ Topic coverage: hooks=true, services=true, routing=true
 */

import * as lancedb from '@lancedb/lancedb';
import { validateConfig } from '../src/config.js';

async function verifyDrupalModuleHandbook(): Promise<void> {
  console.log('Verifying drupal_module_handbook LanceDB dataset...');
  const config = validateConfig();
  const db = await lancedb.connect(config.lancedbPath);

  try {
    const table = await db.openTable('drupal_module_handbook');
    const count = await table.countRows();

    if (count === 0) {
      console.error('❌ drupal_module_handbook table is empty.');
      process.exit(1);
    }

    if (count < 200) {
      console.warn(
        `⚠ drupal_module_handbook table has only ${count} rows (expected ≥ 200). Data may be incomplete.`,
      );
    }
    else {
      console.log(`✅ Verified drupal_module_handbook table with ${count} rows.`);
    }

    // Show 5 sample rows
    const sample = await table.query().limit(5).toArray();
    console.log('Sample rows:');
    sample.forEach((row, index) => {
      const r = row as Record<string, unknown>;
      console.log(
        `[${index + 1}] section=${String(r.section ?? 'null')}, file_path=${String(r.file_path ?? 'null')}, source=${String(r.source ?? 'null')}`,
      );
    });

    // Count unique file paths
    const allRows = await table.query().toArray();
    const uniqueFilePaths = new Set<string>(
      allRows
        .map((row) => String((row as Record<string, unknown>).file_path ?? ''))
        .filter(Boolean),
    );
    console.log(`\nUnique file paths (handbook files): ${uniqueFilePaths.size}`);

    // Verify at least 3 topic areas are covered: hooks, services, routing
    const pathList = [...uniqueFilePaths];
    const hasHooks = pathList.some((p) => p.includes('hooks'));
    const hasServices = pathList.some((p) => p.includes('services'));
    const hasRouting = pathList.some((p) => p.includes('routing'));

    const topicCount = [hasHooks, hasServices, hasRouting].filter(Boolean).length;
    const topicLine = `hooks=${String(hasHooks)}, services=${String(hasServices)}, routing=${String(hasRouting)}`;

    if (topicCount >= 3) {
      console.log(`✅ Topic coverage: ${topicLine}`);
    }
    else {
      console.warn(
        `⚠ Topic coverage is low (${topicCount}/3 expected areas found): ${topicLine}`,
      );
    }
  }
  catch (err) {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifyDrupalModuleHandbook();
}
