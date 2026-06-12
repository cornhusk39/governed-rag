// Split a filing's canonical text into sections by its Item headings.
//
// SEC 10-K and 10-Q filings are organized into numbered Items, grouped under
// Parts (Part I, Part II). The same Item number repeats across parts in a 10-Q,
// so a section is only uniquely identified by the pair (part, item).
//
// Real filings also open with a table of contents that lists every Item heading
// before the body repeats them. We handle that by keeping the LAST occurrence of
// each (part, item) heading: the table of contents entries come first and the
// real section bodies come second, so last-wins drops the contents cleanly.

import type { Section } from "../types.js";

// Matches "Part I", "Part II", etc. Used to track which part the following items
// belong to as we scan the document in order.
const PART_RE = /\bPART\s+(IV|I{1,3})\b/gi;

// Matches an Item heading: "Item 7.", "Item 1A.", "ITEM 1." and so on, followed
// by a title. Case-insensitive because filings vary (some bodies are uppercase,
// for example "ITEM 1. FINANCIAL STATEMENTS"). The period immediately after the
// item number is required, which filters out prose cross-references that use a
// comma ("see Item 1A, Risk Factors"). The title is captured to end of line,
// since extraction puts headings on their own line.
const ITEM_RE = /\bItem\s+(\d{1,2}[A-Z]?)\.\s+([A-Za-z][^\n]{2,90})/gi;

interface HeadingHit {
  part: string | null;
  item: string;
  title: string;
  // Offset where the heading begins in the canonical text.
  start: number;
}

// Build a stable id and human label for a section.
function sectionIdentity(part: string | null, item: string, title: string) {
  const itemLower = item.toLowerCase();
  const id = part ? `part-${part.toLowerCase()}-item-${itemLower}` : `item-${itemLower}`;
  const cleanTitle = title.trim().replace(/\s+/g, " ");
  const label = part
    ? `Part ${part}, Item ${item}: ${cleanTitle}`
    : `Item ${item}: ${cleanTitle}`;
  return { id, label, title: cleanTitle };
}

/**
 * Detect sections in canonical filing text.
 *
 * Returns sections in document order with half-open [startOffset, endOffset)
 * ranges that tile the body from the first real heading to the end of the text.
 * Content before the first heading (cover page and table of contents) is not
 * returned: it is boilerplate, not citable corpus.
 */
export function detectSections(text: string): Section[] {
  // First pass: record every part marker position so we can attribute each item
  // heading to the part that most recently preceded it.
  const partMarkers: Array<{ part: string; start: number }> = [];
  for (const match of text.matchAll(PART_RE)) {
    partMarkers.push({ part: match[1]!.toUpperCase(), start: match.index });
  }

  const partAt = (offset: number): string | null => {
    let current: string | null = null;
    for (const marker of partMarkers) {
      if (marker.start <= offset) {
        current = marker.part;
      } else {
        break;
      }
    }
    return current;
  };

  // Second pass: collect every Item heading with its attributed part.
  const hits: HeadingHit[] = [];
  for (const match of text.matchAll(ITEM_RE)) {
    const start = match.index;
    hits.push({
      part: partAt(start),
      item: match[1]!.toUpperCase(),
      title: match[2]!,
      start,
    });
  }

  if (hits.length === 0) {
    return [];
  }

  // Some filings list table-of-contents items before the first Part marker, so a
  // TOC "Item 2" is attributed to no part while the real body "Item 2" sits under
  // "Part I". Those produce different keys and both would survive. Drop a
  // part-less hit whenever the same item number also appears with a part: it is a
  // table-of-contents entry of a real, parted section.
  const itemsWithPart = new Set(
    hits.filter((h) => h.part !== null).map((h) => h.item),
  );
  const bodyHits = hits.filter((h) => !(h.part === null && itemsWithPart.has(h.item)));

  // Keep the last occurrence of each (part, item) key. Table-of-contents entries
  // appear earlier than the real section bodies, so last-wins discards them.
  const lastByKey = new Map<string, HeadingHit>();
  for (const hit of bodyHits) {
    const key = `${hit.part ?? ""}|${hit.item}`;
    lastByKey.set(key, hit);
  }
  const kept = [...lastByKey.values()].sort((a, b) => a.start - b.start);

  // Turn headings into sections: each spans from its own start to the next
  // heading's start, and the final section runs to the end of the text.
  const sections: Section[] = [];
  for (let i = 0; i < kept.length; i++) {
    const hit = kept[i]!;
    const next = kept[i + 1];
    const endOffset = next ? next.start : text.length;
    const { id, label, title } = sectionIdentity(hit.part, hit.item, hit.title);
    sections.push({
      id,
      label,
      part: hit.part,
      item: hit.item,
      title,
      startOffset: hit.start,
      endOffset,
    });
  }

  return sections;
}
