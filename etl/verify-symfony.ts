import * as lancedb from '@lancedb/lancedb';
import { validateConfig } from '../src/config.js';

async function verifySymfonyDocs(): Promise<void> {
  console.log('Verifying Symfony docs LanceDB dataset...');
  const config = validateConfig();
  const db = await lancedb.connect(config.lancedbPath);

  try {
    const table = await db.openTable('symfony_docs');
    const count = await table.countRows();
    if (count === 0) {
      throw new Error('symfony_docs table is empty.');
    }

    console.log(`✅ Verified symfony_docs table with ${count} rows.`);
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
  verifySymfonyDocs();
}

