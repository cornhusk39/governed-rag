// Interfaces for the generation step. As with embeddings, generation sits behind
// a small interface so the live Anthropic path and the offline scripted path used
// by tests are interchangeable. The pipeline only knows the interface, so the
// whole test suite runs without an API key.

import type { RetrievedChunk } from "../retrieval/types.js";

import type { RawGeneration } from "./schema.js";

export interface GenerationInput {
  // The user's question.
  query: string;
  // The retrieved context the answer must be grounded in. Chunk ids in the
  // model's citations are validated against this set.
  chunks: RetrievedChunk[];
}

export interface GenerationUsage {
  inputTokens: number;
  outputTokens: number;
  // Estimated cost in USD for this call, for the audit log.
  costUsd: number;
  // Wall-clock latency of the model call.
  latencyMs: number;
}

export interface RawGenerationResult {
  generation: RawGeneration;
  usage: GenerationUsage;
}

export interface Generator {
  // Identifies the model (and provider) for the audit trail.
  readonly id: string;
  generate(input: GenerationInput): Promise<RawGenerationResult>;
}
