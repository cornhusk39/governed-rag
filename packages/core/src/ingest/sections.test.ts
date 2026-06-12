import { describe, expect, it } from "vitest";

import { loadFixtureFiling } from "../test-support/fixtures.js";

import { extractText } from "./extract.js";
import { detectSections } from "./sections.js";

describe("detectSections on the 10-Q fixture", () => {
  const { html } = loadFixtureFiling("contoso-10q.htm");
  const text = extractText(html);
  const sections = detectSections(text);

  it("does not emit duplicate sections for table-of-contents entries", () => {
    // The 10-Q lists every item twice (contents, then body). Last-wins should
    // leave exactly one section per (part, item) pair.
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("qualifies items with their part, disambiguating repeated item numbers", () => {
    // Item 1 appears in both Part I (Financial Statements) and Part II (Legal).
    const partI1 = sections.find((s) => s.id === "part-i-item-1");
    const partII1 = sections.find((s) => s.id === "part-ii-item-1");
    expect(partI1?.title).toContain("Financial Statements");
    expect(partII1?.title).toContain("Legal Proceedings");
  });

  it("captures the MD&A section under Part I, Item 2", () => {
    const mdna = sections.find((s) => s.id === "part-i-item-2");
    expect(mdna).toBeDefined();
    expect(mdna?.label).toContain("Management’s Discussion");
  });

  it("produces sections that tile the body without gaps or overlaps", () => {
    for (let i = 1; i < sections.length; i++) {
      // Each section starts exactly where the previous one ended.
      expect(sections[i]!.startOffset).toBe(sections[i - 1]!.endOffset);
    }
  });

  it("slices section text that begins with its own Item heading", () => {
    const mdna = sections.find((s) => s.id === "part-i-item-2")!;
    const slice = text.slice(mdna.startOffset, mdna.endOffset);
    expect(slice.startsWith("Item 2.")).toBe(true);
    expect(slice).toContain("Net sales for the quarter rose");
  });
});

describe("detectSections on the 10-K fixture", () => {
  const { html } = loadFixtureFiling("northwind-10k.htm");
  const sections = detectSections(extractText(html));

  it("recognizes parts beyond II (10-K has Parts I through IV)", () => {
    const item15 = sections.find((s) => s.id === "part-iv-item-15");
    expect(item15?.title).toContain("Exhibit");
  });

  it("finds the core 10-K items", () => {
    const ids = sections.map((s) => s.id);
    expect(ids).toContain("part-i-item-1"); // Business
    expect(ids).toContain("part-i-item-1a"); // Risk Factors
    expect(ids).toContain("part-ii-item-7"); // MD&A
  });
});

describe("detectSections with a table of contents before the first Part marker", () => {
  // Some filings list TOC items with no Part label, then introduce the body with
  // "PART I". The TOC entry must not survive as a second, citable section.
  const text = [
    "TABLE OF CONTENTS",
    "Item 2. Properties 7",
    "PART I",
    "Item 2. Properties",
    "The Company leases distribution centers across many regions and operates them.",
  ].join("\n");

  it("keeps only the real body section, not the table-of-contents entry", () => {
    const sections = detectSections(text);
    const item2 = sections.filter((s) => s.item === "2");
    expect(item2).toHaveLength(1);
    expect(item2[0]!.id).toBe("part-i-item-2");
    // The kept section is the body, which contains real prose.
    expect(text.slice(item2[0]!.startOffset, item2[0]!.endOffset)).toContain("distribution centers");
  });
});
