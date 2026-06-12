// Schema for a groundedness judgment. The verifier judges one claim against the
// verbatim evidence that supposedly supports it, and must answer through this
// constrained shape: a boolean entailment decision, a confidence, and a short
// rationale. Constraining the judge to a schema is itself a governance measure;
// it keeps the verifier from drifting into free-form commentary and keeps its
// output auditable.

import { z } from "zod";

export const judgeVerdictSchema = z.object({
  // True only if the evidence alone substantiates the claim.
  entailed: z.boolean(),
  // The judge's confidence in its decision, 0 to 1.
  confidence: z.number(),
  // A brief explanation, stored in the audit log.
  rationale: z.string(),
});

export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;

export const JUDGE_JSON_SCHEMA = {
  type: "object",
  properties: {
    entailed: { type: "boolean" },
    confidence: { type: "number" },
    rationale: { type: "string" },
  },
  required: ["entailed", "confidence", "rationale"],
  additionalProperties: false,
} as const;
