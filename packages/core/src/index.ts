// Public entry point for the Governed RAG core package. The governed pipeline
// (ingest, retrieval, generation, verification, audit) is exported from here.

export const CORE_VERSION = "0.1.0";

// Domain types.
export * from "./types.js";

// Telemetry (OpenTelemetry tracing helpers).
export { traced, GenAiAttr, RagAttr } from "./telemetry/tracing.js";

// Demo snapshot (read-only export for the web UI).
export {
  buildSnapshot,
  type DemoSnapshot,
  type SnapshotFiling,
  type BuildSnapshotOptions,
} from "./snapshot.js";

// Ingest pipeline and its stages.
export { extractText } from "./ingest/extract.js";
export { detectSections } from "./ingest/sections.js";
export {
  chunkFiling,
  DEFAULT_CHUNK_OPTIONS,
  type ChunkOptions,
} from "./ingest/chunk.js";
export {
  ingestFiling,
  type IngestInput,
  type IngestDeps,
  type IngestResult,
} from "./ingest/pipeline.js";
export {
  EdgarClient,
  type EdgarClientOptions,
  type RecentFiling,
} from "./ingest/edgar.js";

// PII detection and redaction.
export {
  detectPii,
  redactPii,
  type PiiType,
  type PiiHit,
  type RedactionResult,
} from "./pii/pii.js";

// Embedding providers.
export type { Embedder } from "./embedding/types.js";
export { FakeEmbedder, type FakeEmbedderOptions } from "./embedding/fake.js";
export { VoyageEmbedder, type VoyageOptions } from "./embedding/voyage.js";

// Verification (groundedness).
export {
  judgeVerdictSchema,
  JUDGE_JSON_SCHEMA,
  type JudgeVerdict,
} from "./verification/schema.js";
export type {
  Verifier,
  JudgeInput,
  JudgeResult,
  ClaimVerification,
  VerificationResult,
} from "./verification/types.js";
export { AnthropicVerifier, type AnthropicVerifierOptions } from "./verification/anthropic.js";
export {
  ScriptedVerifier,
  type ScriptedVerifierOptions,
  type ScriptedJudge,
} from "./verification/scripted.js";
export { verifyGeneration } from "./verification/verify.js";

// Governed query pipeline.
export {
  answerQuery,
  type GovernedAnswer,
  type AnswerDeps,
  type RetrievedSummary,
} from "./pipeline/answer.js";
export {
  checkRetrievalGate,
  REFUSAL_MESSAGE,
  DEFAULT_RETRIEVAL_GATE,
  type RefusalReason,
  type RetrievalGateConfig,
  type RetrievalGateResult,
} from "./pipeline/refusal.js";

// Storage.
export { openDatabase, openExistingDatabase, type OpenDatabaseOptions } from "./store/db.js";
export { Repository, type StoredChunk, type RetrievalRow } from "./store/repository.js";
export {
  AuditLog,
  type AuditRecord,
  type AuditRecordInput,
  type AuditListFilters,
} from "./store/audit.js";
export type { DatabaseHandle } from "./store/types.js";

// Generation.
export {
  rawClaimSchema,
  rawGenerationSchema,
  GENERATION_JSON_SCHEMA,
  type RawClaim,
  type RawGeneration,
} from "./generation/schema.js";
export type {
  Generator,
  GenerationInput,
  GenerationUsage,
  RawGenerationResult,
} from "./generation/types.js";
export { buildPrompt, SYSTEM_PROMPT, type BuiltPrompt } from "./generation/prompt.js";
export { estimateCostUsd, type ModelRate } from "./generation/pricing.js";
export { AnthropicGenerator, type AnthropicGeneratorOptions } from "./generation/anthropic.js";
export {
  ScriptedGenerator,
  type ScriptedGeneratorOptions,
  type ScriptedResponder,
} from "./generation/scripted.js";
export {
  resolveCitations,
  type ResolvedCitation,
  type AnsweredClaim,
  type ResolvedGeneration,
} from "./generation/citations.js";
export { generateAnswer, type GeneratedAnswer } from "./generation/generate.js";

// Retrieval.
export {
  HybridRetriever,
  buildFtsQuery,
  type HybridRetrieverDeps,
} from "./retrieval/retriever.js";
export {
  reciprocalRankFusion,
  type RankedList,
  type FusedScore,
} from "./retrieval/rrf.js";
export type {
  RetrievedChunk,
  RetrieveOptions,
  ChunkScores,
} from "./retrieval/types.js";
