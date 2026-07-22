import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KnowledgeProvider, NodeType, RelationPredicate } from '@drupal-dev-mcp/knowledge';

const DrupalVersionSchema = z.enum(['10.6', '11.4', 'all']);
const NodeTypeSchema = z.enum([
  'document', 'module', 'class', 'interface', 'trait', 'enum', 'method', 'function',
  'hook', 'service', 'plugin', 'route', 'event', 'config',
]);
const RelationPredicateSchema = z.enum([
  'contains', 'defines', 'extends', 'implements', 'uses_trait', 'calls', 'instantiates',
  'references', 'implements_hook', 'invokes_hook', 'implemented_by', 'aliases', 'decorates',
  'injects', 'tagged_with', 'handled_by', 'subscribes_to', 'dispatches', 'deprecated_by',
  'documented_by', 'changed_by', 'example_of', 'equivalent_to',
]);

const SearchOutputSchema = z.object({
  query: z.string(),
  appliedFilters: z.record(z.string(), z.unknown()),
  index: z.record(z.string(), z.unknown()),
  degradedMode: z.literal('lexical_only').optional(),
  results: z.array(z.object({
    id: z.string(), resultType: z.enum(['document', 'entity']), title: z.string(),
    snippet: z.string().optional(), score: z.number(), exactMatch: z.boolean(),
    sourceType: z.string(), authority: z.number(), project: z.string().optional(),
    drupalVersion: z.string(), status: z.string(), resourceUri: z.string(),
  }).passthrough()),
});
const EntityOutputSchema = z.object({
  status: z.enum(['found', 'ambiguous', 'not_found']),
  entity: z.record(z.string(), z.unknown()).optional(),
  candidates: z.array(z.record(z.string(), z.unknown())).optional(),
  incoming: z.array(z.record(z.string(), z.unknown())).optional(),
  outgoing: z.array(z.record(z.string(), z.unknown())).optional(),
});
const RelationshipOutputSchema = z.object({
  startEntity: z.record(z.string(), z.unknown()),
  nodes: z.array(z.record(z.string(), z.unknown())),
  edges: z.array(z.record(z.string(), z.unknown())),
  truncated: z.boolean(),
});

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function toolResult(payload: Record<string, unknown>, resourceUris: string[]) {
  const links = [...new Set(resourceUris)].map(uri => ({ type: 'resource_link' as const, uri, name: uri }));
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }, ...links],
    structuredContent: payload,
  };
}

function resourceResponse(uri: string, mimeType: string, text: string) {
  return { contents: [{ uri, mimeType, text }] };
}

