/**
 * Verify the api.drupal.org ETL output in LanceDB.
 *
 * Connects to the LanceDB table `api_drupal_org_docs`, counts rows,
 * previews sample records, and exits non-zero if the table is missing
 * or empty.
 *
 * Run after the full ETL pipeline (`npm run etl`) to confirm data was
 * loaded correctly:
 *
 *   npx tsx etl/verify-api-drupal-org.ts
 */

import * as lancedb from '@lancedb/lancedb';
import { validateConfig } from '../src/config.js';

const TABLE_NAME = 'api_drupal_org_docs';

async function verifyApiDrupalOrgDocs(): Promise<void> {
  console.log(`Verifying api.drupal.org LanceDB table: ${TABLE_NAME}\n`);

  const config = validateConfig();
  const db = await lancedb.connect(config.lancedbPath);

  try {
    const table = await db.openTable(TABLE_NAME);
    const count = await table.countRows();

    if (count === 0) {
      console.error(`❌ Table '${TABLE_NAME}' is empty.`);
      console.error(
        '   Run `bash scripts/fetch-api-drupal-org.sh` then `npm run etl` to populate it.',
      );
      process.exit(1);
    }

    console.log(`✅ Verified '${TABLE_NAME}' table with ${count} rows.\n`);

    const sample = await table.query().limit(5).toArray();
    console.log('Sample rows:');
    sample.forEach((row, index) => {
      const r = row as Record<string, unknown>;
      console.log(
        `  [${index + 1}] symbol_name=${String(r['symbol_name'] ?? 'null')}, section=${String(r['section'] ?? 'null')}`,
      );
    });

    console.log(`\n✅ Verification passed: ${count} rows in '${TABLE_NAME}'.`);
  }
  catch (err) {
    const message = (err as Error).message ?? String(err);
    if (message.includes('was not found') || message.includes('does not exist')) {
      console.error(`❌ Table '${TABLE_NAME}' does not exist.`);
      console.error(
        '   Run `bash scripts/fetch-api-drupal-org.sh` then `npm run etl` to create it.',
      );
    }
    else {
      console.error('❌ Verification failed:', err);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifyApiDrupalOrgDocs();
}
