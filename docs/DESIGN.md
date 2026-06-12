# Governed RAG: design notes

This document records the problem, the design decisions, the scope boundary, and
the threat model behind Governed RAG. The README is the tour; this is the
reasoning.

## Problem

RAG demos are everywhere. RAG you could defend to a compliance officer is not. In
a regulated organization, "the model said so" is unacceptable: every answer must
be traceable to source text, PII must be controlled, quality changes must be
caught before deploy, and every query must leave an audit trail. Frameworks give
you retrieval. None of them give you governance.

## What Governed RAG is

A self-hostable RAG system where governance is the architecture, not a feature
flag. Demonstrated on SEC filings (10-K and 10-Q), it provides:

1. **Span-level citations.** Every claim in an answer maps to exact character
   offsets in a source document, with provenance (filing, section, offsets).
2. **Groundedness verification.** A post-generation check validates that each
   claim is supported by the retrieved spans. Unsupported claims block or
   downgrade the answer. Out-of-corpus questions are refused, not improvised.
3. **PII pipeline.** Detection and redaction at ingest and at answer time.
4. **Full audit log.** Query, retrieved chunks with scores, answer, citations,
   verification result, model, cost, and latency, persisted per request.
5. **Eval gate in CI.** A regression suite scores grounding, citation precision,
   and refusal correctness on every change. Regressions fail the build.
6. **Observability.** The pipeline emits standard OTel traces, so any OTLP
   endpoint sees every query as a traced run.

## Positioning

Frameworks solve retrieval plumbing. This solves the reasons enterprise RAG
pilots stall: trust, auditability, and change control. The interop story is the
capstone: the eval suite gates deploys (AgentProbe), and the OTel traces let an
observability plane watch it in production (Overseer for Agents). Three repos,
one toolchain, no hard coupling: the contracts are a suite format and a wire
protocol.

## Key decisions

- **TypeScript end to end.** pnpm workspace: `core` (ingest, retrieval,
  generation, verification, audit), `cli` (ingest and query commands), `web`
  (Next.js App Router: query UI plus audit log explorer).
- **Storage and retrieval.** SQLite via better-sqlite3, vectors via sqlite-vec,
  hybrid retrieval (vector plus FTS5 keyword) with reciprocal rank fusion.
  Self-host-first, zero external services for the data plane.
- **Generation.** Anthropic TypeScript SDK. The model returns claims, each tagged
  with supporting chunk references, validated with Zod. Free-text answers without
  citation structure are rejected.
- **Corpus.** SEC EDGAR 10-K and 10-Q filings for a handful of well-known public
  companies. Ingest respects EDGAR fair-access rules (declared User-Agent, rate
  limiting). Structure-aware chunking by filing section; provenance stored as CIK,
  accession number, section, and character offsets.
- **Embeddings.** Voyage AI (voyage-3 family) behind a small interface so it is
  swappable; key from env only. Tests and the offline demo use a deterministic
  local embedder behind the same interface.
- **Groundedness verifier.** An LLM-as-judge (Sonnet-class) checks claim-to-span
  entailment, plus a deterministic pre-check that every cited chunk id exists in
  the retrieved set. Verification results are stored in the audit log.
- **PII.** Regex plus heuristic detectors (emails, phones, SSNs,
  account-number-shaped strings). SEC filings are public, so the redaction path is
  proven against synthetic fixtures.
- **Refusal policy.** If top retrieval scores fall below a calibrated floor or
  verification fails, the system returns an explicit "not supported by the
  corpus" response with the audit entry marked refused.
- **Observability.** Standard OpenTelemetry SDK emitting OTLP/HTTP with GenAI
  semantic conventions. No code dependency on any backend; if no OTLP endpoint is
  configured, tracing is a no-op.

## Scope

In:

1. EDGAR ingest pipeline: fetch, parse, section-aware chunking, provenance, PII
   scan, embedding, hybrid index build.
2. Query pipeline: hybrid retrieval with RRF, structured generation with
   claim-to-chunk citations, span resolution to character offsets.
3. Groundedness verification layer and the refusal policy.
4. Audit log: append-only request records with full lineage, plus the explorer
   UI (filter by date, verdict, document, cost).
5. Query UI: answer view with inline citations that open the exact source span
   highlighted in context.
6. OTel instrumentation across ingest and query paths.
7. Eval suite (grounding, citation precision, refusal correctness) plus recorded
   cassettes and the CI workflow that runs it as a gate.
8. Seeded demo index, recorded sessions, read-only demo mode, docker-compose
   self-host path, .env.example.

Out (deliberately, for v1):

- Multi-tenancy, RBAC, document-level ACLs, agentic multi-hop retrieval,
  fine-tuning, reranker models, conversation memory, non-EDGAR connectors,
  alerting.

Access control for v1 is limited to a single-tenant bearer token reserved for the
query API; document-level ACLs are the v2 path.

## Threat model

- **Prompt injection via the corpus.** Retrieved document text is untrusted data.
  It is isolated in the generation prompt, never interpreted as instructions, and
  the verifier judges entailment only through a constrained schema.
- **Secrets.** Env only; a gitleaks pre-commit hook from the first commit; a
  publish gate that scans full history with two scanners as the hard gate.
- **PII.** Ingest-time and answer-time redaction paths proven by synthetic
  fixtures; raw unredacted intermediates are never persisted, and the user's
  query is redacted before it is written to the audit log.
- **EDGAR compliance.** Declared User-Agent, conservative rate limits, cached
  fixtures in tests so CI never hits EDGAR.
- **Demo.** Read-only, no generation route mounted, no keys deployed.
- **Audit integrity.** Append-only writes; no update or delete path in the API.

## Known limitations and roadmap

- The refusal floor is calibrated for semantic (Voyage) embeddings. The offline
  and demo path uses a deterministic local embedder, so its retrieval ranking is
  illustrative rather than production-grade.
- There is no networked query API yet; the live interface is the CLI and the demo
  is read-only. A bearer-token-guarded `/query` endpoint is the natural next step
  (the env var is reserved).
- The audit explorer is read-only in the UI; a one-click export (CSV) and
  tamper-evidence (hash-chained records) would round out a regulated deployment.
- Generation quotes a supporting span; selecting the single most relevant
  sentence within a chunk is a future refinement.
