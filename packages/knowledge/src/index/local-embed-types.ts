/** Shared types for the local-embedding adapter (kept dependency-free for tests). */

export type EmbedFunction = (texts: string[]) => Promise<number[][]>;

export interface LocalModelPreset {
  /** Preset key ('bge-small-en-v1.5') for presets; echoed back for ad-hoc ids. */
  name?: string;
  /** Full HuggingFace model id used with transformers.js pipeline(). */
  modelId: string;
  /** Prepended to QUERIES at embed time (part of the model's training contract). */
  queryPrefix: string;
  /** Prepended to DOCUMENTS at embed time. */
  documentPrefix: string;
  /** Embedding dimensionality, when known for the preset. */
  dims?: number;
}
