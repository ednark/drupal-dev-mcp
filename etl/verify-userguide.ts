import { parseUserGuideMarkdown } from './parser.js';

async function main(): Promise<void> {
  const pages = await parseUserGuideMarkdown('data/sources/drupal-user-guide.md');

  console.log(`Total sections: ${pages.length}`);
  console.log('\nSample sections (3):');

  pages.slice(0, 3).forEach((page, index) => {
    const excerpt = page.text.slice(0, 200).replace(/\s+/g, ' ').trim();
    console.log(`\n[Sample ${index + 1}]`);
    console.log(`section: ${page.metadata.section}`);
    console.log(`text_excerpt: ${excerpt}`);
  });

  if (pages.length > 100) {
    console.log('\n✅ User Guide parse looks healthy (>100 sections)');
    return;
  }

  if (pages.length > 0) {
    console.log('\n⚠ User Guide parse produced partial data (>0 sections)');
    return;
  }

  console.log('\n❌ User Guide parse produced no data');
}

main().catch((error: unknown) => {
  console.error('verify-userguide failed:', error);
  process.exitCode = 1;
});
