// OpenTelemetry tracing for the pipeline.
//
// The contract is the protocol, not a library: core only depends on the OTel API,
// which is a no-op until a host registers an SDK. So if no OTLP endpoint is
// configured, these spans cost almost nothing and emit nothing. When a host (the
// CLI) wires up an exporter, every ingest and query becomes a traced run that any
// OTLP backend, Overseer for Agents included, can see.
//
// Span attributes follow the OpenTelemetry GenAI semantic conventions where they
// apply (gen_ai.*), so the traces are legible to standard tooling.

import { trace, SpanStatusCode, type Attributes, type Span } from "@opentelemetry/api";

const TRACER_NAME = "@governed-rag/core";

// GenAI semantic-convention attribute keys we use.
export const GenAiAttr = {
  system: "gen_ai.system",
  operation: "gen_ai.operation.name",
  requestModel: "gen_ai.request.model",
  usageInputTokens: "gen_ai.usage.input_tokens",
  usageOutputTokens: "gen_ai.usage.output_tokens",
} as const;

// Project-specific attribute keys for the governance dimensions.
export const RagAttr = {
  verdict: "rag.verdict",
  refusalReason: "rag.refusal_reason",
  retrievedCount: "rag.retrieved.count",
  topRrf: "rag.retrieved.top_rrf",
  claimCount: "rag.claims.count",
  costUsd: "rag.cost_usd",
  accession: "rag.filing.accession",
  form: "rag.filing.form",
  chunkCount: "rag.ingest.chunk_count",
  sectionCount: "rag.ingest.section_count",
  redactionCount: "rag.ingest.redaction_count",
} as const;

/**
 * Run a function inside an active span. The span is ended automatically, and an
 * exception marks the span as errored before propagating. When no SDK is
 * registered the underlying tracer is a no-op, so this is safe to use everywhere.
 */
export async function traced<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attributes?: Attributes,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (attributes) {
        span.setAttributes(attributes);
      }
      return await fn(span);
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
