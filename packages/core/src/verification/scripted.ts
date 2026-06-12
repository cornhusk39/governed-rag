// A scripted groundedness judge for tests and offline use.
//
// By default it approves a claim only when the evidence quote is non-empty and
// actually appears (case-insensitively) to relate to the claim by sharing a
// keyword. That makes it a useful, deterministic stand-in: tests can feed it
// genuinely-supported and genuinely-unsupported pairs and get sensible verdicts
// without a model. A caller can override with any custom function.

import type { JudgeVerdict } from "./schema.js";
import type { JudgeInput, JudgeResult, Verifier } from "./types.js";

export type ScriptedJudge = (input: JudgeInput) => JudgeVerdict;

// Default heuristic: entailed if the evidence shares a meaningful word with the
// claim. Crude on purpose; it exists to make the pipeline testable, not to be a
// real entailment model.
function defaultJudge(input: JudgeInput): JudgeVerdict {
  const claimWords = new Set(
    (input.claim.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []),
  );
  const quoteWords = new Set(
    (input.quote.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []),
  );
  let shared = 0;
  for (const w of quoteWords) {
    if (claimWords.has(w)) {
      shared++;
    }
  }
  const entailed = shared > 0;
  return {
    entailed,
    confidence: entailed ? 0.9 : 0.1,
    rationale: entailed
      ? "Evidence shares supporting terms with the claim."
      : "Evidence does not appear to support the claim.",
  };
}

export interface ScriptedVerifierOptions {
  judge?: ScriptedJudge;
  id?: string;
}

export class ScriptedVerifier implements Verifier {
  readonly id: string;
  private readonly judgeFn: ScriptedJudge;

  constructor(options: ScriptedVerifierOptions = {}) {
    this.id = options.id ?? "scripted-verifier";
    this.judgeFn = options.judge ?? defaultJudge;
  }

  async judge(input: JudgeInput): Promise<JudgeResult> {
    // Scripted judging is free, keeping eval and demo output deterministic.
    return { verdict: this.judgeFn(input), costUsd: 0 };
  }
}
