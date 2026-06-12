import { beforeEach, describe, expect, it } from "vitest";

import { FakeEmbedder } from "../embedding/fake.js";
import { ScriptedGenerator } from "../generation/scripted.js";
import type { GenerationInput } from "../generation/types.js";
import { ingestFiling } from "../ingest/pipeline.js";
import { HybridRetriever } from "../retrieval/retriever.js";
import { openDatabase } from "../store/db.js";
import { AuditLog } from "../store/audit.js";
import { Repository } from "../store/repository.js";
import { loadFixtureFilings } from "../test-support/fixtures.js";
import { ScriptedVerifier } from "../verification/scripted.js";

import { answerQuery, type AnswerDeps } from "./answer.js";
import { REFUSAL_MESSAGE } from "./refusal.js";

const DIMENSIONS = 256;

// A scripted generator that grounds its single claim in the top retrieved chunk,
// quoting a verbatim slice so the citation resolves. This stands in for a
// well-behaved model.
function groundedGenerator() {
  return new ScriptedGenerator({
    respond: (input: GenerationInput) => {
      const top = input.chunks[0]!;
      const quote = top.text.slice(0, 30).trim();
      return {
        answer: "Here is a grounded answer.",
        claims: [{ text: `Regarding the corpus: ${quote}`, chunk_ids: [top.chunkId], quote }],
      };
    },
  });
}

describe("answerQuery (governed pipeline)", () => {
  let repository: Repository;
  let auditLog: AuditLog;
  let retriever: HybridRetriever;
  let counter: number;

  beforeEach(async () => {
    const embedder = new FakeEmbedder({ dimensions: DIMENSIONS });
    const db = openDatabase({ path: ":memory:", dimensions: DIMENSIONS });
    repository = new Repository(db);
    auditLog = new AuditLog(db);
    for (const fixture of loadFixtureFilings()) {
      await ingestFiling(
        { html: fixture.html, meta: fixture.meta },
        { embedder, repository, now: () => "2026-06-11T00:00:00.000Z" },
      );
    }
    retriever = new HybridRetriever({ repository, embedder });
    counter = 0;
  });

  function deps(overrides: Partial<AnswerDeps> = {}): AnswerDeps {
    counter += 1;
    return {
      retriever,
      generator: groundedGenerator(),
      verifier: new ScriptedVerifier(),
      auditLog,
      now: () => "2026-06-12T10:00:00.000Z",
      requestId: () => `req-${counter}`,
      ...overrides,
    };
  }

  it("answers an in-corpus query and writes an answered audit row with full lineage", async () => {
    const result = await answerQuery("net sales for the quarter", deps());

    expect(result.verdict).toBe("answered");
    expect(result.message).toBe("Here is a grounded answer.");
    expect(result.verification?.verdict).toBe("supported");

    const row = auditLog.getByRequestId(result.requestId)!;
    expect(row.verdict).toBe("answered");
    expect(row.answer).toBe("Here is a grounded answer.");
    expect(row.generationModel).toBe("scripted-generator");
    expect(row.verifierId).toBe("scripted-verifier");
    expect(row.embedderId).toBe("fake-hash-v1:256");
    expect(Array.isArray(row.retrieved)).toBe(true);
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("refuses an out-of-corpus query before generating, and audits the refusal", async () => {
    const result = await answerQuery("photosynthesis chlorophyll mitochondria xylophone", deps());

    expect(result.verdict).toBe("refused");
    expect(result.refusalReason).toBe("low_retrieval_score");
    expect(result.message).toBe(REFUSAL_MESSAGE);
    // No generation happened.
    expect(result.model).toBeUndefined();

    const row = auditLog.getByRequestId(result.requestId)!;
    expect(row.verdict).toBe("refused");
    expect(row.refusalReason).toBe("low_retrieval_score");
    expect(row.answer).toBeNull();
    expect(row.generationModel).toBeNull();
  });

  it("refuses when the model fabricates a citation to an unretrieved chunk", async () => {
    const fabricator = new ScriptedGenerator({
      respond: {
        answer: "Fabricated.",
        claims: [{ text: "made up", chunk_ids: ["not-real:0-1"], quote: "nope" }],
      },
    });
    const result = await answerQuery("net sales", deps({ generator: fabricator }));

    expect(result.verdict).toBe("refused");
    expect(result.refusalReason).toBe("citation_precheck_failed");
    expect(auditLog.getByRequestId(result.requestId)!.refusalReason).toBe(
      "citation_precheck_failed",
    );
  });

  it("refuses when the verifier does not confirm the claims", async () => {
    const skeptic = new ScriptedVerifier({
      judge: () => ({ entailed: false, confidence: 0.1, rationale: "not supported" }),
    });
    const result = await answerQuery("net sales for the quarter", deps({ verifier: skeptic }));

    expect(result.verdict).toBe("refused");
    expect(result.refusalReason).toBe("unverified_claims");
    // The verification result is still recorded for the audit trail.
    expect(result.verification?.verdict).toBe("unsupported");
  });

  it("refuses when the model abstains with no claims", async () => {
    const abstainer = new ScriptedGenerator({
      respond: { answer: "I cannot answer from the corpus.", claims: [] },
    });
    const result = await answerQuery("net sales", deps({ generator: abstainer }));
    expect(result.verdict).toBe("refused");
    expect(result.refusalReason).toBe("no_claims");
  });

  it("redacts PII in the query before writing it to the audit log", async () => {
    // The query is answer-time user input; a question carrying PII must not land
    // unredacted in the trail. Retrieval still uses the raw query.
    const result = await answerQuery(
      "net sales for the quarter, contact me at jane.roe@example.com",
      deps(),
    );
    const row = auditLog.getByRequestId(result.requestId)!;
    expect(row.query).not.toContain("jane.roe@example.com");
    expect(row.query).toContain("[REDACTED:email]");
  });

  it("writes exactly one audit row per query", async () => {
    await answerQuery("net sales for the quarter", deps());
    await answerQuery("risk factors actuators", deps());
    expect(auditLog.count()).toBe(2);
  });
});
