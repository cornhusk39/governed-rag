// Resolve a model's raw claims into citations with exact character spans, and run
// the deterministic citation pre-check.
//
// Two governance checks live here, both pure and fully testable without a model:
//
// 1. Citation pre-check: every chunk id a claim cites must exist in the set of
//    chunks we actually retrieved. A claim that cites a chunk id we never showed
//    the model is a fabrication, full stop, and the pre-check flags it.
//
// 2. Span resolution: each claim carries a verbatim quote. We locate that quote
//    inside its cited chunk and compute the absolute character offsets in the
//    filing's canonical text (chunk start offset plus the quote's position within
//    the chunk). That is what makes a citation "span-level": it points at exact
//    characters, not just a chunk.

import type { Provenance } from "../types.js";
import type { RetrievedChunk } from "../retrieval/types.js";

import type { RawGeneration } from "./schema.js";

export interface ResolvedCitation {
  chunkId: string;
  // The cited chunk id was present in the retrieved set.
  chunkFound: boolean;
  quote: string;
  // The quote was located verbatim inside the cited chunk.
  quoteFound: boolean;
  // Absolute [start, end) offsets in the filing's canonical text, when resolved.
  span?: { startOffset: number; endOffset: number };
  // Provenance copied from the cited chunk, when found.
  provenance?: Provenance;
}

export interface AnsweredClaim {
  text: string;
  citations: ResolvedCitation[];
  // True when at least one citation both names a real chunk and resolves to a
  // span. This is a structural notion of support; the M4 verifier judges whether
  // the quote actually entails the claim.
  supported: boolean;
}

export interface ResolvedGeneration {
  answer: string;
  claims: AnsweredClaim[];
  // The deterministic pre-check: did every cited chunk id exist in the retrieved
  // set? False if any claim cited an unknown chunk.
  citationPrecheckPassed: boolean;
  // Distinct cited chunk ids that were not in the retrieved set, for the audit log.
  unknownChunkIds: string[];
}

function resolveOneCitation(
  chunkId: string,
  quote: string,
  byId: Map<string, RetrievedChunk>,
): ResolvedCitation {
  const chunk = byId.get(chunkId);
  if (!chunk) {
    return { chunkId, chunkFound: false, quote, quoteFound: false };
  }

  // Locate the quote verbatim within the chunk text. We trim the quote first
  // because models often pad quotes with surrounding whitespace.
  const needle = quote.trim();
  const index = needle.length > 0 ? chunk.text.indexOf(needle) : -1;
  if (index < 0) {
    return {
      chunkId,
      chunkFound: true,
      quote,
      quoteFound: false,
      provenance: chunk.provenance,
    };
  }

  const startOffset = chunk.provenance.startOffset + index;
  const endOffset = startOffset + needle.length;
  return {
    chunkId,
    chunkFound: true,
    quote,
    quoteFound: true,
    span: { startOffset, endOffset },
    provenance: chunk.provenance,
  };
}

/**
 * Resolve all claims in a generation against the retrieved chunks.
 */
export function resolveCitations(
  generation: RawGeneration,
  chunks: RetrievedChunk[],
): ResolvedGeneration {
  const byId = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  const unknown = new Set<string>();

  const claims: AnsweredClaim[] = generation.claims.map((claim) => {
    const citations = claim.chunk_ids.map((chunkId) => {
      const resolved = resolveOneCitation(chunkId, claim.quote, byId);
      if (!resolved.chunkFound) {
        unknown.add(chunkId);
      }
      return resolved;
    });
    const supported = citations.some((c) => c.chunkFound && c.quoteFound);
    return { text: claim.text, citations, supported };
  });

  return {
    answer: generation.answer,
    claims,
    citationPrecheckPassed: unknown.size === 0,
    unknownChunkIds: [...unknown],
  };
}
