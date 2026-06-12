// The live generation path, backed by the Anthropic Messages API.
//
// We use structured outputs (output_config.format with a JSON schema) so the
// model is constrained to return our claims-with-citations shape, then we
// re-validate the response with Zod as a belt-and-suspenders check. The API key
// comes from the environment only and is never logged. Tests never construct this;
// they use ScriptedGenerator, so the suite stays offline.

import Anthropic from "@anthropic-ai/sdk";

import { buildPrompt } from "./prompt.js";
import { estimateCostUsd } from "./pricing.js";
import { GENERATION_JSON_SCHEMA, rawGenerationSchema } from "./schema.js";
import type { GenerationInput, Generator, RawGenerationResult } from "./types.js";

export interface AnthropicGeneratorOptions {
  apiKey: string;
  // Defaults to Claude Opus 4.8. Override per deployment.
  model?: string;
  maxTokens?: number;
  // Injectable for tests if ever needed; defaults to a real client.
  client?: Anthropic;
}

export class AnthropicGenerator implements Generator {
  readonly id: string;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: AnthropicGeneratorOptions) {
    if (!options.apiKey && !options.client) {
      throw new Error("AnthropicGenerator requires an API key (set ANTHROPIC_API_KEY).");
    }
    this.model = options.model ?? "claude-opus-4-8";
    this.maxTokens = options.maxTokens ?? 4096;
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
    this.id = `anthropic:${this.model}`;
  }

  async generate(input: GenerationInput): Promise<RawGenerationResult> {
    const { system, user } = buildPrompt(input.query, input.chunks);

    const startedAt = Date.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      // Constrain the response to our claims-with-citations schema.
      output_config: {
        format: {
          type: "json_schema",
          schema: GENERATION_JSON_SCHEMA,
        },
      },
    });
    const latencyMs = Date.now() - startedAt;

    // With output_config.format the first text block is guaranteed to be valid
    // JSON for the schema. We still parse and re-validate defensively.
    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("generation response contained no text block");
    }
    const parsed = rawGenerationSchema.parse(JSON.parse(textBlock.text));

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    return {
      generation: parsed,
      usage: {
        inputTokens,
        outputTokens,
        costUsd: estimateCostUsd(this.model, inputTokens, outputTokens),
        latencyMs,
      },
    };
  }
}
