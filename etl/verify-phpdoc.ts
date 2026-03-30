import { parsePHPDocFiles } from './parser.js';

function declarationKindFromText(text: string): 'function' | 'class_like' | 'unknown' {
  const codeMatch = text.match(/^```php\n([\s\S]*?)\n```/);
  const declaration = codeMatch?.[1] ?? '';

  if (/\bfunction\s+\w+/.test(declaration)) {
    return 'function';
  }

  if (/\b(class|interface|trait|enum)\s+\w+/.test(declaration)) {
    return 'class_like';
  }

  return 'unknown';
}

async function main(): Promise<void> {
  const pages = await parsePHPDocFiles('data/sources/drupal-core', '11.x');

  console.log(`Total pages: ${pages.length}`);

  console.log('\nSample pages (3):');
  pages.slice(0, 3).forEach((page, index) => {
    const excerpt = page.text.slice(0, 200).replace(/\s+/g, ' ').trim();
    console.log(`\n[Sample ${index + 1}]`);
    console.log(`symbol_name: ${page.metadata.symbol_name}`);
    console.log(`fqcn: ${page.metadata.fqcn}`);
    console.log(`file_path: ${page.metadata.file_path}`);
    console.log(`text_excerpt: ${excerpt}`);
  });

  const fqcnSetCount = pages.filter((page) => page.metadata.fqcn !== null).length;
  const fqcnNullCount = pages.length - fqcnSetCount;

  const declarationStats = pages.reduce(
    (acc, page) => {
      const kind = declarationKindFromText(page.text);
      if (kind === 'function') {
        acc.functionCount += 1;
      } else if (kind === 'class_like') {
        acc.classLikeCount += 1;
      } else {
        acc.unknownCount += 1;
      }
      return acc;
    },
    { functionCount: 0, classLikeCount: 0, unknownCount: 0 },
  );

  console.log('\nStats:');
  console.log(`FQCN set: ${fqcnSetCount}`);
  console.log(`FQCN null: ${fqcnNullCount}`);
  console.log(`Function declarations: ${declarationStats.functionCount}`);
  console.log(`Class/interface/trait/enum declarations: ${declarationStats.classLikeCount}`);
  console.log(`Unknown declaration type: ${declarationStats.unknownCount}`);
}

main().catch((error: unknown) => {
  console.error('verify-phpdoc failed:', error);
  process.exitCode = 1;
});
