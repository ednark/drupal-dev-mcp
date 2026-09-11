import { mkdir, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { contentHash, chunkId, documentId, relationId } from '../ids.js';
import { extractGraph, isGraphEligibleDocument } from '../graph/index.js';
import { SOURCE_BY_KEY } from '../registry.js';
import { createSchema, openDatabase, SCHEMA_VERSION } from '../storage/schema.js';
import type { ExtractedEntity, NormalizedDocument, RelationRecord } from '../types.js';
import { normalizeDrupalVersion } from '../version.js';
import { discoverDocuments } from './discover.js';
import type { ActiveManifest } from './manifest.js';
import { getDefaultIndexRoot } from './manifest.js';
import { buildVectorIndex } from './vector.js';

export interface BuildOptions {
  repoRoot: string;
  indexRoot?: string;
  fixtureLimit?: number;
  withEmbeddings?: boolean;
  activate?: boolean;
  embed?: (texts: string[]) => Promise<number[][]>;
}

export interface BuildResult extends ActiveManifest {
  parseErrors: Array<{ file: string; message: string }>;
}

function splitDocument(document: NormalizedDocument): Array<{ id: string; ordinal: number; locator: string; text: string; hash: string; tokenCount: number }> {
  const max = 2_000;
  const overlap = 200;
  const chunks = [];
  let offset = 0;
  let ordinal = 0;
  while (offset < document.content.length) {
    let end = Math.min(offset + max, document.content.length);
    if (end < document.content.length) {
      const boundary = Math.max(document.content.lastIndexOf('\n\n', end), document.content.lastIndexOf('\n', end));
      if (boundary > offset + max / 2) end = boundary;
    }
    const text = document.content.slice(offset, end).trim();
    if (text) {
      const hash = contentHash(text);
      const locator = document.section ? `${document.section}:${ordinal}` : `chunk:${ordinal}`;
      chunks.push({ id: chunkId(document.id, locator, ordinal, hash), ordinal, locator, text, hash, tokenCount: Math.ceil(text.length / 4) });
      ordinal += 1;
    }
    if (end >= document.content.length) break;
    offset = Math.max(end - overlap, offset + 1);
  }
  return chunks;
}

function sourceSnapshotId(sourceKey: string, version: string, project: string): string {
  return documentId(`snapshot:${sourceKey}`, version, project);
}

function insertDocument(db: ReturnType<typeof openDatabase>, document: NormalizedDocument, snapshotId: string): void {
  db.prepare('INSERT INTO nodes(id, node_type, stable_key) VALUES (?, ?, ?)').run(document.id, 'document', `document:${document.id}`);
  db.prepare(`INSERT INTO documents(
    id, source_snapshot_id, source_key, source_type, authority, project, drupal_version, compatibility,
    title, canonical_url, repository_path, commit_sha, mime_type, status, section, content, content_hash, modified_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    document.id, snapshotId, document.sourceKey, document.sourceType, document.authority, document.project ?? null,
    document.drupalVersion, document.compatibility ?? null, document.title, document.canonicalUrl ?? null,
    document.repositoryPath ?? null, document.commit ?? null, document.mimeType, document.status, document.section ?? null,
    document.content, document.contentHash, document.modifiedAt ?? null,
  );
  db.prepare('INSERT INTO document_fts(document_id, title, section, content) VALUES (?, ?, ?, ?)').run(document.id, document.title, document.section ?? '', document.content);
}

function insertEntity(db: ReturnType<typeof openDatabase>, entity: ExtractedEntity, snapshotId: string): void {
  db.prepare('INSERT OR IGNORE INTO nodes(id, node_type, stable_key) VALUES (?, ?, ?)').run(entity.id, entity.kind, `entity:${entity.id}`);
  db.prepare(`INSERT OR IGNORE INTO entities(
    id, source_snapshot_id, source_document_id, parent_id, kind, canonical_name, short_name, fqcn, project,
    drupal_version, status, deprecation_message, replacement_hint, file_path, start_line, end_line
  ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    entity.id, snapshotId, entity.sourceDocumentId ?? null, entity.kind, entity.canonicalName, entity.shortName,
    entity.fqcn ?? null, entity.project ?? null, entity.drupalVersion, entity.status, entity.deprecationMessage ?? null,
    entity.replacementHint ?? null, entity.filePath ?? null, entity.startLine ?? null, entity.endLine ?? null,
  );
  for (const alias of new Set([entity.shortName, ...(entity.aliases ?? [])])) {
    db.prepare('INSERT OR IGNORE INTO entity_aliases(entity_id, alias, alias_kind) VALUES (?, ?, ?)').run(entity.id, alias, 'name');
  }
}

export async function buildIndex(options: BuildOptions): Promise<BuildResult> {
  const indexRoot = options.indexRoot ?? getDefaultIndexRoot(options.repoRoot);
  const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomBytes(3).toString('hex')}`;
  const buildPath = path.join(indexRoot, 'builds', runId);
  await mkdir(buildPath, { recursive: true });
  const dbPath = path.join(buildPath, 'knowledge.sqlite');
  const db = openDatabase(dbPath);
  createSchema(db);
  const startedAt = new Date().toISOString();
  const documents = await discoverDocuments(options.repoRoot, options.fixtureLimit);
  const corpusDigest = contentHash(documents.map(document => `${document.id}:${document.contentHash}`).sort().join('\n'));
  const embeddingModel = options.withEmbeddings ? process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small' : undefined;
  db.prepare('INSERT INTO index_runs(id, schema_version, corpus_digest, embedding_model, started_at, status) VALUES (?, ?, ?, ?, ?, ?)').run(runId, SCHEMA_VERSION, corpusDigest, embeddingModel ?? null, startedAt, 'building');

  const snapshots = new Map<string, string>();
  const entities: ExtractedEntity[] = [];
  const pendingRelations: RelationRecord[] = [];
  const parseErrors: BuildResult['parseErrors'] = [];
  const vectorChunks: Array<{ id: string; text: string; contentHash: string; sourceType: string; project?: string; drupalVersion: string; authority: number }> = [];

  const transaction = db.transaction(() => {
    for (const document of documents) {
      const source = SOURCE_BY_KEY.get(document.sourceKey);
      if (!source) continue;
      const snapshotKey = `${document.sourceKey}:${document.drupalVersion}:${document.project ?? ''}`;
      let snapshotId = snapshots.get(snapshotKey);
      if (!snapshotId) {
        snapshotId = sourceSnapshotId(document.sourceKey, document.drupalVersion, document.project ?? '');
        const version = normalizeDrupalVersion(document.compatibility ?? document.drupalVersion);
        db.prepare(`INSERT OR IGNORE INTO source_snapshots(
          id, source_key, source_type, authority, project, version_scope, version_line, raw_version,
          drupal_core_constraint, stability, canonical_base_url, repository_url, repository_ref, commit_sha, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          snapshotId, source.key, source.type, source.authority, document.project ?? null, version.versionScope,
          version.versionLine, version.rawVersion, version.drupalCoreConstraint ?? null, version.stability,
          source.canonicalBaseUrl, source.canonicalBaseUrl, document.drupalVersion, document.commit ?? null, startedAt,
        );
        snapshots.set(snapshotKey, snapshotId);
      }
      insertDocument(db, document, snapshotId);
      for (const chunk of splitDocument(document)) {
        db.prepare('INSERT INTO chunks(id, document_id, ordinal, locator, text, content_hash, token_count) VALUES (?, ?, ?, ?, ?, ?, ?)').run(chunk.id, document.id, chunk.ordinal, chunk.locator, chunk.text, chunk.hash, chunk.tokenCount);
        vectorChunks.push({ id: chunk.id, text: chunk.text, contentHash: chunk.hash, sourceType: document.sourceType, project: document.project, drupalVersion: document.drupalVersion, authority: document.authority });
      }
      const graph = extractGraph(document);
      parseErrors.push(...graph.errors);
      for (const entity of graph.entities) {
        insertEntity(db, entity, snapshotId);
        entities.push(entity);
      }
      pendingRelations.push(...graph.relations);
    }
  });
  transaction();

  const uniqueEntities = new Map(entities.map(entity => [entity.id, entity]));
  const entityByLookup = new Map<string, string>();
  for (const entity of uniqueEntities.values()) {
    for (const lookup of [entity.id, entity.canonicalName, entity.shortName, ...(entity.aliases ?? [])]) {
      entityByLookup.set(`${entity.drupalVersion}:${lookup.toLowerCase()}`, entity.id);
      entityByLookup.set(`all:${lookup.toLowerCase()}`, entity.id);
    }
  }
  const crossVersionGroups = new Map<string, ExtractedEntity[]>();
  for (const entity of uniqueEntities.values()) {
    if (!['10.6', '11.4'].includes(entity.drupalVersion)) continue;
    const key = `${entity.project ?? ''}:${entity.kind}:${entity.canonicalName.toLowerCase()}`;
    crossVersionGroups.set(key, [...(crossVersionGroups.get(key) ?? []), entity]);
  }
  for (const pair of crossVersionGroups.values()) {
    const ten = pair.find(entity => entity.drupalVersion === '10.6');
    const eleven = pair.find(entity => entity.drupalVersion === '11.4');
    if (!ten || !eleven) continue;
    for (const [from, to] of [[ten, eleven], [eleven, ten]] as const) pendingRelations.push({
      id: relationId(from.id, 'equivalent_to', to.id, from.sourceDocumentId), fromId: from.id,
      predicate: 'equivalent_to', toId: to.id, confidence: 1, extractor: 'cross-version-identity',
      evidenceDocumentId: from.sourceDocumentId,
    });
  }
  const relationTransaction = db.transaction(() => {
    for (const relation of pendingRelations) {
      const sourceEntity = uniqueEntities.get(relation.fromId);
      const target = relation.unresolvedTarget;
      const resolved = relation.toId ?? (target ? entityByLookup.get(`${sourceEntity?.drupalVersion ?? 'all'}:${target.toLowerCase()}`) ?? entityByLookup.get(`all:${target.toLowerCase()}`) : undefined);
      db.prepare(`INSERT OR IGNORE INTO relations(
        id, from_id, predicate, to_id, unresolved_target, confidence, extractor, evidence_document_id,
        start_line, end_line, attributes_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        relation.id, relation.fromId, relation.predicate, resolved ?? null, resolved ? null : target ?? null,
        relation.confidence, relation.extractor, relation.evidenceDocumentId ?? null, relation.startLine ?? null,
        relation.endLine ?? null, JSON.stringify(relation.attributes ?? {}),
      );
    }
    for (const entity of uniqueEntities.values()) {
      const aliases = db.prepare('SELECT group_concat(alias, ?) AS aliases FROM entity_aliases WHERE entity_id = ?').get(' ', entity.id) as { aliases?: string };
      db.prepare('INSERT INTO entity_fts(entity_id, canonical_name, short_name, aliases) VALUES (?, ?, ?, ?)').run(entity.id, entity.canonicalName, entity.shortName, aliases.aliases ?? '');
    }
  });
  relationTransaction();

  let vectorCount = 0;
  let embeddedCount = 0;
  let reusedEmbeddingCount = 0;
  if (options.withEmbeddings) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey && !options.embed) throw new Error('OPENAI_API_KEY is required with --with-embeddings');
    const vectorResult = await buildVectorIndex({ buildPath, chunks: vectorChunks, model: embeddingModel!, apiKey, embed: options.embed, cachePath: path.join(indexRoot, 'embedding-cache.sqlite') });
    vectorCount = vectorResult.vectorCount;
    embeddedCount = vectorResult.embeddedCount;
    reusedEmbeddingCount = vectorResult.reusedCount;
  }

  const counts: Record<string, number> = {
    documents: Number((db.prepare('SELECT count(*) AS count FROM documents').get() as { count: number }).count),
    chunks: Number((db.prepare('SELECT count(*) AS count FROM chunks').get() as { count: number }).count),
    entities: Number((db.prepare('SELECT count(*) AS count FROM entities').get() as { count: number }).count),
    relations: Number((db.prepare('SELECT count(*) AS count FROM relations').get() as { count: number }).count),
    vectors: vectorCount,
    embeddingsCreated: embeddedCount,
    embeddingsReused: reusedEmbeddingCount,
    parseErrors: parseErrors.length,
  };
  const eligibleCode = documents.filter(isGraphEligibleDocument).length;
  const parseSuccessRate = eligibleCode ? (eligibleCode - parseErrors.length) / eligibleCode : 1;
  const foreignKeyErrors = db.pragma('foreign_key_check') as unknown[];
  const errors: string[] = [];
  const warnings: string[] = [];
  if (documents.length === 0) errors.push('No documents discovered');
  if (foreignKeyErrors.length) errors.push(`${foreignKeyErrors.length} foreign-key violations`);
  if (parseSuccessRate < 0.99) errors.push(`Parse success ${(parseSuccessRate * 100).toFixed(2)}% is below 99%`);
  if (!vectorCount) warnings.push('Vector index not built; hybrid queries will use lexical-only mode');
  if (!documents.some(document => document.drupalVersion === '10.6')) warnings.push('Drupal 10.6 source snapshot is absent');
  const verification = { passed: errors.length === 0, errors, warnings };
  const completedAt = new Date().toISOString();
  db.prepare('UPDATE index_runs SET completed_at = ?, status = ?, metadata_json = ? WHERE id = ?').run(completedAt, verification.passed ? 'verified' : 'failed', JSON.stringify({ counts, parseSuccessRate, fixtureLimit: options.fixtureLimit ?? null }), runId);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();

  const manifest: BuildResult = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    buildPath,
    builtAt: completedAt,
    defaultDrupalVersion: '11.4',
    availableDrupalVersions: ['10.6', '11.4'],
    embeddingModel,
    counts,
    fixtureLimit: options.fixtureLimit,
    verification,
    parseErrors,
  };
  await writeFile(path.join(buildPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(buildPath, 'verification.json'), JSON.stringify({ ...verification, parseErrors, parseSuccessRate, counts }, null, 2));
  if (options.activate !== false && verification.passed) {
    await mkdir(indexRoot, { recursive: true });
    const temporary = path.join(indexRoot, `active.${runId}.tmp`);
    await writeFile(temporary, JSON.stringify(manifest, null, 2));
    await rename(temporary, path.join(indexRoot, 'active.json'));
  }
  return manifest;
}
