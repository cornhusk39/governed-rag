import { describe, expect, it } from "vitest";

import { loadFixtureFiling } from "../test-support/fixtures.js";
import type { FilingMeta } from "../types.js";

import { chunkFiling } from "./chunk.js";
import { extractText } from "./extract.js";
import { detectSections } from "./sections.js";

describe("chunkFiling", () => {
  const fixture = loadFixtureFiling("contoso-10q.htm");
  const meta: FilingMeta = fixture.meta;
  const text = extractText(fixture.html);
  const sections = detectSections(text);
  const chunks = chunkFiling(text, sections, meta, {
    maxChars: 600,
    minChars: 200,
    overlapChars: 100,
  });

  it("produces chunks", () => {
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("records offsets that slice the canonical text back to the chunk text", () => {
    for (const chunk of chunks) {
      const slice = text.slice(chunk.provenance.startOffset, chunk.provenance.endOffset);
      expect(slice).toBe(chunk.text);
    }
  });

  it("never lets a chunk cross a section boundary", () => {
    const byId = new Map(sections.map((s) => [s.id, s]));
    for (const chunk of chunks) {
      const section = byId.get(chunk.provenance.sectionId)!;
      expect(chunk.provenance.startOffset).toBeGreaterThanOrEqual(section.startOffset);
      expect(chunk.provenance.endOffset).toBeLessThanOrEqual(section.endOffset);
    }
  });

  it("splits a long section (MD&A) into more than one chunk with overlap", () => {
    const mdnaChunks = chunks
      .filter((c) => c.provenance.sectionId === "part-i-item-2")
      .sort((a, b) => a.provenance.startOffset - b.provenance.startOffset);
    expect(mdnaChunks.length).toBeGreaterThan(1);
    // Consecutive chunks overlap: the next starts before the previous ends.
    for (let i = 1; i < mdnaChunks.length; i++) {
      expect(mdnaChunks[i]!.provenance.startOffset).toBeLessThan(
        mdnaChunks[i - 1]!.provenance.endOffset,
      );
    }
  });

  it("rejects a configuration where overlap is not smaller than the window", () => {
    // overlapChars >= minChars would degenerate to one-char steps; reject it.
    expect(() =>
      chunkFiling(text, sections, meta, { maxChars: 100, minChars: 50, overlapChars: 200 }),
    ).toThrow(/overlapChars/);
    expect(() =>
      chunkFiling(text, sections, meta, { maxChars: 50, minChars: 100, overlapChars: 10 }),
    ).toThrow(/minChars/);
  });

  it("carries full provenance on every chunk", () => {
    for (const chunk of chunks) {
      expect(chunk.provenance.accession).toBe(meta.accession);
      expect(chunk.provenance.company).toBe(meta.company);
      expect(chunk.id).toContain(meta.accession);
    }
  });
});
