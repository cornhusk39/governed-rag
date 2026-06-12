import { describe, expect, it } from "vitest";

import { reciprocalRankFusion } from "./rrf.js";

describe("reciprocalRankFusion", () => {
  it("ranks an item that appears high in both lists above single-list items", () => {
    // Item 1 is top of the vector list, item 2 is top of the keyword list, and
    // item 3 appears in both. With agreement across lists, 3 should win.
    const fused = reciprocalRankFusion([
      { ids: [1, 3, 4] },
      { ids: [2, 3, 5] },
    ]);
    expect(fused[0]!.id).toBe(3);
  });

  it("records the per-list rank of each item for explainability", () => {
    const fused = reciprocalRankFusion([
      { ids: [10, 20] },
      { ids: [20, 30] },
    ]);
    const item20 = fused.find((f) => f.id === 20)!;
    // Rank 2 in the first list, rank 1 in the second.
    expect(item20.ranks).toEqual([2, 1]);
    const item30 = fused.find((f) => f.id === 30)!;
    // Item 30 only appears in the second list, at rank 2.
    expect(item30.ranks).toEqual([undefined, 2]);
  });

  it("uses the k constant: larger k flattens the advantage of top ranks", () => {
    const small = reciprocalRankFusion([{ ids: [1, 2] }], 1);
    const large = reciprocalRankFusion([{ ids: [1, 2] }], 1000);
    const gapSmall = small[0]!.score - small[1]!.score;
    const gapLarge = large[0]!.score - large[1]!.score;
    expect(gapSmall).toBeGreaterThan(gapLarge);
  });

  it("breaks ties deterministically by lower id", () => {
    const fused = reciprocalRankFusion([{ ids: [5] }, { ids: [3] }]);
    // Both have identical scores (rank 1 in one list); lower id comes first.
    expect(fused.map((f) => f.id)).toEqual([3, 5]);
  });
});
