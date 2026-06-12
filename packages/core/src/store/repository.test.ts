import { describe, expect, it, beforeEach } from "vitest";

import { FakeEmbedder } from "../embedding/fake.js";
import type { Chunk, FilingMeta } from "../types.js";

import { openDatabase } from "./db.js";
import { Repository } from "./repository.js";
import type { DatabaseHandle } from "./types.js";

const DIMENSIONS = 64;
const embedder = new FakeEmbedder({ dimensions: DIMENSIONS });

const meta: FilingMeta = {
  cik: "0001999001",
  accession: "0001999001-26-000007",
  company: "Contoso Robotics Inc.",
  form: "10-Q",
  filingDate: "2026-05-01",
};

const canonicalText =
  "Item 2. Net sales rose on strong demand. Risk factors include supply concentration.";

function buildChunk(id: string, text: string, start: number, end: number): Chunk {
  return {
    id,
    text,
    provenance: {
      cik: meta.cik,
      accession: meta.accession,
      company: meta.company,
      form: meta.form,
      filingDate: meta.filingDate,
      sectionId: "part-i-item-2",
      sectionLabel: "Part I, Item 2: MD&A",
      startOffset: start,
      endOffset: end,
    },
  };
}

async function insertSampleFiling(repo: Repository): Promise<void> {
  const chunks = [
    buildChunk(`${meta.accession}:0-41`, "Item 2. Net sales rose on strong demand.", 0, 41),
    buildChunk(
      `${meta.accession}:42-83`,
      "Risk factors include supply concentration.",
      42,
      83,
    ),
  ];
  const embeddings = await embedder.embed(chunks.map((c) => c.text));
  repo.insertFiling({
    meta,
    canonicalText,
    chunks,
    embeddings,
    embedderId: embedder.id,
    ingestedAt: "2026-06-11T00:00:00.000Z",
  });
}

describe("Repository", () => {
  let db: DatabaseHandle;
  let repo: Repository;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:", dimensions: DIMENSIONS });
    repo = new Repository(db);
  });

  it("persists a filing and its chunks", async () => {
    await insertSampleFiling(repo);
    expect(repo.countFilings()).toBe(1);
    expect(repo.countChunks()).toBe(2);
    expect(repo.getCanonicalText(meta.accession)).toBe(canonicalText);
  });

  it("returns chunks ordered by offset", async () => {
    await insertSampleFiling(repo);
    const chunks = repo.getChunksByFiling(meta.accession);
    expect(chunks.map((c) => c.startOffset)).toEqual([0, 42]);
  });

  it("populates the vector index so nearest-neighbor search works", async () => {
    await insertSampleFiling(repo);
    const [query] = await embedder.embed(["net sales demand"]);
    const rows = db
      .prepare(
        "select rowid, distance from vec_chunk where embedding match ? order by distance limit 1",
      )
      .all(new Float32Array(query!)) as Array<{ rowid: number; distance: number }>;
    // The nearest chunk should be the "Net sales" one, which is chunk rowid 1.
    expect(rows[0]?.rowid).toBe(1);
  });

  it("populates the keyword index so FTS search works", async () => {
    await insertSampleFiling(repo);
    const rows = db
      .prepare("select rowid from fts_chunk where fts_chunk match ?")
      .all("supply") as Array<{ rowid: number }>;
    expect(rows.map((r) => r.rowid)).toContain(2);
  });

  it("re-ingesting the same accession is idempotent across all indexes", async () => {
    await insertSampleFiling(repo);
    await insertSampleFiling(repo);
    expect(repo.countFilings()).toBe(1);
    expect(repo.countChunks()).toBe(2);
    const vecCount = (
      db.prepare("select count(*) as n from vec_chunk").get() as { n: number }
    ).n;
    const ftsCount = (
      db.prepare("select count(*) as n from fts_chunk").get() as { n: number }
    ).n;
    expect(vecCount).toBe(2);
    expect(ftsCount).toBe(2);
  });
});
