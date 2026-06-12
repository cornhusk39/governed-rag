// The governed query pipeline: query in, governed answer out, audit row written.
//
// This wires the stages together: retrieve, gate, generate, verify, decide,
// audit. Every path ends in exactly one audit append, so there is no way to
// answer a query without leaving a trail. Refusal can happen before generation
// (weak retrieval) or after verification (uncited or unverified claims); in both
// cases the user gets the uniform refusal message and the audit row is marked
// refused.

import type { Span } from "@opentelemetry/api";

import { generateAnswer } from "../generation/generate.js";
import type { AnsweredClaim } from "../generation/citations.js";
import type { Generator } from "../generation/types.js";
import { redactPii } from "../pii/pii.js";
import type { HybridRetriever } from "../retrieval/retriever.js";
import type { RetrieveOptions, RetrievedChunk } from "../retrieval/types.js";
import { AuditLog } from "../store/audit.js";
import { GenAiAttr, RagAttr, traced } from "../telemetry/tracing.js";
import { verifyGeneration } from "../verification/verify.js";
import type { VerificationResult, Verifier } from "../verification/types.js";

import {
  checkRetrievalGate,
  REFUSAL_MESSAGE,
  type RefusalReason,
  type RetrievalGateConfig,
} from "./refusal.js";

// A compact, audit-friendly view of one retrieved chunk.
export interface RetrievedSummary {
  chunkId: string;
  company: string;
  accession: string;
  sectionId: string;
  sectionLabel: string;
  rrf: number;
  vectorRank?: number;
  keywordRank?: number;
  vectorDistance?: number;
}

export interface GovernedAnswer {
  requestId: string;
  verdict: "answered" | "refused";
  // Present when answered; the refusal message when refused.
  message: string;
  refusalReason?: RefusalReason;
  // The retrieved context, always recorded.
  retrieved: RetrievedSummary[];
  // Present once generation ran (answered, or refused post-generation).
  claims?: AnsweredClaim[];
  verification?: VerificationResult;
  model?: string;
  usage: { costUsd: number; latencyMs: number };
}

export interface AnswerDeps {
  retriever: HybridRetriever;
  generator: Generator;
  verifier: Verifier;
  auditLog: AuditLog;
  retrievalGate?: RetrievalGateConfig;
  retrieveOptions?: RetrieveOptions;
  // Injectable clock and id source for deterministic tests.
  now?: () => string;
  requestId?: () => string;
}

function summarize(chunks: RetrievedChunk[]): RetrievedSummary[] {
  return chunks.map((c) => ({
    chunkId: c.chunkId,
    company: c.provenance.company,
    accession: c.provenance.accession,
    sectionId: c.provenance.sectionId,
    sectionLabel: c.provenance.sectionLabel,
    rrf: c.scores.rrf,
    vectorRank: c.scores.vectorRank,
    keywordRank: c.scores.keywordRank,
    vectorDistance: c.scores.vectorDistance,
  }));
}

export async function answerQuery(query: string, deps: AnswerDeps): Promise<GovernedAnswer> {
  // The whole governed query is one trace; retrieve, generate, and verify are
  // child spans. When no OTLP endpoint is configured these are no-ops.
  return traced("rag.query", (querySpan) => runAnswer(query, deps, querySpan));
}

