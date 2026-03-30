/**
 * Verification script for the contrib module code parser.
 *
 * Usage:
 *   npx ts-node --esm etl/verify-contrib-module-code.ts
 *
 * Expected output when data/sources/contrib-module-code/ exists:
 *   Total pages parsed: <N>
 *   [1] title=views: ViewsBlock  symbolType=class  text[0:200]=...
 *   [2] ...
 *   [3] ...
 *   ✅ verify-contrib-module-code OK
 */

import { canAccess, parseContribModuleCode } from './parse-contrib-module-code.js';

async function verify(): Promise<void> {
  console.log('Running verify-contrib-module-code…');

  if (!canAccess()) {
    console.warn(
      '⚠  data/sources/contrib-module-code/ does not exist — run scripts/fetch-contrib-module-code.sh first.',
    );
    console.log('✅ verify-contrib-module-code skipped (no source data)');
    process.exit(0);
  }

  const pages = await parseContribModuleCode();

  console.log(`\nTotal pages parsed: ${pages.length}`);

  if (pages.length === 0) {
    console.error('❌ No pages returned — check source data and parser logic.');
    process.exit(1);
  }

  const sample = pages.slice(0, 3);
  console.log('\nFirst 3 pages:');
  sample.forEach((page, i) => {
    const { metadata } = page;
    const title = `${metadata.section ?? '—'} / ${metadata.symbol_name ?? '—'}`;
    const symbolType = metadata.section?.split(': ')[1] ?? '—';
    const preview = page.text.slice(0, 200).replace(/\n/g, '↵');
    console.log(`\n[${i + 1}] title=${title}`);
    console.log(`     symbolType=${symbolType}`);
    console.log(`     file_path=${metadata.file_path ?? '—'}`);
    console.log(`     fqcn=${metadata.fqcn ?? 'null'}`);
    console.log(`     drupal_version=${metadata.drupal_version}`);
    console.log(`     text[0:200]=${preview}`);
  });

  console.log('\n✅ verify-contrib-module-code OK');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verify().catch((err) => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  });
}
