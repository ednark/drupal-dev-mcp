import * as lancedb from '@lancedb/lancedb';
import { validateConfig } from '../src/config.js';

async function verifyTutorials(): Promise<void> {
  console.log('Verifying Tutorials LanceDB dataset...');
  const config = validateConfig();
  const db = await lancedb.connect(config.lancedbPath);

  try {
    const table = await db.openTable('drupal_tutorials');
    const count = await table.countRows();

    if (count === 0) {
      console.error('❌ Tutorials table is empty.');
      process.exit(1);
    }

    if (count < 50) {
      console.warn(`⚠️  Warning: drupal_tutorials table has only ${count} rows (expected ≥ 50). Pipeline may be incomplete.`);
    } else {
      console.log(`✅ Verified drupal_tutorials table with ${count} rows.`);
    }

    // Show 5 sample rows with key metadata fields
    const sample = await table.query().limit(5).toArray();
    console.log('\nSample rows (up to 5):');
    sample.forEach((row, index) => {
      const r = row as Record<string, unknown>;
      console.log(
        `[${index + 1}] symbol_name=${String(r.symbol_name ?? 'null')}, ` +
        `section=${String(r.section ?? 'null')}, ` +
        `file_path=${String(r.file_path ?? 'null')}`,
      );
    });

    // Count rows with non-empty fqcn (topic)
    const allRows = await table.query().toArray();
    const withFqcn = allRows.filter((row) => {
      const r = row as Record<string, unknown>;
      const fqcn = r.fqcn;
      return fqcn !== null && fqcn !== undefined && String(fqcn).trim() !== '';
    }).length;
    const pct = count > 0 ? Math.round((withFqcn / count) * 100) : 0;
    console.log(`\nRows with non-empty fqcn (topic): ${withFqcn}/${count} (${pct}%)`);

    if (withFqcn === 0) {
      console.warn('⚠️  Warning: no rows have a fqcn/topic set — check ETL parser.');
    }
  }
  catch (err) {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifyTutorials();
}

