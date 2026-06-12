import { describe, expect, it } from "vitest";

import { FakeEmbedder } from "../embedding/fake.js";
import { openDatabase } from "../store/db.js";
import { Repository } from "../store/repository.js";
import { loadFixtureFilings } from "../test-support/fixtures.js";

import { ingestFiling } from "./pipeline.js";

const DIMENSIONS = 128;

function newPipeline() {
  const embedder = new FakeEmbedder({ dimensions: DIMENSIONS });
  const db = openDatabase({ path: ":memory:", dimensions: DIMENSIONS });
  const repository = new Repository(db);
  return { embedder, db, repository };
}

describe("ingestFiling end to end on fixture filings", () => {
  it("ingests both fixtures into the index", async () => {
    const { embedder, repository } = newPipeline();
    const fixtures = loadFixtureFilings();

    for (const fixture of fixtures) {
      const result = await ingestFiling(
        { html: fixture.html, meta: fixture.meta },
        { embedder, repository, now: () => "2026-06-11T00:00:00.000Z" },
      );
      expect(result.sectionCount).toBeGreaterThan(0);
      expect(result.chunkCount).toBeGreaterThan(0);
    }

    expect(repository.countFilings()).toBe(fixtures.length);
    expect(repository.countChunks()).toBeGreaterThan(fixtures.length);
  });

  it("stores chunks whose offsets slice the canonical text exactly", async () => {
    const { embedder, repository } = newPipeline();
    const [fixture] = loadFixtureFilings();

    await ingestFiling(
      { html: fixture!.html, meta: fixture!.meta },
      { embedder, repository, now: () => "2026-06-11T00:00:00.000Z" },
    );

    const canonical = repository.getCanonicalText(fixture!.meta.accession)!;
    const chunks = repository.getChunksByFiling(fixture!.meta.accession);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(canonical.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
    }
  });

  it("redacts PII before storage: raw values never land in the index", async () => {
    const { embedder, repository } = newPipeline();
    // The Contoso 10-Q embeds synthetic PII in its MD&A and risk factors.
    const contoso = loadFixtureFilings().find((f) => f.file === "contoso-10q.htm")!;

    const result = await ingestFiling(
      { html: contoso.html, meta: contoso.meta },
      { embedder, repository, now: () => "2026-06-11T00:00:00.000Z" },
    );

    // Redaction happened and was reported.
    expect(result.redactionHits.length).toBeGreaterThan(0);

    const canonical = repository.getCanonicalText(contoso.meta.accession)!;
    // None of the synthetic raw values survive anywhere in stored text.
    expect(canonical).not.toContain("jane.roe@contoso-robotics.example");
    expect(canonical).not.toContain("078-05-1120");
    expect(canonical).not.toContain("1234567890123");
    expect(canonical).not.toContain("(425) 555-0143");
    // The placeholders are present instead.
    expect(canonical).toContain("[REDACTED:email]");
    expect(canonical).toContain("[REDACTED:ssn]");

    const chunks = repository.getChunksByFiling(contoso.meta.accession);
    const allChunkText = chunks.map((c) => c.text).join("\n");
    expect(allChunkText).not.toContain("jane.roe@contoso-robotics.example");
  });

  it("is idempotent: re-ingesting a filing does not duplicate it", async () => {
    const { embedder, repository } = newPipeline();
    const [fixture] = loadFixtureFilings();
    const deps = { embedder, repository, now: () => "2026-06-11T00:00:00.000Z" };

    const first = await ingestFiling({ html: fixture!.html, meta: fixture!.meta }, deps);
    const second = await ingestFiling({ html: fixture!.html, meta: fixture!.meta }, deps);

    expect(repository.countFilings()).toBe(1);
    expect(second.chunkCount).toBe(first.chunkCount);
  });
});
