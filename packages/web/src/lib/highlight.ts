// Pure helper for showing a cited span highlighted in its surrounding context.
//
// Given the filing's canonical text and a [start, end) span, it returns the text
// just before the span, the span itself, and the text just after, each trimmed to
// a context window. The UI renders the middle piece highlighted. Keeping this
// pure makes the span-resolution behavior (the heart of a citation) testable
// without rendering anything.

export interface HighlightedSpan {
  before: string;
  match: string;
  after: string;
  // True when context was trimmed on that side (so the UI can show an ellipsis).
  truncatedBefore: boolean;
  truncatedAfter: boolean;
}

export function highlightSpan(
  text: string,
  startOffset: number,
  endOffset: number,
  contextChars = 160,
): HighlightedSpan {
  // Clamp the span to the text bounds so a stale offset can never throw.
  const start = Math.max(0, Math.min(startOffset, text.length));
  const end = Math.max(start, Math.min(endOffset, text.length));

  const beforeStart = Math.max(0, start - contextChars);
  const afterEnd = Math.min(text.length, end + contextChars);

  return {
    before: text.slice(beforeStart, start),
    match: text.slice(start, end),
    after: text.slice(end, afterEnd),
    truncatedBefore: beforeStart > 0,
    truncatedAfter: afterEnd < text.length,
  };
}
