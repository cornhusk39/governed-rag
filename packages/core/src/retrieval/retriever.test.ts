import { beforeAll, describe, expect, it } from "vitest";

import { FakeEmbedder } from "../embedding/fake.js";
import { ingestFiling } from "../ingest/pipeline.js";
import { openDatabase } from "../store/db.js";
import { Repository } from "../store/repository.js";
import { loadFixtureFilings } from "../test-support/fixtures.js";

import { buildFtsQuery, HybridRetriever } from "./retriever.js";

const DIMENSIONS = 256;

// Ingest both fixtures once into a shared in-memory index, then query it.
async function buildRetriever() {
  const embedder = new FakeEmbedder({ dimensions: DIMENSIONS });
  const db = openDatabase({ path: ":memory:", dimensions: DIMENSIONS });
  const repository = new Repository(db);
  for (const fixture of loadFixtureFilings()) {
    await ingestFiling(
      { html: fixture.html, meta: fixture.meta },
      { embedder, repository, now: () => "2026-06-11T00:00:00.000Z" },
    );
  }
  return new HybridRetriever({ repository, embedder });
}

describe("buildFtsQuery", () => {
  it("ORs word tokens and quotes them, dropping punctuation and tiny tokens", () => {
    expect(buildFtsQuery("net sales (rose 22%)")).toBe('"net" OR "sales" OR "rose" OR "22"');
  });

  it("returns an empty string when there are no usable tokens", () => {
    expect(buildFtsQuery("!!! ?")).toBe("");
  });
});

describe("HybridRetriever", () => {
  let retriever: HybridRetriever;

  beforeAll(async () => {
    retriever = await buildRetriever();
  });

  it("retrieves the MD&A section for a revenue-and-products query", async () => {
    const results = await retriever.retrieve(
      "autonomous navigation and machine vision research and development",
    );
    expect(results.length).toBeGreaterThan(0);
    const top = results[0]!;
    expect(top.provenance.company).toBe("Contoso Robotics Inc.");
    expect(top.provenance.sectionId).toBe("part-i-item-2");
  });

  it("retrieves the risk factors section for a supply-concentration query", async () => {
    const results = await retriever.retrieve("specialized actuators supply chain disruption");
    const top = results[0]!;
    expect(top.provenance.sectionId).toBe("part-ii-item-1a");
    expect(top.text.toLowerCase()).toContain("actuators");
  });

  it("uses the keyword signal to find an exact term vector search might blur", async () => {
    // "actuators" is a rare exact term; it should surface the risk factors chunk.
    const results = await retriever.retrieve("actuators");
    const actuatorHit = results.find((r) => r.text.toLowerCase().includes("actuators"));
    expect(actuatorHit).toBeDefined();
    expect(actuatorHit!.scores.keywordRank).toBeDefined();
  });

  it("attaches fusion scores and provenance offsets that stay consistent", async () => {
    const results = await retriever.retrieve("net revenue increased for the year");
    for (const r of results) {
      expect(r.scores.rrf).toBeGreaterThan(0);
      expect(r.provenance.endOffset).toBeGreaterThan(r.provenance.startOffset);
      // At least one of the two signals must have contributed.
      expect(r.scores.vectorRank !== undefined || r.scores.keywordRank !== undefined).toBe(true);
    }
  });

  it("respects topK", async () => {
    const results = await retriever.retrieve("the Company", { topK: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("ranks the relevant section above unrelated ones (hybrid quality)", async () => {
    // "freight network" and "net leverage" appear only in Northwind's MD&A, not
    // in its Business section or anywhere in the Contoso filing, so a targeted
    // query should rank that MD&A chunk first.
    const results = await retriever.retrieve(
      "optimized freight network and reduced net leverage during the year",
    );
    const top = results[0]!;
    expect(top.provenance.company).toBe("Northwind Trading Co.");
    expect(top.provenance.sectionId).toBe("part-ii-item-7");
  });
});
