import { describe, expect, it } from "vitest";

import { loadFixtureFiling } from "../test-support/fixtures.js";

import { extractText } from "./extract.js";

describe("extractText", () => {
  const { html } = loadFixtureFiling("contoso-10q.htm");
  const text = extractText(html);

  it("drops script and style content entirely", () => {
    expect(text).not.toContain("this should never appear");
    expect(text).not.toContain("display:none");
  });

  it("strips all HTML tags", () => {
    expect(text).not.toMatch(/<[^>]+>/);
  });

  it("decodes named and numeric entities", () => {
    // &#8217; is a curly apostrophe; &amp; and &nbsp; should also be resolved.
    expect(text).toContain("Management’s Discussion");
    expect(text).not.toContain("&#8217;");
    expect(text).not.toContain("&nbsp;");
  });

  it("keeps Item headings on their own lines so sectioning can find them", () => {
    expect(text).toMatch(/\nItem 2\. Management’s Discussion/);
  });

  it("is deterministic", () => {
    expect(extractText(html)).toBe(text);
  });

  it("does not crash on malformed or out-of-range numeric entities", () => {
    // String.fromCodePoint throws above 0x10FFFF; real filings carry junk like
    // this, and it must not abort ingest. Out-of-range refs are left as text.
    const malformed = "<p>before &#9999999999; and &#x110000; after</p>";
    expect(() => extractText(malformed)).not.toThrow();
    const out = extractText(malformed);
    expect(out).toContain("before");
    expect(out).toContain("after");
  });
});
