import { describe, expect, it } from "vitest";

import { FakeEmbedder } from "./fake.js";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}

describe("FakeEmbedder", () => {
  const embedder = new FakeEmbedder({ dimensions: 128 });

  it("is deterministic across calls", async () => {
    const [a] = await embedder.embed(["the company reported strong revenue growth"]);
    const [b] = await embedder.embed(["the company reported strong revenue growth"]);
    expect(a).toEqual(b);
  });

  it("produces unit-length vectors of the configured dimension", async () => {
    const [v] = await embedder.embed(["risk factors and market risk"]);
    expect(v).toHaveLength(128);
    expect(cosine(v!, v!)).toBeCloseTo(1, 5);
  });

  it("places texts that share vocabulary closer than unrelated ones", async () => {
    const [revenue, revenueSimilar, unrelated] = await embedder.embed([
      "net revenue increased on strong demand",
      "revenue increased on strong demand for products",
      "the board approved a new governance committee charter",
    ]);
    const near = cosine(revenue!, revenueSimilar!);
    const far = cosine(revenue!, unrelated!);
    expect(near).toBeGreaterThan(far);
  });

  it("exposes a stable provider id for the audit trail", () => {
    expect(embedder.id).toBe("fake-hash-v1:128");
  });
});
