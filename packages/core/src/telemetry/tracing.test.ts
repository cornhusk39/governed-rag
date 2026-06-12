import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FakeEmbedder } from "../embedding/fake.js";
import { ScriptedGenerator } from "../generation/scripted.js";
import type { GenerationInput } from "../generation/types.js";
import { ingestFiling } from "../ingest/pipeline.js";
import { answerQuery } from "../pipeline/answer.js";
import { HybridRetriever } from "../retrieval/retriever.js";
import { AuditLog } from "../store/audit.js";
import { openDatabase } from "../store/db.js";
import { Repository } from "../store/repository.js";
import { loadFixtureFilings } from "../test-support/fixtures.js";
import { ScriptedVerifier } from "../verification/scripted.js";

const DIMENSIONS = 256;
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

function spanNames(): string[] {
  return exporter.getFinishedSpans().map((s) => s.name);
}
function spanByName(name: string): ReadableSpan | undefined {
  return exporter.getFinishedSpans().find((s) => s.name === name);
}

describe("pipeline OTel instrumentation", () => {
  let repository: Repository;
  let retriever: HybridRetriever;

  beforeAll(async () => {
    // Register an in-memory tracer so the no-op API becomes a real provider.
    trace.setGlobalTracerProvider(provider);

    const embedder = new FakeEmbedder({ dimensions: DIMENSIONS });
    const db = openDatabase({ path: ":memory:", dimensions: DIMENSIONS });
    repository = new Repository(db);
    for (const fixture of loadFixtureFilings()) {
      await ingestFiling(
        { html: fixture.html, meta: fixture.meta },
        { embedder, repository, now: () => "2026-06-11T00:00:00.000Z" },
      );
    }
    retriever = new HybridRetriever({ repository, embedder });
  });

  afterAll(async () => {
    await provider.shutdown();
  });

  it("emits an ingest span with chunk and redaction attributes", () => {
    const ingest = spanByName("rag.ingest");
    expect(ingest).toBeDefined();
    expect(ingest!.attributes["rag.ingest.chunk_count"]).toBeGreaterThan(0);
    expect(ingest!.attributes["rag.filing.form"]).toBeDefined();
  });

  it("emits a query trace with retrieve/generate/verify child spans and GenAI attrs", async () => {
    exporter.reset();
    const db2 = openDatabase({ path: ":memory:", dimensions: DIMENSIONS });
    const audit = new AuditLog(db2);

    const generator = new ScriptedGenerator({
      respond: (input: GenerationInput) => {
        const top = input.chunks[0]!;
        const quote = top.text.slice(0, 24).trim();
        return {
          answer: "Grounded answer.",
          claims: [{ text: `Regarding: ${quote}`, chunk_ids: [top.chunkId], quote }],
        };
      },
    });

    await answerQuery("net sales for the quarter", {
      retriever,
      generator,
      verifier: new ScriptedVerifier(),
      auditLog: audit,
      now: () => "2026-06-12T00:00:00Z",
      requestId: () => "otel-1",
    });

    const names = spanNames();
    expect(names).toContain("rag.query");
    expect(names).toContain("rag.retrieve");
    expect(names).toContain("gen_ai.generate");
    expect(names).toContain("gen_ai.verify");

    const query = spanByName("rag.query")!;
    expect(query.attributes["rag.verdict"]).toBe("answered");

    const generate = spanByName("gen_ai.generate")!;
    expect(generate.attributes["gen_ai.operation.name"]).toBe("generate");
    expect(generate.attributes["gen_ai.request.model"]).toBe("scripted-generator");
  });
});
