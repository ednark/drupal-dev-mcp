export type DrupalVersion = '10.6' | '11.4' | 'all';
export type SearchMode = 'hybrid' | 'lexical' | 'semantic';
export type NodeType =
  | 'document'
  | 'module'
  | 'class'
  | 'interface'
  | 'trait'
  | 'enum'
  | 'method'
  | 'function'
  | 'hook'
  | 'service'
  | 'plugin'
  | 'route'
  | 'event'
  | 'config';

export type RelationPredicate =
  | 'contains'
  | 'defines'
  | 'extends'
  | 'implements'
  | 'uses_trait'
  | 'calls'
  | 'instantiates'
  | 'references'
  | 'implements_hook'
  | 'invokes_hook'
  | 'implemented_by'
  | 'aliases'
  | 'decorates'
  | 'injects'
  | 'tagged_with'
  | 'handled_by'
  | 'subscribes_to'
  | 'dispatches'
  | 'deprecated_by'
  | 'documented_by'
  | 'changed_by'
  | 'example_of'
  | 'equivalent_to';

export interface IndexStatus {
  ready: boolean;
  schemaVersion: number;
  runId?: string;
  builtAt?: string;
  defaultDrupalVersion: Exclude<DrupalVersion, 'all'>;
  availableDrupalVersions: string[];
  counts: Record<string, number>;
  embeddingModel?: string;
  buildPath?: string;
  verification?: { passed: boolean; errors: string[]; warnings: string[] };
}

export interface SearchRequest {
  query: string;
  drupalVersion?: DrupalVersion | string;
  mode?: SearchMode;
  projects?: string[];
  sourceTypes?: string[];
  entityKinds?: NodeType[];
  limit?: number;
  includeSnippets?: boolean;
  snippetMaxChars?: number;
}

export interface SearchResult {
  id: string;
  resultType: 'document' | 'entity';
  title: string;
  snippet?: string;
  score: number;
  lexicalRank?: number;
  semanticRank?: number;
  exactMatch: boolean;
  sourceType: string;
  authority: number;
  project?: string;
  drupalVersion: string;
  compatibility: 'compatible' | 'cross_version';
  status: string;
  canonicalUrl?: string;
  repositoryPath?: string;
  commit?: string;
  freshness: string;
  chunkId?: string;
  chunkResourceUri?: string;
  provenance: {
    sourceKey: string;
    sourceType: string;
    authority: number;
    canonicalUrl?: string;
    repositoryPath?: string;
    commit?: string;
  };
  resourceUri: string;
}

export interface SearchResponse {
  query: string;
  appliedFilters: Record<string, unknown>;
  index: IndexStatus;
  degradedMode?: 'lexical_only';
  results: SearchResult[];
}

export interface EntityRequest {
  entityId?: string;
  identifier?: string;
  drupalVersion?: DrupalVersion | string;
  project?: string;
  kind?: NodeType;
  includeRelations?: boolean;
  relationLimit?: number;
}

export interface RelationRecord {
  id: string;
  fromId: string;
  predicate: RelationPredicate;
  toId?: string;
  unresolvedTarget?: string;
  confidence: number;
  extractor: string;
  evidenceDocumentId?: string;
  startLine?: number;
  endLine?: number;
  attributes?: Record<string, unknown>;
}

export interface EntityRecord {
  id: string;
  kind: NodeType;
  canonicalName: string;
  shortName: string;
  fqcn?: string;
  project?: string;
  drupalVersion: string;
  status: string;
  deprecationMessage?: string;
  replacementHint?: string;
  sourceDocumentId?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  canonicalUrl?: string;
  commit?: string;
  freshness?: string;
  evidenceResourceUri?: string;
  resourceUri: string;
}

export interface EntityResponse {
  status: 'found' | 'ambiguous' | 'not_found';
  entity?: EntityRecord;
  candidates?: EntityRecord[];
  incoming?: RelationRecord[];
  outgoing?: RelationRecord[];
  evidence?: Array<{ resourceUri: string; canonicalUrl?: string; filePath?: string; startLine?: number; endLine?: number }>;
}

export interface EntitiesRequest {
  entityIds: string[];
  drupalVersion?: DrupalVersion | string;
  includeRelations?: boolean;
  relationLimit?: number;
}

export interface EntityBatchItem {
  entityId: string;
  status: 'found' | 'not_found';
  entity?: EntityRecord;
  incoming?: RelationRecord[];
  outgoing?: RelationRecord[];
  evidence?: EntityResponse['evidence'];
}

export interface EntitiesResponse {
  results: EntityBatchItem[];
}

export interface RelationshipRequest {
  entityId: string;
  predicates?: RelationPredicate[];
  direction?: 'incoming' | 'outgoing' | 'both';
  maxDepth?: number;
  minConfidence?: number;
  maxNodes?: number;
  includeEvidence?: boolean;
}

export interface RelationshipResponse {
  startEntity: EntityRecord;
  nodes: EntityRecord[];
  edges: RelationRecord[];
  truncated: boolean;
}

export interface ResourceRecord {
  uri: string;
  mimeType: string;
  text: string;
}

export interface KnowledgeProvider {
  search(request: SearchRequest): Promise<SearchResponse>;
  getEntity(request: EntityRequest): Promise<EntityResponse>;
  getEntities(request: EntitiesRequest): Promise<EntitiesResponse>;
  exploreRelationships(request: RelationshipRequest): Promise<RelationshipResponse>;
  readResource(uri: string): Promise<ResourceRecord | null>;
  getIndexStatus(): Promise<IndexStatus>;
}

export interface NormalizedDocument {
  id: string;
  sourceKey: string;
  sourceType: string;
  authority: number;
  project?: string;
  drupalVersion: string;
  compatibility?: string;
  title: string;
  canonicalUrl?: string;
  repositoryPath?: string;
  commit?: string;
  mimeType: string;
  status: string;
  section?: string;
  content: string;
  contentHash: string;
  modifiedAt?: string;
}

export interface ExtractedEntity extends Omit<EntityRecord, 'resourceUri'> {
  aliases?: string[];
  parentId?: string;
}

export interface GraphExtraction {
  entities: ExtractedEntity[];
  relations: RelationRecord[];
  errors: Array<{ file: string; message: string }>;
}
