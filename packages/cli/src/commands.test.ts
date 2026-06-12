import { describe, expect, it } from "vitest";

import {
  AuditLog,
  FakeEmbedder,
  HybridRetriever,
  Repository,
  ScriptedGenerator,
  ScriptedVerifier,
  openDatabase,
  type FilingMeta,
  type GenerationInput,
} from "@governed-rag/core";

import { runExport, runIngest, runQuery } from "./commands.js";

const DIMENSIONS = 256;

const meta: FilingMeta = {
  cik: "0001999003",
  accession: "0001999003-26-000001",
  company: "Widget Works Inc.",
  form: "10-K",
  filingDate: "2026-03-01",
};

const HTML =
  "<html><body><p>Item 1. Business</p>" +
  "<p>Widget Works Inc. sells widgets across many regions and service channels.</p>" +
  "</body></html>";

function newDb() {
  const db = openDatabase({ path: ":memory:", dimensions: DIMENSIONS });
  return { db, repository: new Repository(db), auditLog: new AuditLog(db) };
}

function collector() {
  const lines: string[] = [];
  return { lines, log: (m: string) => lines.push(m) };
}

describe("runIngest", () => {
  it("ingests a filing into the database", async () => {
    const { repository } = newDb();
    const { lines, log } = collector();
    const chunkCount = await runIngest(
      { html: HTML, meta },
      { repository, embedder: new FakeEmbedder({ dimensions: DIMENSIONS }), now: () => "t", log },
    );
    expect(chunkCount).toBeGreaterThan(0);
    expect(repository.countFilings()).toBe(1);
    expect(lines.join("\n")).toContain("Widget Works Inc.");
  });
});

describe("runQuery", () => {
  it("runs the governed pipeline and prints the verdict", async () => {
    const { repository, auditLog } = newDb();
    const embedder = new FakeEmbedder({ dimensions: DIMENSIONS });
    await runIngest({ html: HTML, meta }, { repository, embedder, now: () => "t", log: () => {} });

    const generator = new ScriptedGenerator({
      respond: (input: GenerationInput) => {
        const top = input.chunks[0]!;
        // Quote a phrase that actually appears and shares words with the claim,
        // so the default scripted verifier confirms entailment.
        const quote = "sells widgets across many regions";
        return {
          answer: "The company sells widgets across many regions.",
          claims: [
            {
              text: "The company sells widgets across many regions.",
              chunk_ids: [top.chunkId],
              quote,
            },
          ],
        };
      },
    });
    const retriever = new HybridRetriever({ repository, embedder });
    const { lines, log } = collector();

    const result = await runQuery(
      { query: "widgets across regions and service channels" },
      {
        answerDeps: {
          retriever,
          generator,
          verifier: new ScriptedVerifier(),
          auditLog,
          now: () => "2026-06-12T00:00:00Z",
          requestId: () => "req-cli-1",
        },
        log,
      },
    );

    expect(result.verdict).toBe("answered");
    expect(lines.join("\n")).toContain("verdict: answered");
    // The pipeline wrote an audit row.
    expect(auditLog.getByRequestId("req-cli-1")).toBeDefined();
  });
});

describe("runExport", () => {
  it("writes a snapshot containing the filings and audit records", async () => {
    const { repository, auditLog } = newDb();
    const embedder = new FakeEmbedder({ dimensions: DIMENSIONS });
    await runIngest({ html: HTML, meta }, { repository, embedder, now: () => "t", log: () => {} });

    // Seed one audit record via the pipeline.
    const generator = new ScriptedGenerator({
      respond: (input: GenerationInput) => {
        const top = input.chunks[0]!;
        return {
          answer: "ok",
          claims: [{ text: "ok", chunk_ids: [top.chunkId], quote: top.text.slice(0, 15).trim() }],
        };
      },
    });
    const retriever = new HybridRetriever({ repository, embedder });
    await runQuery(
      { query: "widgets" },
      {
        answerDeps: {
          retriever,
          generator,
          verifier: new ScriptedVerifier(),
          auditLog,
          now: () => "2026-06-12T00:00:00Z",
          requestId: () => "req-cli-2",
        },
        log: () => {},
      },
    );

    let captured = "";
    const count = runExport(
      { outPath: "/tmp/ignored.json" },
      {
        repository,
        auditLog,
        now: () => "2026-06-12T12:00:00Z",
        writeFile: (_path, contents) => {
          captured = contents;
        },
        log: () => {},
      },
    );

    expect(count).toBe(1);
    const snapshot = JSON.parse(captured);
    expect(snapshot.filings).toHaveLength(1);
    expect(snapshot.audit).toHaveLength(1);
    expect(snapshot.canonicalTexts[meta.accession]).toContain("widgets");
    expect(snapshot.generatedAt).toBe("2026-06-12T12:00:00Z");
  });
});
