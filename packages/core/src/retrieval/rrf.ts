// Reciprocal rank fusion.
//
// RRF combines several ranked lists into one without needing the lists to share
// a score scale. Each item gets 1 / (k + rank) from every list it appears in,
// summed across lists. It is simple, robust, and the standard way to blend a
// vector ranking with a keyword ranking when their scores are not comparable
// (cosine distance vs BM25). The k constant dampens how much the very top ranks
// dominate; 60 is the value from the original paper.

export interface RankedList {
  // Item ids in rank order, best first. Ranks are derived from array position.
  ids: number[];
}

export interface FusedScore {
  id: number;
  score: number;
  // 1-based rank of this id within each input list, by list index. Absent if the
  // id did not appear in that list. Kept for explainability in the audit trail.
  ranks: Array<number | undefined>;
}

/**
 * Fuse ranked lists into a single ranking. Returns items sorted by fused score,
 * highest first. Ties break by lower id for determinism.
 */
export function reciprocalRankFusion(lists: RankedList[], k = 60): FusedScore[] {
  const scores = new Map<number, number>();
  const ranksById = new Map<number, Array<number | undefined>>();

  for (let listIndex = 0; listIndex < lists.length; listIndex++) {
    const { ids } = lists[listIndex]!;
    for (let position = 0; position < ids.length; position++) {
      const id = ids[position]!;
      const rank = position + 1;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));

      let ranks = ranksById.get(id);
      if (!ranks) {
        ranks = new Array<number | undefined>(lists.length).fill(undefined);
        ranksById.set(id, ranks);
      }
      ranks[listIndex] = rank;
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score, ranks: ranksById.get(id)! }))
    .sort((a, b) => b.score - a.score || a.id - b.id);
}
