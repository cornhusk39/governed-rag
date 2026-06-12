// Renders a cited span highlighted inside its surrounding source text. This is
// the visible payoff of span-level citations: a reader can see the exact words a
// claim rests on, in context, in the original filing.

import { highlightSpan } from "@/lib/highlight";

export function CitationContext({
  canonicalText,
  startOffset,
  endOffset,
  label,
}: {
  canonicalText: string;
  startOffset: number;
  endOffset: number;
  label: string;
}) {
  const { before, match, after, truncatedBefore, truncatedAfter } = highlightSpan(
    canonicalText,
    startOffset,
    endOffset,
  );

  return (
    <div>
      <div className="muted" style={{ fontSize: "0.8rem" }}>
        {label} · chars {startOffset}–{endOffset}
      </div>
      <p className="context">
        {truncatedBefore ? "… " : ""}
        {before}
        <mark>{match}</mark>
        {after}
        {truncatedAfter ? " …" : ""}
      </p>
    </div>
  );
}
