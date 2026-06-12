// Build the AgentProbe eval assets (suite + cassettes + empty judge cache) by
// running the real governed pipeline over the fixture corpus.
//
// The "agent under test" is the governed query pipeline. Each case records the
// pipeline's behavior as an AgentProbe cassette: a summarized, assertion-friendly
// output, a trace of which pipeline steps ran (retrieve / generate / verify), and
// deterministic metrics. Because the run is scripted (fake embedder, scripted
// generator and verifier), it needs no API key and is fully reproducible, which
// is what lets CI replay these cassettes as a hard regression gate.
//
// Set INJECT_REGRESSION=1 to simulate a grounding regression (the system answers
// a question it should have refused). Regenerating the cassettes with that flag
// and running `agentprobe check` demonstrates the gate failing; without it, the
// gate passes. The deterministic assertions catch the regression with no judge.
//
// Run with core built: `pnpm --filter @governed-rag/core build && tsx eval/build-eval.ts`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AuditLog,
  FakeEmbedder,
  HybridRetriever,
  Repository,
  ScriptedGenerator,
  ScriptedVerifier,
  answerQuery,
  filingMetaSchema,
  ingestFiling,
  openDatabase,
  type GenerationInput,
  type GovernedAnswer,
  type Verifier,
  type Generator,
  // Imported from source so this author-time script needs no prior build and no
  // root-level workspace linkage. CI never runs this; it replays the cassettes.
} from "../packages/core/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const fixturesDir = path.join(repoRoot, "packages", "core", "fixtures", "filings");
const cassetteDir = path.join(here, "cassettes");

const DIMENSIONS = 256;
const FIXED_TIME = "2026-06-12T12:00:00.000Z";
const INJECT = process.env.INJECT_REGRESSION === "1";

// A generator that grounds a single claim in the top retrieved chunk.
const groundedGenerator = new ScriptedGenerator({
  respond: (input: GenerationInput) => {
    const top = input.chunks[0]!;
    const quote = top.text.slice(0, 30).trim();
    return {
      answer: "A grounded answer drawn from the filing.",
      claims: [{ text: `From the filing: ${quote}`, chunk_ids: [top.chunkId], quote }],
    };
  },
});

// A generator that cites a chunk that was never retrieved (fabrication).
const fabricatingGenerator = new ScriptedGenerator({
  respond: {
    answer: "An answer citing a source that was not retrieved.",
    claims: [{ text: "made up", chunk_ids: ["not-a-real-chunk:0-1"], quote: "nope" }],
  },
});

// A verifier that confirms nothing.
const skepticVerifier = new ScriptedVerifier({
  judge: () => ({ entailed: false, confidence: 0.1, rationale: "not supported by the evidence" }),
});

interface EvalCase {
  id: string;
  description: string;
  query: string;
  generator: Generator;
  verifier: Verifier;
  assertions: unknown[];
}

const cases: EvalCase[] = [
  {
    id: "answered-grounded",
    description: "In-corpus query produces a verified, span-cited answer.",
    query: "net sales for the quarter",
    generator: groundedGenerator,
    verifier: new ScriptedVerifier(),
    assertions: [
      { kind: "output-field", path: "verdict", op: "equals", value: "answered" },
      { kind: "output-field", path: "allClaimsSupported", op: "equals", value: true },
      { kind: "output-field", path: "citationsResolved", op: "equals", value: true },
      { kind: "output-field", path: "verificationVerdict", op: "equals", value: "supported" },
      { kind: "tool-call-order", tools: ["retrieve", "generate", "verify"] },
      { kind: "cost-budget", maxUsd: 0.05 },
      { kind: "step-budget", maxSteps: 5 },
    ],
  },
  {
    id: "refused-out-of-corpus",
    description: "Out-of-corpus query is refused before generation.",
    query: "photosynthesis chlorophyll mitochondria xylophone",
    generator: groundedGenerator,
    verifier: new ScriptedVerifier(),
    assertions: [
      { kind: "output-field", path: "verdict", op: "equals", value: "refused" },
      { kind: "output-field", path: "refusalReason", op: "equals", value: "low_retrieval_score" },
      { kind: "tool-not-called", tool: "generate" },
      { kind: "tool-not-called", tool: "verify" },
    ],
  },
  {
    id: "refused-fabricated-citation",
    description: "An answer citing an unretrieved chunk is refused.",
    query: "risk factors actuators",
    // The regression swaps in a generator that cites a real chunk, so the
    // fabrication check no longer trips and the system wrongly answers.
    generator: INJECT ? groundedGenerator : fabricatingGenerator,
    verifier: new ScriptedVerifier(),
    assertions: [
      { kind: "output-field", path: "verdict", op: "equals", value: "refused" },
      {
        kind: "output-field",
        path: "refusalReason",
        op: "equals",
        value: "citation_precheck_failed",
      },
    ],
  },
  {
    id: "refused-unverified",
    description: "A claim the verifier cannot confirm is refused.",
    query: "net sales for the quarter",
    generator: groundedGenerator,
    verifier: skepticVerifier,
    assertions: [
      { kind: "output-field", path: "verdict", op: "equals", value: "refused" },
      { kind: "output-field", path: "refusalReason", op: "equals", value: "unverified_claims" },
      { kind: "output-field", path: "verificationVerdict", op: "equals", value: "unsupported" },
    ],
  },
];

