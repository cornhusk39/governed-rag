// The refusal policy.
//
// Refusal has two triggers, per the spec. The first is pre-generation: if the
// best retrieval result is too weak, the question is probably out of corpus, so
// we refuse before spending a generation call. The second is post-generation:
// if the citation pre-check fails or the verifier does not confirm the claims,
// we refuse rather than surface an unverified answer. Either way the user gets an
// explicit "not supported by the corpus" response and the audit row is marked
// refused.

import type { RetrievedChunk } from "../retrieval/types.js";

// The machine-readable reason a query was refused, recorded in the audit log.
export type RefusalReason =
  | "no_retrieval" // nothing came back at all
  | "low_retrieval_score" // top result below the calibrated floor
  | "citation_precheck_failed" // a claim cited a chunk we never retrieved
  | "no_claims" // the model abstained (returned no claims)
  | "unverified_claims"; // the verifier did not confirm the claims

// The user-facing message. Intentionally uniform so we never leak why internally.
export const REFUSAL_MESSAGE = "This question is not supported by the available corpus.";

export interface RetrievalGateConfig {
  // Minimum fused (RRF) score the top result must reach. Calibrated on the
  // fixture index: an in-corpus query surfaces a chunk that ranks in both the
  // vector and keyword lists, clearing this floor, while an out-of-corpus query
  // matches no keywords and only appears in the vector list, falling below it.
  // This default is tied to the default RRF k of 60.
  minTopRrf: number;
}

export const DEFAULT_RETRIEVAL_GATE: RetrievalGateConfig = {
  minTopRrf: 0.02,
};

export interface RetrievalGateResult {
  sufficient: boolean;
  reason?: RefusalReason;
  topRrf: number;
}

/**
 * Decide whether retrieval was strong enough to attempt an answer.
 */
export function checkRetrievalGate(
  chunks: RetrievedChunk[],
  config: RetrievalGateConfig = DEFAULT_RETRIEVAL_GATE,
): RetrievalGateResult {
  if (chunks.length === 0) {
    return { sufficient: false, reason: "no_retrieval", topRrf: 0 };
  }
  const topRrf = Math.max(...chunks.map((c) => c.scores.rrf));
  if (topRrf < config.minTopRrf) {
    return { sufficient: false, reason: "low_retrieval_score", topRrf };
  }
  return { sufficient: true, topRrf };
}
