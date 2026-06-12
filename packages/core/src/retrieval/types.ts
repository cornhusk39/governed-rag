// Types for the retrieval layer. A retrieved chunk carries its provenance (so a
// citation can be built from it directly) and the scores that explain why it was
// retrieved, which later feeds the audit log: governance means being able to say
// not just what was retrieved but how it ranked.

import type { Provenance } from "../types.js";

export interface ChunkScores {
  // 1-based rank in the vector list, if it appeared there.
  vectorRank?: number;
  // Raw vector distance (lower is closer), if it appeared in the vector list.
  vectorDistance?: number;
  // 1-based rank in the keyword list, if it appeared there.
  keywordRank?: number;
  // The fused reciprocal-rank-fusion score that determined final ordering.
  rrf: number;
}

export interface RetrievedChunk {
  // Internal row id, used to join indexes; not for display.
  rowid: number;
  // The deterministic chunk id (accession plus offsets).
  chunkId: string;
  text: string;
  provenance: Provenance;
  scores: ChunkScores;
}

export interface RetrieveOptions {
  // How many fused results to return.
  topK?: number;
  // How many candidates to pull from the vector index before fusion.
  vectorK?: number;
  // How many candidates to pull from the keyword index before fusion.
  keywordK?: number;
  // The reciprocal-rank-fusion constant. Larger values flatten the contribution
  // of top ranks; 60 is the value from the original RRF paper and a sane default.
  rrfK?: number;
}
