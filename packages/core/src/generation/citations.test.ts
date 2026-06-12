import { describe, expect, it } from "vitest";

import type { RetrievedChunk } from "../retrieval/types.js";

import { resolveCitations } from "./citations.js";

// A chunk whose text sits at a known offset in the (hypothetical) canonical text,
// so we can assert that resolved spans are absolute, not chunk-relative.
function chunkAt(id: string, text: string, startOffset: number): RetrievedChunk {
  return {
    rowid: 1,
    chunkId: id,
    text,
    provenance: {
      cik: "0001999001",
      accession: "0001999001-26-000007",
      company: "Contoso Robotics Inc.",
      form: "10-Q",
      filingDate: "2026-05-01",
      sectionId: "part-i-item-2",
      sectionLabel: "Part I, Item 2: MD&A",
      startOffset,
      endOffset: startOffset + text.length,
    },
    scores: { rrf: 0.5 },
  };
}

describe("resolveCitations", () => {
  const chunk = chunkAt("c1", "Net sales rose 22% year over year on strong demand.", 100);

  it("resolves a verbatim quote to an absolute character span", () => {
    const resolved = resolveCitations(
      {
        answer: "Net sales rose.",
        claims: [{ text: "Net sales rose 22%.", chunk_ids: ["c1"], quote: "rose 22%" }],
      },
      [chunk],
    );

    const citation = resolved.claims[0]!.citations[0]!;
    expect(citation.chunkFound).toBe(true);
    expect(citation.quoteFound).toBe(true);
    // "rose 22%" starts at index 10 within the chunk, so absolute start is 110.
    expect(citation.span).toEqual({ startOffset: 110, endOffset: 118 });
    expect(resolved.claims[0]!.supported).toBe(true);
    expect(resolved.citationPrecheckPassed).toBe(true);
  });

  it("fails the pre-check when a claim cites a chunk id that was not retrieved", () => {
    const resolved = resolveCitations(
      {
        answer: "Fabricated.",
        claims: [{ text: "made up", chunk_ids: ["does-not-exist"], quote: "whatever" }],
      },
      [chunk],
    );
    expect(resolved.citationPrecheckPassed).toBe(false);
    expect(resolved.unknownChunkIds).toContain("does-not-exist");
    expect(resolved.claims[0]!.supported).toBe(false);
  });

  it("marks a citation unresolved when the quote is not found verbatim", () => {
    const resolved = resolveCitations(
      {
        answer: "x",
        claims: [{ text: "claim", chunk_ids: ["c1"], quote: "this text is not in the chunk" }],
      },
      [chunk],
    );
    const citation = resolved.claims[0]!.citations[0]!;
    expect(citation.chunkFound).toBe(true);
    expect(citation.quoteFound).toBe(false);
    expect(citation.span).toBeUndefined();
    // The chunk id existed, so the deterministic pre-check still passes; it is the
    // verifier's job (M4) to act on an unresolved quote.
    expect(resolved.citationPrecheckPassed).toBe(true);
    expect(resolved.claims[0]!.supported).toBe(false);
  });

  it("tolerates quotes padded with surrounding whitespace", () => {
    const resolved = resolveCitations(
      {
        answer: "x",
        claims: [{ text: "claim", chunk_ids: ["c1"], quote: "  strong demand  " }],
      },
      [chunk],
    );
    expect(resolved.claims[0]!.citations[0]!.quoteFound).toBe(true);
  });
});
