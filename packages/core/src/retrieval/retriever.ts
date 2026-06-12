// Hybrid retrieval: vector search plus keyword search, fused with RRF.
//
// Neither signal is enough on its own. Vector search captures meaning but can
// miss exact terms (a specific item name, a defined term in a filing); keyword
// search nails exact terms but misses paraphrase. Running both and fusing their
// rankings gives recall from both worlds, and RRF lets us combine them without
// pretending cosine distance and BM25 live on the same scale.

import type { Embedder } from "../embedding/types.js";
import type { Repository } from "../store/repository.js";
import type { FilingForm } from "../types.js";

import { reciprocalRankFusion, type RankedList } from "./rrf.js";
import type { RetrievedChunk, RetrieveOptions } from "./types.js";

const DEFAULTS = {
  topK: 8,
  vectorK: 20,
  keywordK: 20,
  rrfK: 60,
} as const;

// Turn free-text into a safe FTS5 MATCH expression. We extract word tokens and
// OR them together, quoting each so user punctuation can never be interpreted as
// FTS query syntax. Returning an empty string means "no usable keyword query".
export function buildFtsQuery(query: string): string {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  // Drop one-character tokens; they add noise and bloat the OR.
  const useful = tokens.filter((t) => t.length > 1);
  if (useful.length === 0) {
    return "";
  }
  return useful.map((t) => `"${t}"`).join(" OR ");
}

export interface HybridRetrieverDeps {
  repository: Repository;
  embedder: Embedder;
}

export class HybridRetriever {
  // Exposed so the pipeline can record which embedder produced the query vector
  // in the audit log.
  readonly embedderId: string;

  constructor(private readonly deps: HybridRetrieverDeps) {
    this.embedderId = deps.embedder.id;
  }

  async retrieve(query: string, options: RetrieveOptions = {}): Promise<RetrievedChunk[]> {
    const topK = options.topK ?? DEFAULTS.topK;
    const vectorK = options.vectorK ?? DEFAULTS.vectorK;
    const keywordK = options.keywordK ?? DEFAULTS.keywordK;
    const rrfK = options.rrfK ?? DEFAULTS.rrfK;

    // Vector side: embed the query with the same provider used at ingest.
    const [queryEmbedding] = await this.deps.embedder.embed([query]);
    const vectorHits = queryEmbedding
      ? this.deps.repository.vectorSearch(queryEmbedding, vectorK)
      : [];

    // Keyword side: only if the query produced usable tokens.
    const ftsQuery = buildFtsQuery(query);
    const keywordHits = ftsQuery
      ? this.deps.repository.keywordSearch(ftsQuery, keywordK)
      : [];

    // Fuse the two rankings. Keep the per-list ranks so each result can explain
    // where it came from.
    const lists: RankedList[] = [
      { ids: vectorHits.map((h) => h.rowid) },
      { ids: keywordHits.map((h) => h.rowid) },
    ];
    const fused = reciprocalRankFusion(lists, rrfK).slice(0, topK);

    if (fused.length === 0) {
      return [];
    }

    // Hydrate the winners into full rows with provenance.
    const rows = this.deps.repository.getRetrievalRows(fused.map((f) => f.id));
    const distanceByRowid = new Map(vectorHits.map((h) => [h.rowid, h.distance]));

    const results: RetrievedChunk[] = [];
    for (const entry of fused) {
      const row = rows.get(entry.id);
      if (!row) {
        // Should not happen, but never emit a result we cannot cite.
        continue;
      }
      const [vectorRank, keywordRank] = entry.ranks;
      results.push({
        rowid: row.rowid,
        chunkId: row.chunkUid,
        text: row.text,
        provenance: {
          cik: row.cik,
          accession: row.accession,
          company: row.company,
          form: row.form as FilingForm,
          filingDate: row.filingDate,
          sectionId: row.sectionId,
          sectionLabel: row.sectionLabel,
          startOffset: row.startOffset,
          endOffset: row.endOffset,
        },
        scores: {
          vectorRank,
          keywordRank,
          vectorDistance: distanceByRowid.get(row.rowid),
          rrf: entry.score,
        },
      });
    }

    return results;
  }
}
