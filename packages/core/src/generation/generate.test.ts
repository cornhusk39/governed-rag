import { beforeAll, describe, expect, it } from "vitest";

import { FakeEmbedder } from "../embedding/fake.js";
import { ingestFiling } from "../ingest/pipeline.js";
import { HybridRetriever } from "../retrieval/retriever.js";
import type { RetrievedChunk } from "../retrieval/types.js";
import { openDatabase } from "../store/db.js";
import { Repository } from "../store/repository.js";
import { loadFixtureFilings } from "../test-support/fixtures.js";

import { generateAnswer } from "./generate.js";
import { ScriptedGenerator } from "./scripted.js";

const DIMENSIONS = 256;

// End to end with a scripted generator: real ingest, real retrieval, real
// citation resolution, scripted model. No network, no key.
describe("generateAnswer over the fixture corpus", () => {
  let repository: Repository;
  let retriever: HybridRetriever;
  let embedder: FakeEmbedder;

  beforeAll(async () => {
    embedder = new FakeEmbedder({ dimensions: DIMENSIONS });
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

  async function retrieve(query: string): Promise<RetrievedChunk[]> {
    return retriever.retrieve(query, { topK: 5 });
  }

  it("resolves a grounded scripted answer to a real character span", async () => {
    const chunks = await retrieve("net sales for the quarter");
    const top = chunks[0]!;
    // Quote a clean verbatim slice from the top chunk.
    const quote = top.text.slice(0, 24).trim();

    const generator = new ScriptedGenerator({
      respond: {
        answer: "Net sales increased.",
        claims: [{ text: "Net sales increased.", chunk_ids: [top.chunkId], quote }],
      },
    });

    const { resolved, model } = await generateAnswer(
      { query: "net sales for the quarter", chunks },
      generator,
    );

    expect(model).toBe("scripted-generator");
    expect(resolved.citationPrecheckPassed).toBe(true);
    const citation = resolved.claims[0]!.citations[0]!;
    expect(citation.quoteFound).toBe(true);
    expect(citation.span).toBeDefined();

    // The resolved span must slice the filing's canonical text back to the quote.
    const canonical = repository.getCanonicalText(top.provenance.accession)!;
    const sliced = canonical.slice(citation.span!.startOffset, citation.span!.endOffset);
    expect(sliced).toBe(quote);
  });

  it("flags a fabricated citation that names an unretrieved chunk", async () => {
    const chunks = await retrieve("risk factors");
    const generator = new ScriptedGenerator({
      respond: {
        answer: "Fabricated answer.",
        claims: [{ text: "made up", chunk_ids: ["not-a-real-chunk:0-1"], quote: "nope" }],
      },
    });

    const { resolved } = await generateAnswer({ query: "risk factors", chunks }, generator);
    expect(resolved.citationPrecheckPassed).toBe(false);
    expect(resolved.unknownChunkIds).toContain("not-a-real-chunk:0-1");
  });
});