async function runAnswer(
  query: string,
  deps: AnswerDeps,
  querySpan: Span,
): Promise<GovernedAnswer> {
  const requestId = (deps.requestId ?? (() => globalThis.crypto.randomUUID()))();
  const createdAt = (deps.now ?? (() => new Date().toISOString()))();
  const startedAt = Date.now();
  const embedderId = deps.retriever.embedderId;

  // The query is the user's input at answer time, so it is redacted before it is
  // written to the audit log. Retrieval and generation still use the raw query;
  // only the persisted copy is redacted, so a question containing PII never lands
  // unredacted in the trail.
  const auditQuery = redactPii(query).text;

  const chunks = await traced(
    "rag.retrieve",
    async (span) => {
      const result = await deps.retriever.retrieve(query, deps.retrieveOptions);
      span.setAttribute(RagAttr.retrievedCount, result.length);
      if (result.length > 0) {
        span.setAttribute(RagAttr.topRrf, Math.max(...result.map((c) => c.scores.rrf)));
      }
      return result;
    },
  );
  const retrieved = summarize(chunks);

  // Gate 1: pre-generation refusal on weak retrieval.
  const gate = checkRetrievalGate(chunks, deps.retrievalGate);
  if (!gate.sufficient) {
    querySpan.setAttributes({
      [RagAttr.verdict]: "refused",
      [RagAttr.refusalReason]: gate.reason ?? "",
    });
    const latencyMs = Date.now() - startedAt;
    deps.auditLog.append({
      requestId,
      createdAt,
      query: auditQuery,
      verdict: "refused",
      refusalReason: gate.reason,
      retrieved,
      embedderId,
      costUsd: 0,
      latencyMs,
    });
    return {
      requestId,
      verdict: "refused",
      message: REFUSAL_MESSAGE,
      refusalReason: gate.reason,
      retrieved,
      usage: { costUsd: 0, latencyMs },
    };
  }

  // Generate, then verify, each as a child span with GenAI attributes.
  const generated = await traced("gen_ai.generate", async (span) => {
    const result = await generateAnswer({ query, chunks }, deps.generator);
    span.setAttributes({
      [GenAiAttr.operation]: "generate",
      [GenAiAttr.requestModel]: result.model,
      [GenAiAttr.usageInputTokens]: result.usage.inputTokens,
      [GenAiAttr.usageOutputTokens]: result.usage.outputTokens,
    });
    return result;
  });
  const verification = await traced("gen_ai.verify", async (span) => {
    const result = await verifyGeneration(generated.resolved, deps.verifier);
    span.setAttribute(GenAiAttr.operation, "verify");
    if (result.verifierId) {
      span.setAttribute(GenAiAttr.requestModel, result.verifierId);
    }
    return result;
  });

  // Gate 2: post-generation refusal. Order matters for the recorded reason:
  // fabricated citations first, then abstention, then failed verification.
  let refusalReason: RefusalReason | undefined;
  if (!generated.resolved.citationPrecheckPassed) {
    refusalReason = "citation_precheck_failed";
  } else if (generated.resolved.claims.length === 0) {
    refusalReason = "no_claims";
  } else if (verification.verdict === "unsupported") {
    refusalReason = "unverified_claims";
  }

  const latencyMs = Date.now() - startedAt;
  // Total spend is generation plus every verifier call, so the audit log does not
  // understate the true cost of answering.
  const costUsd = generated.usage.costUsd + verification.costUsd;

  querySpan.setAttributes({
    [RagAttr.costUsd]: costUsd,
    [RagAttr.claimCount]: generated.resolved.claims.length,
  });

  if (refusalReason) {
    querySpan.setAttributes({
      [RagAttr.verdict]: "refused",
      [RagAttr.refusalReason]: refusalReason,
    });
    deps.auditLog.append({
      requestId,
      createdAt,
      query: auditQuery,
      verdict: "refused",
      refusalReason,
      retrieved,
      claims: generated.resolved.claims,
      verification,
      embedderId,
      generationModel: generated.model,
      verifierId: verification.verifierId,
      costUsd,
      latencyMs,
    });
    return {
      requestId,
      verdict: "refused",
      message: REFUSAL_MESSAGE,
      refusalReason,
      retrieved,
      claims: generated.resolved.claims,
      verification,
      model: generated.model,
      usage: { costUsd, latencyMs },
    };
  }

  // Answered: full lineage recorded.
  querySpan.setAttribute(RagAttr.verdict, "answered");
  deps.auditLog.append({
    requestId,
    createdAt,
    query: auditQuery,
    verdict: "answered",
    answer: generated.resolved.answer,
    retrieved,
    claims: generated.resolved.claims,
    verification,
    embedderId,
    generationModel: generated.model,
    verifierId: verification.verifierId,
    costUsd,
    latencyMs,
  });
  return {
    requestId,
    verdict: "answered",
    message: generated.resolved.answer,
    retrieved,
    claims: generated.resolved.claims,
    verification,
    model: generated.model,
    usage: { costUsd, latencyMs },
  };
}
