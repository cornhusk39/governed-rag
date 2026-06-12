// Orchestrate one generation step: call the generator, then resolve and pre-check
// its citations against the retrieved context. This is the seam the query pipeline
// builds on (retrieve, generate, verify, refuse, audit). It deliberately does not
// retrieve or verify on its own, keeping each stage's responsibility separate.

import { resolveCitations, type ResolvedGeneration } from "./citations.js";
import type { GenerationInput, GenerationUsage, Generator } from "./types.js";

export interface GeneratedAnswer {
  resolved: ResolvedGeneration;
  usage: GenerationUsage;
  // The generator id (provider and model) for the audit trail.
  model: string;
}

export async function generateAnswer(
  input: GenerationInput,
  generator: Generator,
): Promise<GeneratedAnswer> {
  const { generation, usage } = await generator.generate(input);
  const resolved = resolveCitations(generation, input.chunks);
  return { resolved, usage, model: generator.id };
}
