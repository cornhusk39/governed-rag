// Split sections into overlapping chunks suitable for embedding and retrieval.
//
// Chunking is structure-aware: we never let a chunk cross a section boundary, so
// every chunk belongs to exactly one Item and inherits clean provenance. Within
// a section we use a sliding character window that snaps to sentence or word
// boundaries, with a small overlap so a claim that straddles two chunks is still
// fully present in at least one of them.
//
// Offsets are the contract here. A chunk's [startOffset, endOffset) must slice
// the canonical text back to exactly the chunk's text, because span-level
// citations downstream depend on it.

import type { Chunk, FilingMeta, Section } from "../types.js";

export interface ChunkOptions {
  // Target maximum chunk size in characters.
  maxChars: number;
  // Smallest window we will snap back to when looking for a clean boundary; keeps
  // us from producing tiny fragments just to land on a period.
  minChars: number;
  // How many characters of the previous chunk to repeat at the start of the next.
  overlapChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxChars: 1200,
  minChars: 400,
  overlapChars: 150,
};

// Find a good place to end a window within [minEnd, hardEnd). Prefer a sentence
// terminator, then any whitespace; fall back to hardEnd if nothing better exists
// in range. The returned offset lands just after the boundary character.
function snapEnd(text: string, minEnd: number, hardEnd: number): number {
  for (let i = hardEnd - 1; i >= minEnd; i--) {
    const ch = text[i]!;
    if (ch === "." || ch === "!" || ch === "?") {
      return i + 1;
    }
  }
  for (let i = hardEnd - 1; i >= minEnd; i--) {
    if (/\s/.test(text[i]!)) {
      return i + 1;
    }
  }
  return hardEnd;
}

// Advance past leading whitespace so a chunk's recorded start is meaningful.
function skipLeadingWhitespace(text: string, from: number, limit: number): number {
  let i = from;
  while (i < limit && /\s/.test(text[i]!)) {
    i++;
  }
  return i;
}

function chunkId(accession: string, start: number, end: number): string {
  return `${accession}:${start}-${end}`;
}

/**
 * Produce chunks for a single section.
 */
function chunkSection(
  text: string,
  section: Section,
  meta: FilingMeta,
  options: ChunkOptions,
): Chunk[] {
  const chunks: Chunk[] = [];
  let pos = skipLeadingWhitespace(text, section.startOffset, section.endOffset);

  while (pos < section.endOffset) {
    const hardEnd = Math.min(pos + options.maxChars, section.endOffset);
    let end: number;

    if (hardEnd >= section.endOffset) {
      // Last window of the section: take everything that remains.
      end = section.endOffset;
    } else {
      const minEnd = Math.min(pos + options.minChars, section.endOffset);
      end = snapEnd(text, minEnd, hardEnd);
    }

    const startOffset = pos;
    const endOffset = end;
    const raw = text.slice(startOffset, endOffset);
    const trimmed = raw.trim();

    // Skip windows that are only whitespace (can happen at section tails).
    if (trimmed.length > 0) {
      chunks.push({
        id: chunkId(meta.accession, startOffset, endOffset),
        text: raw,
        provenance: {
          cik: meta.cik,
          accession: meta.accession,
          company: meta.company,
          form: meta.form,
          filingDate: meta.filingDate,
          sectionId: section.id,
          sectionLabel: section.label,
          startOffset,
          endOffset,
        },
      });
    }

    if (end >= section.endOffset) {
      break;
    }

    // Step forward, repeating overlapChars of context, but always make progress
    // past the current chunk start to avoid an infinite loop on pathological input.
    const nextStart = Math.max(startOffset + 1, end - options.overlapChars);
    pos = skipLeadingWhitespace(text, nextStart, section.endOffset);
  }

  return chunks;
}

/**
 * Chunk a whole filing, section by section.
 */
export function chunkFiling(
  text: string,
  sections: Section[],
  meta: FilingMeta,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): Chunk[] {
  // Validate the window relationship. If overlap is not strictly smaller than the
  // minimum window, the sliding window can degenerate to one-character steps and
  // explode the chunk count, so reject the configuration loudly instead.
  if (!(options.overlapChars >= 0 && options.overlapChars < options.minChars)) {
    throw new Error(
      `invalid chunk options: overlapChars (${options.overlapChars}) must be >= 0 and < minChars (${options.minChars})`,
    );
  }
  if (options.minChars > options.maxChars) {
    throw new Error(
      `invalid chunk options: minChars (${options.minChars}) must be <= maxChars (${options.maxChars})`,
    );
  }
  return sections.flatMap((section) => chunkSection(text, section, meta, options));
}
