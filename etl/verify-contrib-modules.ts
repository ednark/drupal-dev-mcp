import * as lancedb from '@lancedb/lancedb';
import { validateConfig } from '../src/config.js';

async function verifyContribModules(): Promise<void> {
  console.log('Verifying contrib module docs LanceDB dataset...');
  const config = validateConfig();
  const db = await lancedb.connect(config.lancedbPath);

  try {
    const table = await db.openTable('contrib_module_docs');
    const count = await table.countRows();
    if (count === 0) {
      throw new Error('contrib_module_docs table is empty.');
    }

    console.log(`✅ Verified contrib_module_docs table with ${count} rows.`);
    const sample = await table.query().limit(3).toArray();
    console.log('Sample rows:');
    sample.forEach((row, index) => {
      const r = row as Record<string, unknown>;
      console.log(
        `[${index + 1}] symbol_name=${String(r.symbol_name ?? 'null')}, section=${String(r.section ?? 'null')}, file_path=${String(r.file_path ?? 'null')}`,
      );
    });
  }
  catch (err) {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifyContribModules();
}

