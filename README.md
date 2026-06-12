# Governed RAG

[![CI](https://github.com/cornhusk39/governed-rag/actions/workflows/ci.yml/badge.svg)](https://github.com/cornhusk39/governed-rag/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

RAG demos are everywhere. RAG you could defend to a compliance officer is not.

In a regulated organization, "the model said so" is not an acceptable answer.
Every claim has to trace back to source text, PII has to be controlled, quality
changes have to be caught before they ship, and every query has to leave an audit
trail. Frameworks give you retrieval. They do not give you governance.

Governed RAG is a self-hostable retrieval-augmented generation system where
governance is the architecture, not a feature flag. It is demonstrated on SEC
EDGAR filings (10-K and 10-Q).

## What it does

- **Span-level citations.** Every claim in an answer maps to exact character
  offsets in a source document, with full provenance (company, filing, section,
  offsets). A citation is not "this chunk looked relevant"; it is "these exact
  characters say this."
- **Groundedness verification.** After generation, an independent model judges
  whether each claim is actually entailed by its cited evidence. A deterministic
  pre-check first confirms every cited chunk was really retrieved. Claims that do
  not pass are not shown.
- **Refusal, not improvisation.** If retrieval is too weak or verification fails,
  the system returns an explicit "not supported by the corpus" response and marks
  the audit entry refused, rather than guessing.
- **PII pipeline.** Detection and redaction run at ingest and at answer time, and
  no raw unredacted text is ever persisted.
- **Append-only audit log.** One row per query with the full lineage: the query,
  the retrieved chunks and their scores, the answer, the claims and citations, the
  verification result, the models used, the cost, and the latency. Insert and read
  only; there is no update or delete path.
- **Eval gate in CI.** An [AgentProbe](https://github.com/cornhusk39/agentprobe)
  suite replays recorded pipeline cassettes and fails the build on a grounding,
  citation, or refusal regression.
- **Observability.** The pipeline emits standard OpenTelemetry traces (GenAI
  semantic conventions), so any OTLP endpoint sees every query as a traced run.

## Why not just LangChain or a wrapper

Frameworks solve the retrieval plumbing. They do not solve the reasons enterprise
RAG pilots stall: trust, auditability, and change control. Governed RAG is built
around those three. The interop story is the capstone, and it is three repos and
one toolchain:

- **[AgentProbe](https://github.com/cornhusk39/agentprobe)** gates the deploys.
  The eval suite in `eval/` runs in AgentProbe's replay mode in CI.
- **[Overseer for Agents](https://github.com/cornhusk39/overseer-for-agents)**
  watches it in production. Governed RAG emits OTLP traces; Overseer (or any OTLP
  backend) consumes them. There is no code dependency, only the protocol.

## Architecture

The query path is a pipeline where each stage is a governance checkpoint:

```
query
  │
  ▼
retrieve ── hybrid: vector (sqlite-vec) + keyword (FTS5), fused with RRF
  │
  ├─ retrieval too weak? ─────────────► REFUSE  (audit: refused)
  ▼
generate ── Anthropic SDK, structured output: claims, each tagged with the
  │          chunk ids that support it and a verbatim quote (Zod-validated)
  ▼
resolve  ── deterministic citation pre-check (cited chunk must be in the
  │          retrieved set) + span resolution (quote → exact char offsets)
  │
  ├─ fabricated citation / no claims? ─► REFUSE  (audit: refused)
  ▼
verify   ── independent Sonnet-class judge: does the evidence entail the claim?
  │
  ├─ unverified? ─────────────────────► REFUSE  (audit: refused)
  ▼
answer  ──────────────────────────────► ANSWER  (audit: answered)
```

Every path ends in exactly one append to the audit log, so there is no way to
answer a query without leaving a trail.

### Pinned decisions

- **TypeScript end to end**, a pnpm workspace: `core` (the governed pipeline),
  `cli` (ingest and query), `web` (Next.js query UI and audit explorer).
- **Storage is one SQLite file**: relational rows, vectors via sqlite-vec, and a
  keyword index via FTS5. Self-host first, zero external services in the data
  plane.
- **Hybrid retrieval** fuses vector and keyword rankings with reciprocal rank
  fusion, so a query gets both semantic recall and exact-term precision.
- **Structured generation**: the model must return claims with citations or the
  response is rejected. A free-text answer is not acceptable output.
- **The verifier is a different model from the generator** and sees only the
  claim and its evidence, so it cannot be talked into agreeing.
- **The corpus is untrusted input.** Retrieved filing text is isolated in the
  prompt and never interpreted as instructions; the verifier judges entailment
  only through a constrained schema.

## Tradeoffs

- **Determinism over magic in the gate.** The CI eval uses deterministic
  assertions rather than leaning on an LLM judge, so the gate is reproducible and
  needs no API key. The LLM-as-judge verifier is in the live pipeline, where it
  belongs.
- **The refusal floor is embedding-quality dependent.** It is calibrated for real
  (Voyage) embeddings. The offline test and demo path uses a deterministic local
  embedder, which is not built for semantic ranking, so its retrieval quality and
  the floor are illustrative rather than production-grade.
- **The public demo is read-only.** It serves an exported snapshot (recorded
  sessions over a seeded index) with no database and no keys. Live generation is
  the self-host path, not the deployed demo.

## The demo

The committed demo snapshot is built from **real SEC 10-Q filings** for Apple,
Microsoft, NVIDIA, Amazon, and Alphabet, fetched live from EDGAR (respecting
fair-access rules: a declared User-Agent and a polite request rate). It shows
real filing text, real provenance, and real span-level citations. Because the
demo carries no API keys, the answers themselves are deterministic stand-ins; the
governance trail around them is real. The live path with Voyage embeddings and
Anthropic generation is the self-host flow below.

## Develop

```bash
pnpm install
pnpm test        # Vitest across all packages
pnpm typecheck
pnpm lint
pnpm build
```

No API keys are needed to run the tests: they run on fixtures and recorded
cassettes. See [.env.example](.env.example) for the variables the live path uses.

## Run the demo

```bash
docker compose up web      # read-only UI on http://localhost:3000, no keys
```

Or run the web app directly with `pnpm --filter @governed-rag/web dev`.

## Live self-host (with keys)

Set `VOYAGE_API_KEY`, `ANTHROPIC_API_KEY`, and `EDGAR_USER_AGENT` in `.env`, then
drive the pipeline with the CLI (on the shared volume in compose, or locally):

```bash
# Ingest a filing you have fetched from EDGAR
governed-rag ingest aapl-10q.htm --cik 0000320193 \
  --accession 0000320193-26-000013 --company "Apple Inc." \
  --form 10-Q --filing-date 2026-05-01

# Ask a governed question (writes an audit row)
governed-rag query "How did net sales change this quarter?"

# Export a read-only snapshot for the web UI
governed-rag export snapshot.json
```

Under compose: `docker compose run --rm cli <command>`.

## Eval gate

`eval/` is the AgentProbe regression suite. CI clones the public AgentProbe repo
at a pinned commit, builds it, and replays the committed cassettes against the
baseline; a grounding, citation, or refusal regression fails the build. See
[eval/README.md](eval/README.md), including how to prove the gate by injecting a
regression.

## Layout

- `packages/core` — ingest, hybrid retrieval, structured generation, citation
  resolution, the groundedness verifier, the refusal policy, the audit log, and
  OTel instrumentation.
- `packages/cli` — `ingest`, `query`, and `export` commands.
- `packages/web` — Next.js query UI (span-highlighting citations) and audit log
  explorer, read-only over an exported snapshot.
- `eval/` — the AgentProbe eval gate.
- `scripts/build-demo.ts` — builds the demo snapshot from live EDGAR filings.

## Security posture

This is a public-domain corpus, but the posture is built for a regulated one:
secrets live in env only with a gitleaks pre-commit hook and a `publish-gate.sh`
that scans full history with two scanners; retrieved text is treated as untrusted
data; PII redaction runs at ingest and answer time (including the user's query
before it is logged); audit writes are append-only; and EDGAR access declares a
User-Agent and rate-limits, with CI using cached fixtures so it never hits EDGAR.
See [docs/DESIGN.md](docs/DESIGN.md) for the full design notes and threat model.

## Roadmap

Deliberately out of v1, in rough priority order:

- A bearer-token-guarded HTTP query API (the env var is already reserved), so the
  pipeline can be dropped into a service rather than driven only by the CLI.
- A one-click audit export (CSV) and tamper-evident, hash-chained audit records
  for a true regulated deployment.
- An optional live-but-rate-limited hosted demo so visitors can ask their own
  questions without self-hosting.
- Smarter quote selection (the most relevant sentence within a chunk) and a
  reranking stage for retrieval quality.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) for the layout and local workflow. Licensed
under [MIT](LICENSE).
