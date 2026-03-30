/**
 * Verification script for the contrib module handbook parser.
 *
 * Usage:
 *   npx tsx etl/verify-contrib-module-handbook.ts
 *
 * Expected output when the contrib_module_handbook LanceDB table exists:
 *   Verifying contrib_module_handbook LanceDB dataset...
 *   ✅ Verified contrib_module_handbook table with <N> rows.
 *   Sample rows:
 *   [1] section=..., file_path=..., source=contrib_module_handbook
 *   ...
 *   Unique modules (by file_path): <M>
 */

import * as lancedb from '@lancedb/lancedb';
import { validateConfig } from '../src/config.js';

async function verifyContribModuleHandbook(): Promise<void> {
  console.log('Verifying contrib_module_handbook LanceDB dataset...');
  const config = validateConfig();
  const db = await lancedb.connect(config.lancedbPath);

  try {
    const table = await db.openTable('contrib_module_handbook');
    const count = await table.countRows();

    if (count === 0) {
      console.error('❌ contrib_module_handbook table is empty.');
      process.exit(1);
    }

    if (count < 100) {
      console.warn(`⚠ contrib_module_handbook table has only ${count} rows (expected ≥ 100). Data may be incomplete.`);
    }
    else {
      console.log(`✅ Verified contrib_module_handbook table with ${count} rows.`);
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

    // Count unique modules by inspecting file_path values
    const allRows = await table.query().toArray();
    const uniqueFilePaths = new Set<string>(
      allRows.map((row) => String((row as Record<string, unknown>).file_path ?? '')).filter(Boolean),
    );
    console.log(`\nUnique file paths (handbook files): ${uniqueFilePaths.size}`);
  }
  catch (err) {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifyContribModuleHandbook();
}
