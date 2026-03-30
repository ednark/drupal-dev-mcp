import { parsePHPDocFiles, parseUserGuideMarkdown } from './parser.js';
import { chunkPages, type Chunk } from './chunker.js';

const ID_HEX_RE = /^[0-9a-f]{64}$/;

function printChunkStats(label: string, chunks: Chunk[]): void {
  const ids = chunks.map((chunk) => chunk.metadata.id);
  const uniqueIds = new Set(ids);
  const allIdsUnique = uniqueIds.size === ids.length;
  const allIdsMatchFormat = ids.every((id) => ID_HEX_RE.test(id));

  let maxChunkLength = 0;
  let minChunkLength = Number.POSITIVE_INFINITY;

  for (const chunk of chunks) {
    const length = chunk.text.length;
    if (length > maxChunkLength) {
      maxChunkLength = length;
    }
    if (length < minChunkLength) {
      minChunkLength = length;
    }
  }

  if (chunks.length === 0) {
    minChunkLength = 0;
  }

  console.log(`\n=== ${label} ===`);
  console.log(`Total chunks produced: ${chunks.length}`);
  console.log(`All chunk IDs unique: ${allIdsUnique}`);
  console.log(`All IDs match /^[0-9a-f]{64}$/: ${allIdsMatchFormat}`);
  console.log(`Max chunk text length: ${maxChunkLength}`);
  console.log(`Min chunk text length: ${minChunkLength}`);

  console.log('Sample chunks (3):');
  chunks.slice(0, 3).forEach((chunk, index) => {
    console.log(`  [Sample ${index + 1}]`);
    console.log(`    id: ${chunk.metadata.id.slice(0, 16)}`);
    console.log(`    symbol_name: ${chunk.metadata.symbol_name}`);
    console.log(`    chunk_index: ${chunk.metadata.chunk_index}`);
    console.log(`    text_length: ${chunk.text.length}`);
  });
}

async function main(): Promise<void> {
  const pages = (await parsePHPDocFiles('data/sources/drupal-core', '11.x')).slice(0, 100);
  const phpDocChunks = await chunkPages(pages);
  printChunkStats('PHPDoc (first 100 pages)', phpDocChunks);

  const userGuidePages = await parseUserGuideMarkdown('data/sources/drupal-user-guide.md');
  const userGuideChunks = await chunkPages(userGuidePages);
  printChunkStats('User Guide', userGuideChunks);
}

main().catch((error: unknown) => {
  console.error('verify-chunker failed:', error);
  process.exitCode = 1;
});
