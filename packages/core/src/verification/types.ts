// Interfaces for the groundedness verifier. Like generation, the judge sits
// behind a small interface so tests use a scripted judge and run offline.

import type { JudgeVerdict } from "./schema.js";

export interface JudgeInput {
  // The claim under scrutiny.
  claim: string;
  // The verbatim evidence (a resolved quote) that should support the claim.
  quote: string;
  // Where the evidence came from, for context in the judge prompt.
  sectionLabel: string;
}

// One judge call: the verdict plus its estimated cost, so verification spend is
// captured in the audit log alongside generation spend.
export interface JudgeResult {
  verdict: JudgeVerdict;
  costUsd: number;
}

export interface Verifier {
  // Identifies the judge model for the audit trail.
  readonly id: string;
  judge(input: JudgeInput): Promise<JudgeResult>;
}

// Per-claim verification outcome combining the deterministic checks (does the
// claim have a citation that resolves to a real span) with the judge's entailment
// decision.
export interface ClaimVerification {
  claim: string;
  // The claim has at least one citation that names a retrieved chunk and whose
  // quote resolved to a span. Without this there is nothing to judge.
  deterministicOk: boolean;
  // The judge's verdict, present only when there was resolvable evidence to judge.
  judge?: JudgeVerdict;
  // Final per-claim result: resolvable evidence that the judge says entails it.
  verified: boolean;
}

export interface VerificationResult {
  // "supported" only if every claim is verified and the deterministic citation
  // pre-check passed; otherwise "unsupported".
  verdict: "supported" | "unsupported";
  claims: ClaimVerification[];
  // The judge id used, or null if no claim needed judging.
  verifierId: string | null;
  // Total estimated cost of the judge calls made during verification.
  costUsd: number;
}
