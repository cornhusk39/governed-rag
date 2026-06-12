import { describe, expect, it } from "vitest";

import { rawGenerationSchema } from "./schema.js";

describe("rawGenerationSchema", () => {
  it("accepts a well-formed claims-with-citations answer", () => {
    const parsed = rawGenerationSchema.parse({
      answer: "Net sales rose.",
      claims: [{ text: "Net sales rose 22%.", chunk_ids: ["c1"], quote: "rose 22%" }],
    });
    expect(parsed.claims).toHaveLength(1);
  });

  it("rejects a free-text answer with no claims structure", () => {
    // A bare string answer is exactly what governance forbids.
    expect(() => rawGenerationSchema.parse("Net sales rose 22%.")).toThrow();
    expect(() => rawGenerationSchema.parse({ answer: "Net sales rose." })).toThrow();
  });

  it("rejects a claim missing its citation fields", () => {
    expect(() =>
      rawGenerationSchema.parse({
        answer: "x",
        claims: [{ text: "uncited claim" }],
      }),
    ).toThrow();
  });

  it("allows an empty claims array (the abstain case)", () => {
    const parsed = rawGenerationSchema.parse({ answer: "Not supported by the corpus.", claims: [] });
    expect(parsed.claims).toHaveLength(0);
  });
});
