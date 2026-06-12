// Turn EDGAR filing HTML into clean, plain canonical text.
//
// We deliberately avoid a full DOM parser here. EDGAR primary documents are
// large HTML-with-inline-XBRL blobs, and for retrieval we only need readable
// text, not the markup tree. A focused, well-understood transform keeps the data
// plane dependency-light and self-host friendly, which is a project goal.
//
// The text this produces is the canonical document: every character offset we
// store as provenance indexes into the string returned here (after PII
// redaction), so it must be produced deterministically.

// Block-level elements whose boundaries should become line breaks, so that
// headings and paragraphs do not run together once tags are removed. Without
// this, "Item 1.Financial" style collisions break section detection.
const BLOCK_TAGS = [
  "p",
  "div",
  "br",
  "tr",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "section",
  "article",
];

// A small set of named HTML entities common in filings. Numeric entities are
// handled generically below, so this only needs the named ones we actually see.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // Curly quotes and dashes show up constantly in filing prose.
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      // Guard the full Unicode range, not just finiteness. String.fromCodePoint
      // throws a RangeError for negative or above-0x10FFFF code points, and real
      // filing HTML occasionally carries malformed numeric entities like
      // &#9999999999;. An unhandled throw here would abort the whole ingest, so
      // out-of-range refs are left untouched instead.
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/**
 * Extract canonical plain text from filing HTML.
 *
 * The output is normalized so that section detection and offset math are stable:
 * block elements become newlines, runs of inline whitespace collapse to a single
 * space, and runs of blank lines collapse to a single newline.
 */
export function extractText(html: string): string {
  let text = html;

  // Drop anything that is markup-only noise and never carries readable content.
  // Script and style bodies in particular would otherwise leak code into the text.
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

  // Convert block boundaries to newlines before stripping the rest of the tags.
  const blockPattern = new RegExp(`</?(?:${BLOCK_TAGS.join("|")})\\b[^>]*>`, "gi");
  text = text.replace(blockPattern, "\n");

  // Remove all remaining tags.
  text = text.replace(/<[^>]+>/g, " ");

  text = decodeEntities(text);

  // Normalize whitespace. Collapse spaces and tabs first, then trim each line and
  // collapse blank-line runs. The result is compact but keeps line structure that
  // section headings rely on.
  text = text.replace(/\r\n?/g, "\n");
  text = text.replace(/[^\S\n]+/g, " ");
  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  text = text.replace(/\n{2,}/g, "\n");

  return text.trim();
}
