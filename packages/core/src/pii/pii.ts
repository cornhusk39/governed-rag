// PII detection and redaction.
//
// Governed RAG redacts at ingest and again at answer time, and it never persists
// the raw matched value: a redaction hit records only the type and where the
// placeholder landed, not the secret it replaced. SEC filings are public and
// rarely contain real PII, so the test fixtures inject synthetic PII to prove the
// path works end to end.
//
// The detectors are deliberately conservative regex-plus-shape heuristics. This
// is a known tradeoff: cheap, transparent, and self-hostable, at the cost of the
// recall a dedicated NER model would give. The interface leaves room to swap in
// a stronger detector later without touching callers.

export type PiiType = "email" | "ssn" | "phone" | "account-number";

// A redaction hit points at the placeholder in the REDACTED text. It carries no
// raw value on purpose, so audit records can reference it safely.
export interface PiiHit {
  type: PiiType;
  start: number;
  end: number;
}

export interface RedactionResult {
  text: string;
  hits: PiiHit[];
}

interface Detector {
  type: PiiType;
  // Lower number wins when two detectors match overlapping spans.
  priority: number;
  pattern: RegExp;
}

// Order matters: more specific shapes get lower priority numbers so they win over
// looser ones (an SSN should not be swallowed by the generic account-number rule).
const DETECTORS: Detector[] = [
  {
    type: "email",
    priority: 0,
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    type: "ssn",
    priority: 1,
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    // A US phone number. We require separators (parentheses, spaces, dashes, or
    // dots) between the groups. A bare run of ten digits is ambiguous with an
    // account number, so we let those fall through to the account detector and
    // only treat clearly-formatted numbers as phones.
    type: "phone",
    priority: 2,
    pattern: /(?:\+?1[-.\s]?)?(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g,
  },
  {
    // A bank or account identifier: a 9 to 17 digit run, but only when an
    // account-context word precedes it. Real filings are full of long bare
    // numbers (share counts, CIK and accession numbers, identifiers), so gating
    // on a nearby keyword via lookbehind avoids redacting ordinary filing data
    // while still catching genuine "account 1234567890123" style PII. Only the
    // digits are matched and redacted, not the keyword.
    type: "account-number",
    priority: 3,
    pattern: /(?<=\b(?:account|acct|a\/c|routing|iban)\b\D{0,12})\d{9,17}\b/gi,
  },
];

interface RawSpan {
  type: PiiType;
  priority: number;
  start: number;
  end: number;
}

function placeholderFor(type: PiiType): string {
  return `[REDACTED:${type}]`;
}

/**
 * Find PII spans in the input text. Offsets are into the input (unredacted) text.
 * Overlapping matches are resolved by detector priority, then by earliest start.
 */
export function detectPii(text: string): RawSpan[] {
  const candidates: RawSpan[] = [];
  for (const detector of DETECTORS) {
    // Reset lastIndex defensively since the patterns are module-level and global.
    detector.pattern.lastIndex = 0;
    for (const match of text.matchAll(detector.pattern)) {
      candidates.push({
        type: detector.type,
        priority: detector.priority,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  // Resolve overlaps by priority first: process highest-priority spans (lowest
  // number) before lower-priority ones, and keep a span only if it does not
  // overlap one already kept. This enforces the invariant that, for example, an
  // SSN wins over the generic account-number rule even when the account match
  // starts earlier. The kept spans are then sorted by start for redaction.
  candidates.sort((a, b) => a.priority - b.priority || a.start - b.start);
  const kept: RawSpan[] = [];
  for (const span of candidates) {
    const overlaps = kept.some((k) => span.start < k.end && k.start < span.end);
    if (!overlaps) {
      kept.push(span);
    }
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

/**
 * Redact PII from text. Returns the redacted text and the placeholder hits with
 * offsets into the redacted output, never the raw matched values.
 */
export function redactPii(text: string): RedactionResult {
  const spans = detectPii(text);
  if (spans.length === 0) {
    return { text, hits: [] };
  }

  let out = "";
  let cursor = 0;
  const hits: PiiHit[] = [];

  for (const span of spans) {
    out += text.slice(cursor, span.start);
    const placeholder = placeholderFor(span.type);
    const start = out.length;
    out += placeholder;
    hits.push({ type: span.type, start, end: out.length });
    cursor = span.end;
  }
  out += text.slice(cursor);

  return { text: out, hits };
}