// The assertion-friendly summary of a governed answer that becomes the cassette
// output. Flat, so assertions use simple dot paths.
function summarizeOutput(result: GovernedAnswer) {
  const claims = result.claims ?? [];
  return {
    verdict: result.verdict,
    refusalReason: result.refusalReason ?? null,
    answerPresent: result.verdict === "answered",
    claimCount: claims.length,
    allClaimsSupported: claims.length > 0 && claims.every((c) => c.supported),
    citationsResolved:
      claims.length > 0 &&
      claims.every((c) => c.citations.some((cit) => cit.chunkFound && cit.quoteFound)),
    verificationVerdict: result.verification?.verdict ?? null,
    company: result.retrieved[0]?.company ?? null,
  };
}

// Which pipeline steps ran, as an AgentProbe tool_call trace.
function buildTrace(result: GovernedAnswer) {
  const steps =
    result.verdict === "refused" && result.refusalReason === "low_retrieval_score"
      ? ["retrieve"]
      : ["retrieve", "generate", "verify"];
  return steps.map((name) => ({ type: "tool_call", call: { name, args: {}, result: {} } }));
}

async function main() {
  // Ingest fixtures into an in-memory index.
  const embedder = new FakeEmbedder({ dimensions: DIMENSIONS });
  const db = openDatabase({ path: ":memory:", dimensions: DIMENSIONS });
  const repository = new Repository(db);
  const auditLog = new AuditLog(db);

  const index = JSON.parse(readFileSync(path.join(fixturesDir, "index.json"), "utf8")) as {
    filings: Array<{ file: string; meta: unknown }>;
  };
  for (const entry of index.filings) {
    const html = readFileSync(path.join(fixturesDir, entry.file), "utf8");
    await ingestFiling(
      { html, meta: filingMetaSchema.parse(entry.meta) },
      { embedder, repository, now: () => FIXED_TIME },
    );
  }

  const retriever = new HybridRetriever({ repository, embedder });

  mkdirSync(cassetteDir, { recursive: true });

  for (const c of cases) {
    const result = await answerQuery(c.query, {
      retriever,
      generator: c.generator,
      verifier: c.verifier,
      auditLog,
      now: () => FIXED_TIME,
      requestId: () => c.id,
    });

    const trace = buildTrace(result);
    const cassette = {
      version: 1,
      caseId: c.id,
      agent: "governed-rag",
      recordedAt: FIXED_TIME,
      input: { query: c.query },
      result: {
        output: summarizeOutput(result),
        trace,
        // Deterministic metrics: scripted runs cost nothing; steps is the trace
        // length; latency is fixed so cassettes are byte-stable across runs.
        metrics: { latencyMs: 1, costUsd: result.usage.costUsd, steps: trace.length },
      },
    };
    writeFileSync(
      path.join(cassetteDir, `${c.id}.json`),
      `${JSON.stringify(cassette, null, 2)}\n`,
    );
  }

  const suite = {
    name: "governed-rag-eval",
    cases: cases.map((c) => ({
      id: c.id,
      description: c.description,
      input: { query: c.query },
      assertions: c.assertions,
    })),
  };
  writeFileSync(path.join(here, "suite.json"), `${JSON.stringify(suite, null, 2)}\n`);

  // No rubrics, so the judge cache stays empty and replay needs no key.
  writeFileSync(path.join(here, "judge-cache.json"), `${JSON.stringify({}, null, 2)}\n`);

  const mode = INJECT ? " (REGRESSION INJECTED)" : "";
  process.stdout.write(`wrote ${cases.length} cassettes and suite.json${mode}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
