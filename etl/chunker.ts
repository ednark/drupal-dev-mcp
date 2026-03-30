import { createHash } from 'node:crypto';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { ParsedPage, SourceMetadata } from './parser.js';

// ── Types ──────────────────────────────────────────────────────
export interface ChunkMetadata extends SourceMetadata {
  chunk_index: number; // 0-based within parent page
  id: string; // 64-char SHA-256 hex
}

export interface Chunk {
  text: string;
  metadata: ChunkMetadata;
}

// ── Splitter Configuration ─────────────────────────────────────
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 2000, // ~500 tokens at 4 chars/token
  chunkOverlap: 256, // ~64 tokens — preserves context across boundaries
  separators: ['\n## ', '\n### ', '\n#### ', '\n\n', '\n', ' ', ''],
});

// ── ID Generation ──────────────────────────────────────────────
function generateChunkId(
  source: string,
  filePath: string | null,
  symbolName: string | null,
  chunkIndex: number,
): string {
  const key = `${source}::${filePath ?? ''}::${symbolName ?? ''}:${chunkIndex}`;
  return createHash('sha256').update(key).digest('hex');
}

// ── Single Page Chunking ───────────────────────────────────────
export async function chunkPage(page: ParsedPage): Promise<Chunk[]> {
  const splitTexts = await splitter.splitText(page.text);

  return splitTexts
    .filter((text) => text.trim().length > 0) // Remove whitespace-only chunks
    .map((text, index) => ({
      text,
      metadata: {
        ...page.metadata,
        chunk_index: index,
        id: generateChunkId(
          page.metadata.source,
          page.metadata.file_path,
          page.metadata.symbol_name,
          index,
        ),
      },
    }));
}

// ── Batch Page Chunking ────────────────────────────────────────
export async function chunkPages(pages: ParsedPage[]): Promise<Chunk[]> {
  const allChunks: Chunk[] = [];

  for (let i = 0; i < pages.length; i += 1) {
    const chunks = await chunkPage(pages[i]);
    allChunks.push(...chunks);

    // Log progress every 500 pages
    if ((i + 1) % 500 === 0) {
      console.error(`  Chunked ${i + 1}/${pages.length} pages (${allChunks.length} chunks so far)`);
    }
  }

  console.error(`  Chunked ${pages.length} pages → ${allChunks.length} chunks`);

  // ── Content-hash deduplication ──────────────────────────────
  // Keyed by sha256(chunk.text.trim()) — ensures identical text from
  // different source labels is stored only once (first occurrence wins).
  const seen = new Map<string, Chunk>();
  for (const chunk of allChunks) {
    const contentHash = createHash('sha256').update(chunk.text.trim()).digest('hex');
    if (!seen.has(contentHash)) {
      seen.set(contentHash, chunk);
    }
  }
  const dedupedChunks = Array.from(seen.values());
  const removedCount = allChunks.length - dedupedChunks.length;
  if (removedCount > 0) {
    console.warn(`  Deduped ${removedCount} duplicate chunks by content hash`);
  }

  // ── Short-chunk filter ──────────────────────────────────────
  // Drop stub/boilerplate chunks that are too short to be useful for RAG.
  const MIN_CHUNK_LENGTH = 80;
  const filteredChunks = dedupedChunks.filter(chunk => chunk.text.trim().length >= MIN_CHUNK_LENGTH);
  const dropped = dedupedChunks.length - filteredChunks.length;
  if (dropped > 0) {
    console.error(`[chunker] Dropped ${dropped} chunks shorter than ${MIN_CHUNK_LENGTH} chars`);
  }

  return filteredChunks;
}
