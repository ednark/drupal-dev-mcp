import type { EmbedFunction, LocalModelPreset } from './local-embed-types.js';

/**
 * Local (offline) embedding adapter — transformers.js, in-process, no daemon.
 *
 * This is an OPTION, not the default: the default build/query paths never
 * import this module (lazy dynamic import below), and the package itself is
 * an optionalDependency — a base install works without it.
 *
 * Why in-process transformers.js rather than Ollama/llama.cpp:
 * - The MCP server is a lightweight stdio process spawned per agent session;
 *   requiring an embedding daemon breaks that deployment shape.
 * - After the one-time model download (~35MB for bge-small), inference is
 *   fully offline — the project's operating requirement.
 * - CPU latency for short queries is well under 100ms on Apple Silicon.
 *
 * Model choice guidance (2026-11-09 research, docs/local-embeddings.md):
 * prefer context-window headroom over parameter count — mxbai-embed-large and
 * all-MiniLM-L6-v2 both truncate at the ~500-token chunk size this index
 * uses. Presets below are chosen for chunk compatibility and license.
 */

export type { EmbedFunction, LocalModelPreset };

/**
 * Curated presets. Prefixes are part of the models' training contracts —
 * omitting them silently degrades quality (nomic), and bge v1.5 expects its
 * retrieval instruction on QUERIES only.
 */
const MODEL_PRESETS: Record<string, LocalModelPreset> = {
  'bge-small-en-v1.5': {
    modelId: 'Xenova/bge-small-en-v1.5',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    documentPrefix: '',
    dims: 384,
  },
  'nomic-embed-text-v1.5': {
    modelId: 'Xenova/nomic-embed-text-v1.5',
    queryPrefix: 'search_query: ',
    documentPrefix: 'search_document: ',
    dims: 768,
  },
};

export type LocalModelName = keyof typeof MODEL_PRESETS | (string & {});

export function resolveLocalModel(name?: string): LocalModelPreset & { name: string } {
  const key = name ?? 'bge-small-en-v1.5';
  const preset = MODEL_PRESETS[key];
  if (preset) return { ...preset, name: key };
  // Allow a full HF model id for experiments; no prefix knowledge applied.
  return { name: key, modelId: key, queryPrefix: '', documentPrefix: '', dims: undefined };
}

export interface LocalEmbedderOptions {
  /** Preset name or full HuggingFace model id (default: bge-small-en-v1.5). */
  model?: string;
  /** Override the transformers.js model cache directory. */
  cacheDir?: string;
  /** Quantization (default q8 — smallest, CPU-friendly). */
  dtype?: 'q8' | 'fp16' | 'fp32';
  /** Texts per pipeline call (default 32). */
  batchSize?: number;
  /** Override the preset's query/document prefixes (advanced). */
  prefixes?: { query?: string; document?: string };
}

export interface LocalEmbedder {
  /** Resolved preset (name + modelId + prefixes). */
  readonly preset: LocalModelPreset & { name: string };
  /** Batch embed documents (applies the document prefix). */
  readonly embed: EmbedFunction;
  /** Embed one query (applies the query prefix) — matches ProviderOptions.queryEmbedder. */
  embedQuery: (query: string) => Promise<number[]>;
  /** True once the underlying pipeline has been instantiated. */
  readonly initialized: boolean;
}

export function createLocalEmbedder(options: LocalEmbedderOptions = {}): LocalEmbedder {
  const preset = resolveLocalModel(options.model);
  const queryPrefix = options.prefixes?.query ?? preset.queryPrefix;
  const documentPrefix = options.prefixes?.document ?? preset.documentPrefix;
  const batchSize = options.batchSize ?? 32;
  /** transformers.js feature-extraction pipeline, callable shape (Tensor → number[][]). */
  type FeatureExtractor = (texts: string[], poolOptions: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist: () => number[][] }>;
  let extractorPromise: Promise<FeatureExtractor> | null = null;

  function init() {
    extractorPromise ??= (async () => {
      let transformers: typeof import('@huggingface/transformers');
      try {
        transformers = await import('@huggingface/transformers');
      } catch {
        throw new Error('The local embedder requires @huggingface/transformers (optionalDependency of @drupal-dev-mcp/knowledge). Install it with: npm install -w @drupal-dev-mcp/knowledge');
      }
      if (options.cacheDir) transformers.env.cacheDir = options.cacheDir;
      return await transformers.pipeline('feature-extraction', preset.modelId, { dtype: options.dtype ?? 'q8' }) as unknown as FeatureExtractor;
    })();
    return extractorPromise;
  }

  async function embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await init();
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += batchSize) {
      const batch = texts.slice(offset, offset + batchSize).map(text => `${documentPrefix}${text}`);
      const output = await extractor(batch, { pooling: 'mean', normalize: true });
      vectors.push(...output.tolist());
    }
    return vectors;
  }

  return {
    preset: { ...preset, queryPrefix, documentPrefix },
    embed,
    embedQuery: async (query: string) => {
      const extractor = await init();
      const output = await extractor([`${queryPrefix}${query}`], { pooling: 'mean', normalize: true });
      return output.tolist()[0]!;
    },
    get initialized() {
      return extractorPromise !== null;
    },
  };
}
