import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DrupalAgent, OpenAiLlmProvider } from '@drupal-dev-mcp/agent';
import type { KnowledgeProvider, NodeType, RelationPredicate } from '@drupal-dev-mcp/knowledge';

const DrupalVersionSchema = z.enum(['10.6', '11.4', '12.0', 'all']);
const NodeTypeSchema = z.enum([
  'document', 'module', 'class', 'interface', 'trait', 'enum', 'method', 'function',
  'hook', 'service', 'plugin', 'route', 'event', 'config', 'component', 'config_schema',
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
    drupalVersion: z.string(), compatibility: z.enum(['compatible', 'cross_version']), status: z.string(),
    freshness: z.string(), chunkId: z.string().optional(), chunkResourceUri: z.string().optional(),
    provenance: z.record(z.string(), z.unknown()), resourceUri: z.string(),
  }).passthrough()),
});
const EntityOutputSchema = z.object({
  status: z.enum(['found', 'ambiguous', 'not_found']),
  entity: z.record(z.string(), z.unknown()).optional(),
  candidates: z.array(z.record(z.string(), z.unknown())).optional(),
  incoming: z.array(z.record(z.string(), z.unknown())).optional(),
  outgoing: z.array(z.record(z.string(), z.unknown())).optional(),
  evidence: z.array(z.record(z.string(), z.unknown())).optional(),
});
const EntitiesOutputSchema = z.object({
  results: z.array(z.object({
    entityId: z.string(),
    status: z.enum(['found', 'not_found']),
    entity: z.record(z.string(), z.unknown()).optional(),
    incoming: z.array(z.record(z.string(), z.unknown())).optional(),
    outgoing: z.array(z.record(z.string(), z.unknown())).optional(),
    evidence: z.array(z.record(z.string(), z.unknown())).optional(),
  })),
});
const DocumentOutputSchema = z.object({
  status: z.enum(['found', 'not_found']),
  uri: z.string().optional(),
  mimeType: z.string().optional(),
  text: z.string().optional(),
  textLength: z.number().int().optional(),
});
const IndexStatusOutputSchema = z.object({
  ready: z.boolean(),
  schemaVersion: z.number(),
  runId: z.string().optional(),
  builtAt: z.string().optional(),
  defaultDrupalVersion: z.string(),
  availableDrupalVersions: z.array(z.string()),
  counts: z.record(z.string(), z.number()),
  embeddingModel: z.string().optional(),
  buildPath: z.string().optional(),
  fixtureLimit: z.number().optional(),
  verification: z.object({ passed: z.boolean(), errors: z.array(z.string()), warnings: z.array(z.string()) }).optional(),
});
const RelationshipOutputSchema = z.object({
  startEntity: z.record(z.string(), z.unknown()),
  nodes: z.array(z.record(z.string(), z.unknown())),
  edges: z.array(z.record(z.string(), z.unknown())),
  truncated: z.boolean(),
});
const GroundingStatsSchema = z.object({
  sentences: z.number(),
  citedSentences: z.number(),
  citations: z.number(),
  groundingDensity: z.number().nullable(),
});

const ExpertOutputSchema = z.object({
  status: z.enum(['answered', 'insufficient_evidence', 'unavailable', 'error']),
  question: z.string().optional(),
  drupalVersion: z.string().optional(),
  answer: z.string().optional(),
  stopReason: z.string().optional(),
  iterations: z.number().optional(),
  insufficientEvidence: z.boolean().optional(),
  grounding: GroundingStatsSchema.optional(),
  citations: z.array(z.object({ resourceUri: z.string(), canonicalUrl: z.string().optional(), title: z.string() })).optional(),
  evidence: z.array(z.record(z.string(), z.unknown())).optional(),
  reason: z.string().optional(),
}).passthrough();

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function toolResult(payload: Record<string, unknown>, resourceUris: string[]) {
  const links = [...new Set(resourceUris)].map(uri => ({ type: 'resource_link' as const, uri, name: uri }));
  // Mirror the few host-actionable envelope signals into result-level _meta
  // (namespaced) so MCP hosts can react without parsing structuredContent.
  // The payload remains the authoritative, complete contract.
  const meta: Record<string, unknown> = {};
  if ('status' in payload) meta['drupal-dev-mcp/status'] = payload.status;
  if ('degradedMode' in payload) meta['drupal-dev-mcp/degraded-mode'] = payload.degradedMode;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }, ...links],
    structuredContent: payload,
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}

