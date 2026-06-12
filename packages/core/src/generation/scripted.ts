// A scripted generator for tests and offline/demo use.
//
// It returns a caller-supplied response (or runs a caller-supplied function
// against the input), so tests can exercise the full citation-resolution and
// verification pipeline deterministically without a model or a key. This is the
// generation-side equivalent of FakeEmbedder.

import { rawGenerationSchema, type RawGeneration } from "./schema.js";
import type { GenerationInput, Generator, RawGenerationResult } from "./types.js";

export type ScriptedResponder = (input: GenerationInput) => RawGeneration;

export interface ScriptedGeneratorOptions {
  // Either a fixed response or a function that derives one from the input.
  respond: RawGeneration | ScriptedResponder;
  // Reported model id, defaults to a clearly-fake value.
  id?: string;
}

export class ScriptedGenerator implements Generator {
  readonly id: string;
  private readonly respond: ScriptedResponder;

  constructor(options: ScriptedGeneratorOptions) {
    this.id = options.id ?? "scripted-generator";
    this.respond =
      typeof options.respond === "function" ? options.respond : () => options.respond as RawGeneration;
  }

  async generate(input: GenerationInput): Promise<RawGenerationResult> {
    // Validate the scripted output through the same schema the live path uses, so
    // a malformed test fixture fails loudly rather than slipping through.
    const generation = rawGenerationSchema.parse(this.respond(input));
    return {
      generation,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 },
    };
  }
}
