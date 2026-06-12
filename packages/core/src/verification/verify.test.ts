import { describe, expect, it } from "vitest";

import type { AnsweredClaim, ResolvedGeneration } from "../generation/citations.js";
import type { Provenance } from "../types.js";

import { ScriptedVerifier } from "./scripted.js";
import { verifyGeneration } from "./verify.js";

const provenance: Provenance = {
  cik: "0001999001",
  accession: "0001999001-26-000007",
  company: "Contoso Robotics Inc.",
  form: "10-Q",
  filingDate: "2026-05-01",
  sectionId: "part-i-item-2",
  sectionLabel: "Part I, Item 2: MD&A",
  startOffset: 100,
  endOffset: 200,
};

// A claim with a fully resolved citation (chunk found, quote found, span present).
function resolvedClaim(text: string, quote: string): AnsweredClaim {
  return {
    text,
    citations: [
      {
        chunkId: "c1",
        chunkFound: true,
        quote,
        quoteFound: true,
        span: { startOffset: 110, endOffset: 110 + quote.length },
        provenance,
      },
    ],
    supported: true,
  };
}

function generation(claims: AnsweredClaim[], precheck = true): ResolvedGeneration {
  return { answer: "answer", claims, citationPrecheckPassed: precheck, unknownChunkIds: [] };
}

describe("verifyGeneration", () => {
  it("returns supported when every claim's evidence entails it", async () => {
    const verifier = new ScriptedVerifier(); // default heuristic: shared keyword
    const result = await verifyGeneration(
      generation([resolvedClaim("Net sales increased.", "net sales increased 22%")]),
      verifier,
    );
    expect(result.verdict).toBe("supported");
    expect(result.claims[0]!.verified).toBe(true);
    expect(result.verifierId).toBe("scripted-verifier");
  });

  it("returns unsupported when the judge rejects a claim", async () => {
    const verifier = new ScriptedVerifier({
      judge: () => ({ entailed: false, confidence: 0.1, rationale: "no" }),
    });
    const result = await verifyGeneration(
      generation([resolvedClaim("Net sales fell.", "net sales rose")]),
      verifier,
    );
    expect(result.verdict).toBe("unsupported");
    expect(result.claims[0]!.verified).toBe(false);
  });

  it("returns unsupported (and skips the judge) when a claim has no resolvable evidence", async () => {
    const unresolved: AnsweredClaim = {
      text: "uncited",
      citations: [{ chunkId: "missing", chunkFound: false, quote: "x", quoteFound: false }],
      supported: false,
    };
    const verifier = new ScriptedVerifier();
    const result = await verifyGeneration(generation([unresolved], false), verifier);
    expect(result.verdict).toBe("unsupported");
    expect(result.claims[0]!.deterministicOk).toBe(false);
    expect(result.claims[0]!.judge).toBeUndefined();
    // No claim was judgeable, so no verifier id is recorded.
    expect(result.verifierId).toBeNull();
  });

  it("treats an answer with no claims as unsupported", async () => {
    const result = await verifyGeneration(generation([]), new ScriptedVerifier());
    expect(result.verdict).toBe("unsupported");
  });

  it("is unsupported if the deterministic pre-check failed even when the judge approves", async () => {
    const result = await verifyGeneration(
      generation([resolvedClaim("Net sales rose.", "net sales rose")], false),
      new ScriptedVerifier(),
    );
    expect(result.verdict).toBe("unsupported");
  });
});