export function createDrupalMcpServer(provider: KnowledgeProvider): McpServer {
  const server = new McpServer({ name: 'drupal-dev-mcp', version: '0.2.0' });

  server.registerTool('search_drupal', {
    title: 'Search Drupal evidence',
    description: 'Search the closed, versioned Drupal knowledge index. Returns evidence and provenance, never generated advice.',
    inputSchema: z.object({
      query: z.string().min(1),
      drupal_version: DrupalVersionSchema.default('11.4'),
      mode: z.enum(['hybrid', 'lexical', 'semantic']).default('hybrid'),
      projects: z.array(z.string()).optional(),
      source_types: z.array(z.string()).optional(),
      entity_kinds: z.array(NodeTypeSchema).optional(),
      limit: z.number().int().min(1).max(25).default(8),
      include_snippets: z.boolean().default(true),
    }),
    outputSchema: SearchOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async input => {
    const response = await provider.search({
      query: input.query,
      drupalVersion: input.drupal_version,
      mode: input.mode,
      projects: input.projects,
      sourceTypes: input.source_types,
      entityKinds: input.entity_kinds as NodeType[] | undefined,
      limit: input.limit,
      includeSnippets: input.include_snippets,
    });
    return toolResult(response as unknown as Record<string, unknown>, response.results.map(result => result.resourceUri));
  });

  server.registerTool('get_drupal_entity', {
    title: 'Get Drupal entity',
    description: 'Resolve one indexed Drupal entity by opaque ID or exact identifier with explicit disambiguation.',
    inputSchema: z.object({
      entity_id: z.string().startsWith('ent_').optional(),
      identifier: z.string().min(1).optional(),
      drupal_version: DrupalVersionSchema.default('11.4'),
      project: z.string().optional(),
      kind: NodeTypeSchema.optional(),
      include_relations: z.boolean().default(true),
      relation_limit: z.number().int().min(1).max(100).default(25),
    }).refine(value => Boolean(value.entity_id) !== Boolean(value.identifier), 'Provide exactly one of entity_id or identifier'),
    outputSchema: EntityOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async input => {
    const response = await provider.getEntity({
      entityId: input.entity_id,
      identifier: input.identifier,
      drupalVersion: input.drupal_version,
      project: input.project,
      kind: input.kind as NodeType | undefined,
      includeRelations: input.include_relations,
      relationLimit: input.relation_limit,
    });
    const uris = [response.entity, ...(response.candidates ?? [])].filter(Boolean).map(entity => entity!.resourceUri);
    return toolResult(response as unknown as Record<string, unknown>, uris);
  });

  server.registerTool('explore_drupal_relationships', {
    title: 'Explore Drupal relationships',
    description: 'Traverse deterministic, evidence-backed Drupal relationships. Low-confidence edges are excluded by default.',
    inputSchema: z.object({
      entity_id: z.string().startsWith('ent_'),
      predicates: z.array(RelationPredicateSchema).optional(),
      direction: z.enum(['incoming', 'outgoing', 'both']).default('both'),
      max_depth: z.number().int().min(1).max(3).default(1),
      min_confidence: z.number().min(0).max(1).default(0.7),
      max_nodes: z.number().int().min(1).max(200).default(50),
      include_evidence: z.boolean().default(true),
    }),
    outputSchema: RelationshipOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async input => {
    const response = await provider.exploreRelationships({
      entityId: input.entity_id,
      predicates: input.predicates as RelationPredicate[] | undefined,
      direction: input.direction,
      maxDepth: input.max_depth,
      minConfidence: input.min_confidence,
      maxNodes: input.max_nodes,
      includeEvidence: input.include_evidence,
    });
    return toolResult(response as unknown as Record<string, unknown>, [
      response.startEntity.resourceUri,
      ...response.nodes.map(node => node.resourceUri),
      ...response.edges.flatMap(edge => edge.evidenceDocumentId ? [`drupal://document/${edge.evidenceDocumentId}`] : []),
    ]);
  });

  server.registerResource('drupal-index-status', 'drupal://index/status', {
    title: 'Drupal knowledge index status', mimeType: 'application/json', description: 'Active verified index status and freshness.',
  }, async uri => {
    const resource = await provider.readResource(uri.href);
    if (!resource) throw new Error(`Resource not found: ${uri.href}`);
    return resourceResponse(resource.uri, resource.mimeType, resource.text);
  });

  server.registerResource('drupal-entity', new ResourceTemplate('drupal://entity/{id}', { list: undefined }), {
    title: 'Drupal entity', mimeType: 'application/json', description: 'One entity and its evidence-backed relationships.',
  }, async uri => {
    const resource = await provider.readResource(uri.href);
    if (!resource) throw new Error(`Resource not found: ${uri.href}`);
    return resourceResponse(resource.uri, resource.mimeType, resource.text);
  });

  server.registerResource('drupal-document', new ResourceTemplate('drupal://document/{id}', { list: undefined }), {
    title: 'Drupal source document', mimeType: 'text/plain', description: 'Exact indexed source content and provenance.',
  }, async uri => {
    const resource = await provider.readResource(uri.href);
    if (!resource) throw new Error(`Resource not found: ${uri.href}`);
    return resourceResponse(resource.uri, resource.mimeType, resource.text);
  });

  return server;
}
