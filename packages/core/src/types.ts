// Shared domain types for the governed pipeline. These describe what we ingest
// and what we cite against. Provenance is the heart of the governance story: a
// chunk is only useful if we can say exactly where it came from, down to the
// character offset, so every later claim can be traced back to source.

import { z } from "zod";

// The two filing forms we support in v1. Kept narrow on purpose; widening this
// is a deliberate scope decision, not an accident.
export const filingFormSchema = z.enum(["10-K", "10-Q"]);
export type FilingForm = z.infer<typeof filingFormSchema>;

// Identifies a filing in EDGAR terms. CIK and accession are the stable keys SEC
// uses; company and filing date are carried for human-readable provenance.
export const filingMetaSchema = z.object({
  // SEC central index key, zero-padded to 10 digits to match EDGAR conventions.
  cik: z.string().regex(/^\d{10}$/),
  // Accession number in EDGAR's dashed form, for example 0000320193-26-000013.
  accession: z.string().regex(/^\d{10}-\d{2}-\d{6}$/),
  // Short, recognizable company label (ticker or name). Not an SEC field, ours.
  company: z.string().min(1),
  form: filingFormSchema,
  // ISO date string (YYYY-MM-DD) the filing was submitted.
  filingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type FilingMeta = z.infer<typeof filingMetaSchema>;

// A logical section of a filing, identified by its Item heading. The offsets are
// half-open [start, end) into the filing's canonical (extracted, redacted) text.
export interface Section {
  // Stable, machine-friendly id, for example "part-i-item-2".
  id: string;
  // Human-readable label, for example "Part I, Item 2: Management's Discussion".
  label: string;
  // The roman-numeral part ("I", "II", ...) when the filing uses parts.
  part: string | null;
  // The item number as it appears, for example "1", "1A", "7".
  item: string;
  // The section title text as parsed from the heading.
  title: string;
  startOffset: number;
  endOffset: number;
}

// Everything we need to cite a chunk. This is denormalized on purpose: a chunk
// should be self-describing so a citation never has to join back to other state
// to explain itself.
export interface Provenance {
  cik: string;
  accession: string;
  company: string;
  form: FilingForm;
  filingDate: string;
  sectionId: string;
  sectionLabel: string;
  // Half-open [start, end) character offsets into the filing's canonical text.
  startOffset: number;
  endOffset: number;
}

// A unit of retrievable text plus where it came from. The text is already
// PII-redacted: we never persist raw unredacted intermediates.
export interface Chunk {
  // Deterministic id derived from accession + offsets, so re-ingesting the same
  // filing is idempotent and citations are stable across runs.
  id: string;
  text: string;
  provenance: Provenance;
}
