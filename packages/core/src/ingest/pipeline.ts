// The ingest pipeline: raw filing HTML in, governed index out.
//
// The order of operations is itself a governance decision. We redact PII before
// anything is chunked, embedded, or stored, so no raw unredacted text is ever
// persisted and every downstream artifact (chunks, vectors, keyword index) is
// built from already-clean text. Character offsets are taken against the redacted
// canonical text, which is what we store and later cite against.
//
// Flow: extract -> redact -> detect sections -> chunk -> embed -> store.

import type { Span } from "@opentelemetry/api";

import type { Embedder } from "../embedding/types.js";
import { redactPii, type PiiHit } from "../pii/pii.js";
import type { Repository } from "../store/repository.js";
import { RagAttr, traced } from "../telemetry/tracing.js";
import { filingMetaSchema, type Chunk, type FilingMeta, type Section } from "../types.js";

import { chunkFiling, DEFAULT_CHUNK_OPTIONS, type ChunkOptions } from "./chunk.js";
import { extractText } from "./extract.js";
import { detectSections } from "./sections.js";

export interface IngestInput {
  html: string;
  meta: FilingMeta;
}

export interface IngestDeps {
  embedder: Embedder;
  repository: Repository;
  chunkOptions?: ChunkOptions;
  // Injectable clock so ingest timestamps are deterministic in tests.
  now?: () => string;
}

export interface IngestResult {
  filingId: number;
  accession: string;
  sectionCount: number;
  chunkCount: number;
  // Redaction hits with offsets into the stored canonical text. No raw values.
  redactionHits: PiiHit[];
  // The redacted canonical text length, useful for sanity checks and audit.
  canonicalLength: number;
}

/**
 * Run a single filing through the full ingest pipeline and persist the result.
 */
export async function ingestFiling(input: IngestInput, deps: IngestDeps): Promise<IngestResult> {
  // Validate provenance metadata up front. Bad CIK or accession shapes would
  // poison citations later, so we fail fast and loudly here.
  const meta = filingMetaSchema.parse(input.meta);

  return traced(
    "rag.ingest",
    (span) => runIngest(input.html, meta, deps, span),
    { [RagAttr.accession]: meta.accession, [RagAttr.form]: meta.form },
  );
}

async function runIngest(
  html: string,
  meta: FilingMeta,
  deps: IngestDeps,
  span: Span,
): Promise<IngestResult> {
  const extracted = extractText(html);
  const { text: canonicalText, hits: redactionHits } = redactPii(extracted);

  const sections: Section[] = detectSections(canonicalText);
  const chunks: Chunk[] = chunkFiling(
    canonicalText,
    sections,
    meta,
    deps.chunkOptions ?? DEFAULT_CHUNK_OPTIONS,
  );

  const embeddings = await deps.embedder.embed(chunks.map((chunk) => chunk.text));

  const now = deps.now ?? (() => new Date().toISOString());
  const filingId = deps.repository.insertFiling({
    meta,
    canonicalText,
    chunks,
    embeddings,
    embedderId: deps.embedder.id,
    ingestedAt: now(),
  });

  span.setAttributes({
    [RagAttr.sectionCount]: sections.length,
    [RagAttr.chunkCount]: chunks.length,
    [RagAttr.redactionCount]: redactionHits.length,
  });

  return {
    filingId,
    accession: meta.accession,
    sectionCount: sections.length,
    chunkCount: chunks.length,
    redactionHits,
    canonicalLength: canonicalText.length,
  };
}