function resourceResponse(uri: string, mimeType: string, text: string) {
  return { contents: [{ uri, mimeType, text }] };
}

export function createDrupalMcpServer(provider: KnowledgeProvider): McpServer {
  const server = new McpServer({ name: 'drupal-dev-mcp', version: '0.2.0' });

  // Static capability advertisement, evaluated once at server construction:
  // OPENAI_API_KEY presence is fixed for the process lifetime, so this never
  // goes stale. Dynamic facts (index readiness, build freshness) stay out of
  // capabilities — query get_index_status / drupal://index/status for those.
  // Clients that understand capabilities may prune ask_a_drupal_expert from
  // their tool surface or warn up front; every client still gets the
  // runtime `status: "unavailable"` fallback below.
  server.server.registerCapabilities({
    experimental: {
      'drupal-dev-mcp/synthesis': {
        tool: 'ask_a_drupal_expert',
        available: Boolean(process.env.OPENAI_API_KEY),
      },
    },
  });

  server.registerTool('search_drupal', {
    title: 'Search Drupal evidence',
    description: 'Search the closed, versioned Drupal knowledge index (core code 10.6/11.4/12.0, api.drupal.org, change records, official guides, coding standards, 73 contrib modules, PHP/Twig/Symfony/Drush docs). Returns evidence with provenance, never advice. Use short keyword or identifier queries (e.g. "hook_entity_presave", "EntityTypeManagerInterface") — they score better than sentences; run several narrow queries rather than one broad one. source_types ["guidance"] narrows to curated change-placement guidance.',
    inputSchema: z.object({
      query: z.string().min(1),
      drupal_version: DrupalVersionSchema.default('11.4'),
      mode: z.enum(['hybrid', 'lexical', 'semantic']).default('hybrid'),
      projects: z.array(z.string()).optional(),
      source_types: z.array(z.string()).optional(),
      entity_kinds: z.array(NodeTypeSchema).optional(),
      limit: z.number().int().min(1).max(25).default(8),
      include_snippets: z.boolean().default(true),
      snippet_max_chars: z.number().int().min(40).max(2000).optional(),
      min_score: z.number().min(0).max(1).default(0.2),
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
      snippetMaxChars: input.snippet_max_chars,
      minScore: input.min_score,
    });
    return toolResult(response as unknown as Record<string, unknown>, response.results.map(result => result.chunkResourceUri ?? result.resourceUri));
  });

  server.registerTool('get_drupal_entity', {
    title: 'Get Drupal entity',
    description: 'Resolve one indexed Drupal entity by opaque ID (ent_…) or exact identifier, with explicit disambiguation, relations, and evidence. Candidate ordering is deterministic within an index build.',
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

  server.registerTool('get_drupal_entities', {
    title: 'Get Drupal entities in batch',
    description: 'Resolve up to 25 indexed Drupal entities by opaque ID (ent_…) in one call. Unknown IDs are reported per item as not_found instead of failing the batch.',
    inputSchema: z.object({
      entity_ids: z.array(z.string().startsWith('ent_')).min(1).max(25),
      drupal_version: DrupalVersionSchema.default('11.4'),
      include_relations: z.boolean().default(false),
      relation_limit: z.number().int().min(1).max(100).default(25),
    }),
    outputSchema: EntitiesOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async input => {
    const response = await provider.getEntities({
      entityIds: input.entity_ids,
      drupalVersion: input.drupal_version,
      includeRelations: input.include_relations,
      relationLimit: input.relation_limit,
    });
    const uris = response.results.filter(item => item.entity).map(item => item.entity!.resourceUri);
    return toolResult(response as unknown as Record<string, unknown>, uris);
  });

  server.registerTool('get_drupal_document', {
    title: 'Get Drupal source document',
    description: 'Return the exact indexed text of one source document, or a single chunk (chunk_id). Use to verify a citation against source content — the mechanical citation check.',
    inputSchema: z.object({
      document_id: z.string().startsWith('doc_'),
      chunk_id: z.string().startsWith('chk_').optional(),
    }),
    outputSchema: DocumentOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async input => {
    const uri = input.chunk_id ? `drupal://document/${input.document_id}#chunk/${input.chunk_id}` : `drupal://document/${input.document_id}`;
    const resource = await provider.readResource(uri);
    if (!resource) return toolResult({ status: 'not_found' }, []);
    return toolResult({ status: 'found', uri: resource.uri, mimeType: resource.mimeType, text: resource.text, textLength: resource.text.length }, [resource.uri]);
  });

  server.registerTool('get_index_status', {
    title: 'Get Drupal knowledge index status',
    description: 'Report the active verified index build: readiness, build date, versions, counts, verification. Use to judge evidence freshness before trusting results.',
    inputSchema: z.object({}),
    outputSchema: IndexStatusOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => {
    const status = await provider.getIndexStatus();
    return toolResult(status as unknown as Record<string, unknown>, ['drupal://index/status']);
  });

  server.registerTool('explore_drupal_relationships', {
    title: 'Explore Drupal relationships',
    description: 'Traverse deterministic, evidence-backed Drupal relationships (extends, implements, injects, implements_hook, subscribes_to, decorates, changed_by, deprecated_by, …) for API genealogy. Start from an ent_… ID resolved via get_drupal_entity. Edges below min_confidence (default 0.7) are excluded.',
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

  server.registerTool('ask_a_drupal_expert', {
    title: 'Ask a Drupal expert',
    description: 'Evidence-grounded synthesized answers to Drupal questions needing conclusions rather than retrieval ("where should this change live", "when is a custom theme warranted"). Opt-in: requires OPENAI_API_KEY in the server environment; without it returns status "unavailable" and all other tools keep working. Modes: "ask" (one evidence round, concise answer) or "research" (iterative multi-query rounds, design-doc-shaped report). Every answer cites drupal:// resources and carries grounding-density stats; unanswerable questions return insufficient_evidence instead of guesses. Verify cited URIs with get_drupal_document before relying on prose — citation URIs can be subtly wrong.',
    inputSchema: z.object({
      question: z.string().min(1).describe('A question needing synthesis, not just retrieval. Natural language is fine here — the tool converts it into index-friendly searches.'),
      depth: z.enum(['ask', 'research']).default('ask'),
      drupal_version: DrupalVersionSchema.default('11.4'),
    }),
    outputSchema: ExpertOutputSchema,
    annotations: {
      ...READ_ONLY_ANNOTATIONS,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async input => {
    if (!process.env.OPENAI_API_KEY) {
      return toolResult({
        status: 'unavailable',
        reason: 'ask_a_drupal_expert requires OPENAI_API_KEY in the MCP server environment. All retrieval tools remain available without it.',
      }, []);
    }
    try {
      const agent = new DrupalAgent({ knowledge: provider, llm: new OpenAiLlmProvider() });
      const response = input.depth === 'research'
        ? await agent.research(input.question, { drupalVersion: input.drupal_version })
        : await agent.ask(input.question, { drupalVersion: input.drupal_version });
      // AgentAnswer carries stopReason, not status; map it onto the tool's
      // output contract so every successful run validates.
      const status = response.stopReason === 'insufficient_evidence'
        ? 'insufficient_evidence' as const
        : 'answered' as const;
      return toolResult(
        { ...response, status } as unknown as Record<string, unknown>,
        response.citations.map(citation => citation.resourceUri),
      );
    } catch (error) {
      return toolResult({
        status: 'error',
        reason: error instanceof Error ? error.message : String(error),
      }, []);
    }
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
