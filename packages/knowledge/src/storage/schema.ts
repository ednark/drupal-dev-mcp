import Database from 'better-sqlite3';

export const SCHEMA_VERSION = 1;

export function openDatabase(file: string, readonly = false): Database.Database {
  const db = new Database(file, { readonly, fileMustExist: readonly });
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
  }
  return db;
}

export function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_runs (
      id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      corpus_digest TEXT NOT NULL,
      embedding_model TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS source_snapshots (
      id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      authority INTEGER NOT NULL,
      project TEXT,
      version_scope TEXT NOT NULL,
      version_line TEXT NOT NULL,
      raw_version TEXT NOT NULL,
      drupal_core_constraint TEXT,
      stability TEXT NOT NULL,
      canonical_base_url TEXT NOT NULL,
      repository_url TEXT,
      repository_ref TEXT,
      commit_sha TEXT,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL,
      stable_key TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
      source_snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
      source_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      authority INTEGER NOT NULL,
      project TEXT,
      drupal_version TEXT NOT NULL,
      compatibility TEXT,
      title TEXT NOT NULL,
      canonical_url TEXT,
      repository_path TEXT,
      commit_sha TEXT,
      mime_type TEXT NOT NULL,
      status TEXT NOT NULL,
      section TEXT,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      modified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      locator TEXT NOT NULL,
      text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      UNIQUE(document_id, ordinal)
    );

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
      source_snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
      source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
      parent_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      short_name TEXT NOT NULL,
      fqcn TEXT,
      project TEXT,
      drupal_version TEXT NOT NULL,
      status TEXT NOT NULL,
      deprecation_message TEXT,
      replacement_hint TEXT,
      file_path TEXT,
      start_line INTEGER,
      end_line INTEGER
    );

    CREATE TABLE IF NOT EXISTS entity_aliases (
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      alias_kind TEXT NOT NULL DEFAULT 'name',
      PRIMARY KEY(entity_id, alias)
    );

    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      predicate TEXT NOT NULL,
      to_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
      unresolved_target TEXT,
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
      extractor TEXT NOT NULL,
      evidence_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
      start_line INTEGER,
      end_line INTEGER,
      attributes_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_documents_version ON documents(drupal_version, source_type, project);
    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(canonical_name, short_name, drupal_version);
    CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project, kind, drupal_version);
    CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_id, confidence);
    CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id, confidence);

    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
      document_id UNINDEXED, title, section, content, tokenize='unicode61 remove_diacritics 2'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(
      entity_id UNINDEXED, canonical_name, short_name, aliases, tokenize='unicode61 tokenchars ''_\\'''
    );
  `);
}
