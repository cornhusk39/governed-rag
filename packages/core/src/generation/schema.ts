// The structured shape we force generation into.
//
// A free-text answer is not acceptable here: governance requires that every
// statement be attributable. So the model must return an array of claims, each
// tagged with the chunk ids that support it and a verbatim quote we can resolve
// to a character span. We constrain the model two ways that reinforce each
// other: the API is asked for this exact JSON schema (output_config.format), and
// the response is independently re-validated with Zod. If the model somehow
// returns something off-shape, validation rejects it rather than letting an
// uncited answer through.

import { z } from "zod";

// Zod schema used to validate the model's response after the fact. This is the
// source of truth for the parsed shape used throughout the pipeline.
export const rawClaimSchema = z.object({
  // The claim statement, in the model's own words.
  text: z.string().min(1),
  // Chunk ids (the deterministic chunk_uid) that support this claim. May be
  // empty, which the citation pre-check will treat as an unsupported claim.
  chunk_ids: z.array(z.string()),
  // A short verbatim quote copied from one of the cited chunks. We resolve this
  // to exact character offsets; if it is not found verbatim, the citation does
  // not resolve to a span.
  quote: z.string(),
});

export const rawGenerationSchema = z.object({
  // The prose answer shown to the user. Every factual statement in it should
  // also appear as a claim.
  answer: z.string(),
  claims: z.array(rawClaimSchema),
});

export type RawClaim = z.infer<typeof rawClaimSchema>;
export type RawGeneration = z.infer<typeof rawGenerationSchema>;

// The JSON Schema handed to the Messages API via output_config.format. It mirrors
// the Zod schema above. Structured outputs require additionalProperties:false on
// every object and do not support string length constraints, so this is kept to
// the supported subset.
export const GENERATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          chunk_ids: { type: "array", items: { type: "string" } },
          quote: { type: "string" },
        },
        required: ["text", "chunk_ids", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["answer", "claims"],
  additionalProperties: false,
} as const;
