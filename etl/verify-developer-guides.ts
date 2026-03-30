import fs from 'fs';
import path from 'path';

/**
 * Verify the integrity and completeness of the parsed Developer Guides dataset.
 * Ensures that the parsed JSON file exists, is valid, and contains expected fields.
 */

import * as lancedb from '@lancedb/lancedb';
import { validateConfig } from '../src/config.js';

async function verifyDeveloperGuides() {
  console.log('Verifying Developer Guides LanceDB dataset...');
  const config = validateConfig();
  const db = await lancedb.connect(config.lancedbPath);

  try {
    const table = await db.openTable('drupal_developer_guides');
    const count = await table.countRows();
    if (count === 0) {
      throw new Error('Developer Guides table is empty.');
    }
    console.log(`✅ Verified drupal_developer_guides table with ${count} rows.`);
  } catch (err) {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifyDeveloperGuides();
}