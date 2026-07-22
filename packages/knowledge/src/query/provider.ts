import * as lancedb from '@lancedb/lancedb';
import OpenAI from 'openai';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../storage/schema.js';
import type {
  EntityRecord, EntityRequest, EntityResponse, IndexStatus, KnowledgeProvider, RelationRecord,
  RelationshipRequest, RelationshipResponse, ResourceRecord, SearchRequest, SearchResponse, SearchResult,
} from '../types.js';
import { DEFAULT_DRUPAL_VERSION, isCompatible } from '../version.js';
import { getDefaultIndexRoot, resolveActiveBuild, statusFromManifest, type ActiveManifest } from '../index/manifest.js';

type Row = Record<string, any>;

function ftsQuery(query: string): string {
  const tokens = query.match(/[\p{L}\p{N}_\\:.]+/gu) ?? [];
  return tokens.map(token => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}

function entityFromRow(row: Row, builtAt?: string): EntityRecord {
  return {
    id: row.id,
    kind: row.kind,
    canonicalName: row.canonical_name,
    shortName: row.short_name,
    fqcn: row.fqcn || undefined,
    project: row.project || undefined,
    drupalVersion: row.drupal_version,
    status: row.status,
    deprecationMessage: row.deprecation_message || undefined,
    replacementHint: row.replacement_hint || undefined,
    sourceDocumentId: row.source_document_id || undefined,
    filePath: row.file_path || undefined,
    startLine: row.start_line ?? undefined,
    endLine: row.end_line ?? undefined,
    canonicalUrl: row.canonical_url || undefined,
    commit: row.commit_sha || undefined,
    freshness: row.modified_at || builtAt,
    evidenceResourceUri: row.source_document_id ? `drupal://document/${row.source_document_id}` : undefined,
    resourceUri: `drupal://entity/${row.id}`,
  };
}

function relationFromRow(row: Row): RelationRecord {
  return {
    id: row.id,
    fromId: row.from_id,
    predicate: row.predicate,
    toId: row.to_id || undefined,
    unresolvedTarget: row.unresolved_target || undefined,
    confidence: row.confidence,
    extractor: row.extractor,
    evidenceDocumentId: row.evidence_document_id || undefined,
    startLine: row.start_line ?? undefined,
    endLine: row.end_line ?? undefined,
    attributes: JSON.parse(row.attributes_json || '{}'),
  };
}

export class SqliteKnowledgeProvider implements KnowledgeProvider {
  private constructor(
    private readonly manifest: ActiveManifest,
    private readonly db: Database.Database,
  ) {}

  static async open(indexRoot = getDefaultIndexRoot()): Promise<SqliteKnowledgeProvider> {
    const manifest = await resolveActiveBuild(indexRoot);
    if (!manifest?.verification.passed) throw new Error('No verified active Drupal knowledge index. Run npm run index:rebuild.');
    const db = openDatabase(path.join(manifest.buildPath, 'knowledge.sqlite'), true);
    db.function('drupal_compatible', (constraint: unknown, target: unknown) => isCompatible(typeof constraint === 'string' ? constraint : undefined, String(target)) ? 1 : 0);
    return new SqliteKnowledgeProvider(manifest, db);
  }

  close(): void { this.db.close(); }

  async getIndexStatus(): Promise<IndexStatus> { return statusFromManifest(this.manifest); }

  async search(request: SearchRequest): Promise<SearchResponse> {
    const query = request.query?.trim();
    if (!query) throw new Error('query is required');
    const version = request.drupalVersion ?? DEFAULT_DRUPAL_VERSION;
    const limit = Math.min(25, Math.max(1, request.limit ?? 8));
    const mode = request.mode ?? 'hybrid';
    const includeSnippets = request.includeSnippets ?? true;
    const match = ftsQuery(query);
    if (!match) return { query, appliedFilters: { drupalVersion: version, mode }, index: await this.getIndexStatus(), results: [] };

    const filters: string[] = [version === 'all' ? '1=1' : "(drupal_version = ? OR (drupal_version = 'all' AND drupal_compatible(compatibility, ?) = 1))"];
    const params: unknown[] = version === 'all' ? [] : [version, version];
    if (request.projects?.length) {
      filters.push(`project IN (${request.projects.map(() => '?').join(',')})`);
      params.push(...request.projects);
    }
    if (request.sourceTypes?.length) {
      filters.push(`source_type IN (${request.sourceTypes.map(() => '?').join(',')})`);
      params.push(...request.sourceTypes);
    }
    const where = filters.join(' AND ');
    const lexicalResults: SearchResult[] = [];
    if (mode !== 'semantic') {
      const docs = this.db.prepare(`SELECT d.*, bm25(document_fts) AS rank,
        snippet(document_fts, 3, '[', ']', ' … ', 30) AS snippet
        FROM document_fts JOIN documents d ON d.id = document_fts.document_id
        WHERE document_fts MATCH ? AND ${where}
        ORDER BY rank LIMIT ?`).all(match, ...params, limit * 3) as Row[];
      docs.forEach((row, index) => lexicalResults.push({
        id: row.id, resultType: 'document', title: row.title, snippet: includeSnippets ? row.snippet : undefined,
        score: 1 / (60 + index + 1), lexicalRank: index + 1, exactMatch: row.title.toLowerCase() === query.toLowerCase(),
        sourceType: row.source_type, authority: row.authority, project: row.project || undefined,
        drupalVersion: row.drupal_version, compatibility: version === 'all' ? 'cross_version' : 'compatible', status: row.status, canonicalUrl: row.canonical_url || undefined,
        repositoryPath: row.repository_path || undefined, commit: row.commit_sha || undefined,
        freshness: row.modified_at || this.manifest.builtAt,
        provenance: { sourceKey: row.source_key, sourceType: row.source_type, authority: row.authority, canonicalUrl: row.canonical_url || undefined, repositoryPath: row.repository_path || undefined, commit: row.commit_sha || undefined },
        resourceUri: `drupal://document/${row.id}`,
      }));
      const entityFilters = [version === 'all' ? '1=1' : `(e.drupal_version = ? OR (e.drupal_version = 'all' AND drupal_compatible(
        (SELECT s.drupal_core_constraint FROM source_snapshots s WHERE s.id=e.source_snapshot_id), ?) = 1))`];
      const entityParams: unknown[] = version === 'all' ? [] : [version, version];
      if (request.projects?.length) { entityFilters.push(`e.project IN (${request.projects.map(() => '?').join(',')})`); entityParams.push(...request.projects); }
      if (request.entityKinds?.length) { entityFilters.push(`e.kind IN (${request.entityKinds.map(() => '?').join(',')})`); entityParams.push(...request.entityKinds); }
      const entityRows = this.db.prepare(`SELECT e.*, d.source_key, d.source_type, d.authority, d.canonical_url, d.repository_path, d.commit_sha, d.modified_at,
        bm25(entity_fts) AS rank FROM entity_fts JOIN entities e ON e.id = entity_fts.entity_id
        LEFT JOIN documents d ON d.id = e.source_document_id
        WHERE entity_fts MATCH ? AND ${entityFilters.join(' AND ')}
        ORDER BY CASE WHEN lower(e.canonical_name)=lower(?) OR lower(e.short_name)=lower(?) THEN 0 ELSE 1 END, rank LIMIT ?`).all(match, ...entityParams, query, query, limit * 3) as Row[];
      entityRows.forEach((row, index) => lexicalResults.push({
        id: row.id, resultType: 'entity', title: row.canonical_name,
        snippet: includeSnippets ? `${row.kind} ${row.canonical_name}${row.status === 'deprecated' ? ' (deprecated)' : ''}` : undefined,
        score: 1 / (60 + index + 1), lexicalRank: index + 1,
        exactMatch: [row.canonical_name, row.short_name].some((name: string) => name.toLowerCase() === query.toLowerCase()),
        sourceType: row.source_type ?? 'core_code', authority: row.authority ?? 100, project: row.project || undefined,
        drupalVersion: row.drupal_version, compatibility: version === 'all' ? 'cross_version' : 'compatible', status: row.status, canonicalUrl: row.canonical_url || undefined,
        repositoryPath: row.file_path || undefined, commit: row.commit_sha || undefined,
        freshness: row.modified_at || this.manifest.builtAt,
        provenance: { sourceKey: row.source_key ?? 'unknown', sourceType: row.source_type ?? 'core_code', authority: row.authority ?? 100, canonicalUrl: row.canonical_url || undefined, repositoryPath: row.file_path || undefined, commit: row.commit_sha || undefined },
        resourceUri: `drupal://entity/${row.id}`,
      }));
    }

    let semanticRows: Array<{ chunk_id: string; _distance: number }> = [];
    let degradedMode: 'lexical_only' | undefined;
    if (mode !== 'lexical' && this.manifest.embeddingModel && process.env.OPENAI_API_KEY) {
      try {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const embedded = await client.embeddings.create({ model: this.manifest.embeddingModel, input: query });
        const vectorDb = await lancedb.connect(path.join(this.manifest.buildPath, 'vectors.lance'));
        const table = await vectorDb.openTable('chunk_vectors');
        let vectorQuery = table.vectorSearch(embedded.data[0].embedding).limit(limit * 3);
        if (version !== 'all') vectorQuery = vectorQuery.where(`drupal_version = '${String(version).replace(/'/g, "''")}' OR drupal_version = 'all'`);
        semanticRows = await vectorQuery.toArray() as unknown as Array<{ chunk_id: string; _distance: number }>;
      } catch { degradedMode = 'lexical_only'; }
    } else if (mode !== 'lexical') degradedMode = 'lexical_only';

    const merged = new Map<string, SearchResult>();
    for (const result of lexicalResults) {
      const boost = result.exactMatch ? 0.05 : 0;
      merged.set(result.id, { ...result, score: result.score + boost + result.authority / 1_000_000 });
    }
    semanticRows.forEach((row, index) => {
      const document = this.db.prepare(`SELECT d.*, c.text FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.id=?`).get(row.chunk_id) as Row | undefined;
      if (!document) return;
      if (version !== 'all' && !isCompatible(document.compatibility, version)) return;
      const existing = merged.get(document.id);
      const semanticScore = 1 / (60 + index + 1);
      if (existing) merged.set(document.id, { ...existing, semanticRank: index + 1, score: existing.score + semanticScore });
      else merged.set(document.id, {
        id: document.id, resultType: 'document', title: document.title,
        snippet: includeSnippets ? document.text.slice(0, 500) : undefined, score: semanticScore,
        semanticRank: index + 1, exactMatch: false, sourceType: document.source_type, authority: document.authority,
        project: document.project || undefined, drupalVersion: document.drupal_version, compatibility: version === 'all' ? 'cross_version' : 'compatible', status: document.status,
        canonicalUrl: document.canonical_url || undefined, repositoryPath: document.repository_path || undefined,
        commit: document.commit_sha || undefined, freshness: document.modified_at || this.manifest.builtAt,
        provenance: { sourceKey: document.source_key, sourceType: document.source_type, authority: document.authority, canonicalUrl: document.canonical_url || undefined, repositoryPath: document.repository_path || undefined, commit: document.commit_sha || undefined },
        resourceUri: `drupal://document/${document.id}`,
      });
    });
    const results = [...merged.values()].sort((a, b) => b.score - a.score || b.authority - a.authority || a.title.localeCompare(b.title)).slice(0, limit);
    return {
      query,
      appliedFilters: { drupalVersion: version, mode, projects: request.projects, sourceTypes: request.sourceTypes, entityKinds: request.entityKinds },
      index: await this.getIndexStatus(),
      degradedMode,
      results,
    };
  }

  async getEntity(request: EntityRequest): Promise<EntityResponse> {
    if (Boolean(request.entityId) === Boolean(request.identifier)) throw new Error('Provide exactly one of entityId or identifier');
    const version = request.drupalVersion ?? DEFAULT_DRUPAL_VERSION;
    let rows: Row[];
    if (request.entityId) {
      const clauses = ['e.id = ?'];
      const params: unknown[] = [request.entityId];
      if (version !== 'all') { clauses.push("(e.drupal_version=? OR e.drupal_version='all')"); params.push(version); }
      if (request.project) { clauses.push('e.project=?'); params.push(request.project); }
      if (request.kind) { clauses.push('e.kind=?'); params.push(request.kind); }
      rows = this.db.prepare(`SELECT e.*, d.canonical_url, d.commit_sha, d.modified_at
        FROM entities e LEFT JOIN documents d ON d.id=e.source_document_id WHERE ${clauses.join(' AND ')}`).all(...params) as Row[];
    } else {
      const clauses = ['(lower(e.canonical_name)=lower(?) OR lower(e.short_name)=lower(?) OR EXISTS (SELECT 1 FROM entity_aliases a WHERE a.entity_id=e.id AND lower(a.alias)=lower(?)))'];
      const params: unknown[] = [request.identifier, request.identifier, request.identifier];
      if (version !== 'all') {
        clauses.push(`(e.drupal_version=? OR (e.drupal_version='all' AND drupal_compatible(
          (SELECT s.drupal_core_constraint FROM source_snapshots s WHERE s.id=e.source_snapshot_id), ?) = 1))`);
        params.push(version, version);
      }
      if (request.project) { clauses.push('e.project=?'); params.push(request.project); }
      if (request.kind) { clauses.push('e.kind=?'); params.push(request.kind); }
      rows = this.db.prepare(`SELECT e.*, d.canonical_url, d.commit_sha, d.modified_at FROM entities e
        LEFT JOIN documents d ON d.id=e.source_document_id WHERE ${clauses.join(' AND ')}
        ORDER BY e.drupal_version DESC, e.canonical_name LIMIT 25`).all(...params) as Row[];
    }
    if (rows.length === 0) return { status: 'not_found' };
    if (rows.length > 1) return { status: 'ambiguous', candidates: rows.map(row => entityFromRow(row, this.manifest.builtAt)) };
    const entity = entityFromRow(rows[0], this.manifest.builtAt);
    const evidence = entity.evidenceResourceUri ? [{ resourceUri: entity.evidenceResourceUri, canonicalUrl: entity.canonicalUrl, filePath: entity.filePath, startLine: entity.startLine, endLine: entity.endLine }] : [];
    if (request.includeRelations === false) return { status: 'found', entity, evidence };
    const limit = Math.min(100, Math.max(1, request.relationLimit ?? 25));
    const outgoing = (this.db.prepare('SELECT * FROM relations WHERE from_id=? ORDER BY confidence DESC, predicate LIMIT ?').all(entity.id, limit) as Row[]).map(relationFromRow);
    const incoming = (this.db.prepare('SELECT * FROM relations WHERE to_id=? ORDER BY confidence DESC, predicate LIMIT ?').all(entity.id, limit) as Row[]).map(relationFromRow);
    return { status: 'found', entity, outgoing, incoming, evidence };
  }

  async exploreRelationships(request: RelationshipRequest): Promise<RelationshipResponse> {
    const found = await this.getEntity({ entityId: request.entityId, includeRelations: false });
    if (!found.entity) throw new Error(`Unknown entity: ${request.entityId}`);
    const direction = request.direction ?? 'both';
    const maxDepth = Math.min(3, Math.max(1, request.maxDepth ?? 1));
    const maxNodes = Math.min(200, Math.max(1, request.maxNodes ?? 50));
    const minConfidence = request.minConfidence ?? 0.7;
    const visited = new Set<string>([request.entityId]);
    let frontier = [request.entityId];
    const edges = new Map<string, RelationRecord>();
    let truncated = false;
    for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        const conditions = request.predicates?.length ? ` AND predicate IN (${request.predicates.map(() => '?').join(',')})` : '';
        const predicateParams = request.predicates ?? [];
        const rows: Row[] = [];
        if (direction !== 'incoming') rows.push(...this.db.prepare(`SELECT * FROM relations WHERE from_id=? AND confidence>=?${conditions}`).all(id, minConfidence, ...predicateParams) as Row[]);
        if (direction !== 'outgoing') rows.push(...this.db.prepare(`SELECT * FROM relations WHERE to_id=? AND confidence>=?${conditions}`).all(id, minConfidence, ...predicateParams) as Row[]);
        for (const row of rows) {
          const edge = relationFromRow(row);
          edges.set(edge.id, edge);
          const neighbor = edge.fromId === id ? edge.toId : edge.fromId;
          if (neighbor && !visited.has(neighbor)) {
            if (visited.size >= maxNodes) { truncated = true; continue; }
            visited.add(neighbor); next.push(neighbor);
          }
        }
      }
      frontier = next;
    }
    const ids = [...visited].filter(id => id !== request.entityId);
    const nodes = ids.length
      ? (this.db.prepare(`SELECT e.*, d.canonical_url, d.commit_sha, d.modified_at FROM entities e LEFT JOIN documents d ON d.id=e.source_document_id WHERE e.id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Row[]).map(row => entityFromRow(row, this.manifest.builtAt))
      : [];
    return { startEntity: found.entity, nodes, edges: [...edges.values()].sort((a, b) => b.confidence - a.confidence || a.predicate.localeCompare(b.predicate)), truncated };
  }

  async readResource(uri: string): Promise<ResourceRecord | null> {
    if (uri === 'drupal://index/status') return { uri, mimeType: 'application/json', text: JSON.stringify(await this.getIndexStatus(), null, 2) };
    const entityMatch = uri.match(/^drupal:\/\/entity\/(ent_[A-Za-z0-9_-]+)$/);
    if (entityMatch) {
      const response = await this.getEntity({ entityId: entityMatch[1], includeRelations: true, relationLimit: 100 });
      return response.entity ? { uri, mimeType: 'application/json', text: JSON.stringify(response, null, 2) } : null;
    }
    const documentMatch = uri.match(/^drupal:\/\/document\/(doc_[A-Za-z0-9_-]+)$/);
    if (documentMatch) {
      const row = this.db.prepare('SELECT * FROM documents WHERE id=?').get(documentMatch[1]) as Row | undefined;
      if (!row) return null;
      const header = [`# ${row.title}`, '', `Source: ${row.canonical_url ?? row.repository_path ?? 'local corpus'}`, `Drupal: ${row.drupal_version}`, `Indexed commit: ${row.commit_sha ?? 'n/a'}`, '', '---', ''];
      return { uri, mimeType: row.mime_type || 'text/plain', text: `${header.join('\n')}${row.content}` };
    }
    return null;
  }
}
