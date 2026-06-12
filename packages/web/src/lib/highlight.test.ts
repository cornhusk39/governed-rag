import { describe, expect, it } from "vitest";

import { highlightSpan } from "./highlight.js";

const text = "Net sales rose 22% year over year on strong demand in the automation segment.";

describe("highlightSpan", () => {
  it("splits text around the span so the match can be highlighted", () => {
    const result = highlightSpan(text, 0, 33, 1000);
    expect(result.match).toBe("Net sales rose 22% year over year");
    expect(result.before).toBe("");
    expect(result.after.startsWith(" on strong demand")).toBe(true);
  });

  it("trims context to the window and flags truncation", () => {
    const result = highlightSpan(text, 37, 43, 5); // "strong"
    expect(result.match).toBe("strong");
    expect(result.truncatedBefore).toBe(true);
    expect(result.before.length).toBeLessThanOrEqual(5);
    expect(result.truncatedAfter).toBe(true);
  });

  it("clamps out-of-range offsets instead of throwing", () => {
    const result = highlightSpan(text, -10, 9999, 1000);
    expect(result.match).toBe(text);
    expect(result.truncatedBefore).toBe(false);
    expect(result.truncatedAfter).toBe(false);
  });
});
