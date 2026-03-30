import * as lancedb from '@lancedb/lancedb';
import { validateConfig } from '../src/config.js';
import type { EmbeddedChunk } from './embedder.js';

const INSERT_BATCH_SIZE = 1000;

interface LanceRow {
  [key: string]: unknown;
  id: string;
  text: string;
  vector: number[];
  source: string;
  symbol_name: string;
  fqcn: string;
  file_path: string;
  drupal_version: string;
  section: string;
  chunk_index: number;
  ingested_at: string;
}

function toRow(chunk: EmbeddedChunk): LanceRow {
  return {
    id: chunk.metadata.id,
    text: chunk.text,
    vector: chunk.embedding,
    source: chunk.metadata.source,
    symbol_name: chunk.metadata.symbol_name ?? '',
    fqcn: chunk.metadata.fqcn ?? '',
    file_path: chunk.metadata.file_path ?? '',
    drupal_version: chunk.metadata.drupal_version,
    section: chunk.metadata.section ?? '',
    chunk_index: chunk.metadata.chunk_index,
    ingested_at: chunk.metadata.ingested_at,
  };
}

/**
 * Load embedded chunks into LanceDB. Full reload strategy: drops existing table and recreates.
 */
export async function loadChunks(chunks: EmbeddedChunk[], dbPath?: string): Promise<number> {
  const tableName = process.env.LANCEDB_TABLE_NAME || 'drupal_core_docs';
  const path = dbPath ?? validateConfig().lancedbPath;
  const db = await lancedb.connect(path);

  console.error(`  Loading ${chunks.length} chunks into LanceDB at ${path}...`);

  // Full reload: drop existing table if it exists
  try {
    await db.dropTable(tableName);
    console.error(`  Dropped existing table '${tableName}'`);
  }
  catch {
    // Table doesn't exist — that's fine
  }

  const rows = chunks.map(toRow);

  // Create table with first batch
  const firstBatch = rows.slice(0, INSERT_BATCH_SIZE);
  const table = await db.createTable(tableName, firstBatch);
  console.error(`  Created table '${tableName}' with first ${firstBatch.length} rows`);

  // Insert remaining batches
  for (let i = INSERT_BATCH_SIZE; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    await table.add(batch);
    console.error(`  Inserted batch: ${Math.min(i + INSERT_BATCH_SIZE, rows.length)}/${rows.length} rows`);
  }

  const count = await table.countRows();
  console.error(`  ✓ LanceDB table '${tableName}' loaded with ${count} rows`);
  return count;
}
