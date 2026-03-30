import { access } from 'node:fs/promises';
import { parseDocset, type ParsedPage } from './parser.js';

const DOCSET_DIR = 'data/sources/Drupal.docset';
const DRUPAL_VERSION = 'all';
const VERIFY_LIMIT = 50;

function formatNumber(value: number): string {
  return value.toLocaleString();
}

async function main(): Promise<void> {
  console.log('Verifying Drupal Docset parser...');
  console.log(`Docset directory: ${DOCSET_DIR}`);
  console.log(`Parse limit: ${VERIFY_LIMIT} pages`);

  try {
    await access(DOCSET_DIR);
  }
  catch {
    console.log('\nℹ Drupal Docset directory was not found.');
    console.log('Fetch it first with: npm run fetch:docset');
    console.log('Docset is optional; verification completed with no data.');
    process.exit(0);
  }

  let pages: ParsedPage[];
  try {
    pages = await parseDocset(DOCSET_DIR, DRUPAL_VERSION, VERIFY_LIMIT);
  }
  catch (error: unknown) {
    console.error('\n❌ Docset parsing failed:', error);
    process.exit(1);
  }

  console.log(`\nTotal pages parsed: ${formatNumber(pages.length)} (limit=${VERIFY_LIMIT})`);

  const lengths = pages.map((page) => page.text.length);
  const totalLength = lengths.reduce((sum, len) => sum + len, 0);
  const minLength = lengths.length > 0 ? Math.min(...lengths) : 0;
  const maxLength = lengths.length > 0 ? Math.max(...lengths) : 0;
  const avgLength = lengths.length > 0 ? Math.round(totalLength / lengths.length) : 0;

  console.log('\nContent length stats (characters):');
  console.log(`- min: ${formatNumber(minLength)}`);
  console.log(`- avg: ${formatNumber(avgLength)}`);
  console.log(`- max: ${formatNumber(maxLength)}`);

  console.log('\nSample pages:');
  if (pages.length === 0) {
    console.log('- No pages parsed (docset is optional).');
  }
  else {
    pages.slice(0, 5).forEach((page, index) => {
      const title = page.metadata.symbol_name ?? 'Untitled';
      const url = page.metadata.file_path ?? 'n/a';
      console.log(`${index + 1}. ${title}`);
      console.log(`   url: ${url}`);
      console.log(`   content_length: ${formatNumber(page.text.length)}`);
    });
  }

  console.log('\nExpectation: a complete Drupal docset typically yields >= 1,000 pages when parsed without a low limit.');
  console.log('✅ Docset verification finished successfully.');
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('❌ verify-docset failed:', error);
  process.exit(1);
});
