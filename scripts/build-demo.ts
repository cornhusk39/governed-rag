// Build the demo snapshot from REAL SEC EDGAR filings.
//
// This live-fetches the latest 10-Q for a handful of well-known companies
// (respecting EDGAR fair-access: a declared User-Agent and a polite request
// rate), runs them through the real ingest pipeline, records a set of query
// sessions, and exports the read-only snapshot the web demo serves.
//
// Embeddings use the deterministic local embedder and generation/verification use
// scripted stand-ins, so this needs no API keys: the demo shows real filing text,
// real provenance, and real span-level citations, with deterministic answers. The
// live path with Voyage embeddings and Anthropic generation is the operator step
// documented in the README.
//
// Run with: EDGAR_USER_AGENT="you you@example.com" pnpm exec tsx scripts/build-demo.ts

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AuditLog,
  EdgarClient,
  FakeEmbedder,
  HybridRetriever,
  Repository,
  ScriptedGenerator,
  ScriptedVerifier,
  answerQuery,
  ingestFiling,
  openDatabase,
  type DemoSnapshot,
  type FilingForm,
  type GenerationInput,
  type GovernedAnswer,
} from "../packages/core/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const outPath = path.join(repoRoot, "packages", "web", "data", "sample-snapshot.json");

const DIMENSIONS = 256;
const NOW = "2026-06-12T12:00:00.000Z";

// Well-known issuers. CIKs are zero-padded to 10 digits as EDGAR expects.
const COMPANIES = [
  { cik: "0000320193", name: "Apple Inc." },
  { cik: "0000789019", name: "Microsoft Corporation" },
  { cik: "0001045810", name: "NVIDIA Corporation" },
  { cik: "0001018724", name: "Amazon.com, Inc." },
  { cik: "0001652044", name: "Alphabet Inc." },
];

// A generator that grounds its answer in the top retrieved chunk by quoting a
// clean sentence from it. Deterministic; no model.
function groundedGenerator() {
  return new ScriptedGenerator({
    respond: (input: GenerationInput) => {
      const top = input.chunks[0]!;
      const quote = firstSentence(top.text);
      return {
        answer: `Per ${top.provenance.company} (${top.provenance.sectionLabel}): ${quote}`,
        claims: [{ text: quote, chunk_ids: [top.chunkId], quote }],
      };
    },
  });
}

// Pick a reasonably clean sentence-ish slice from a chunk to use as the quote.
function firstSentence(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const end = trimmed.indexOf(". ");
  const slice = end > 40 ? trimmed.slice(0, end + 1) : trimmed.slice(0, 160);
  return slice.trim();
}

async function main() {
  const userAgent = process.env.EDGAR_USER_AGENT ?? "governed-rag-demo demo@example.com";
  const edgar = new EdgarClient({ userAgent });

  const db = openDatabase({ path: ":memory:", dimensions: DIMENSIONS });
  const repository = new Repository(db);
  const auditLog = new AuditLog(db);
  const embedder = new FakeEmbedder({ dimensions: DIMENSIONS });

  // 1. Live ingest: latest 10-Q per company.
  for (const company of COMPANIES) {
    const filings = await edgar.listRecentFilings(company.cik);
    const latest = filings.find((f) => f.form === "10-Q") ?? filings[0];
    if (!latest) {
      process.stderr.write(`no 10-K/10-Q found for ${company.name}\n`);
      continue;
    }
    const html = await edgar.fetchDocument(company.cik, latest.accession, latest.primaryDocument);
    const result = await ingestFiling(
      {
        html,
        meta: {
          cik: company.cik,
          accession: latest.accession,
          company: company.name,
          form: latest.form as FilingForm,
          filingDate: latest.filingDate,
        },
      },
      { embedder, repository, now: () => NOW },
    );
    process.stdout.write(
      `ingested ${company.name} ${latest.form} ${latest.accession}: ` +
        `${result.sectionCount} sections, ${result.chunkCount} chunks, ` +
        `${result.redactionHits.length} redactions\n`,
    );
  }

  const retriever = new HybridRetriever({ repository, embedder });

  // 2. Record query sessions. Most are in-corpus; one is deliberately out of
  // corpus to show a governed refusal.
  // A curated set that exercises both outcomes under the SAME default refusal
  // gate (no per-query tuning). The in-corpus queries clear the gate because the
  // cited chunk ranks in both the vector and keyword lists, which also means it
  // genuinely contains the query terms. The last query has no overlap with any
  // filing, so the gate refuses it before generation.
  //
  // Note: the deterministic local embedder used here (no API key) is not built
  // for semantic ranking, so only queries that closely echo filing language
  // clear the gate. With the Voyage embeddings of the live/self-host path,
  // retrieval is semantic and the gate generalizes. See the README.
  const queries: string[] = [
    "total net sales increased",
    "research and development expenses",
    "gross margin percentage",
    "income taxes provision effective tax rate",
    "photosynthesis chlorophyll mitochondria ribosome",
  ];

  let counter = 0;
  const results: GovernedAnswer[] = [];
  for (const q of queries) {
    counter += 1;
    const result = await answerQuery(q, {
      retriever,
      generator: groundedGenerator(),
      verifier: new ScriptedVerifier(),
      auditLog,
      now: () => NOW,
      requestId: () => `demo-${counter}`,
    });
    results.push(result);
    process.stdout.write(`query "${q.slice(0, 40)}..." -> ${result.verdict}\n`);
  }

  // 3. Assemble the snapshot. Include canonical text only for filings actually
  // cited by a recorded session, to keep the committed snapshot small.
  const citedAccessions = new Set<string>();
  for (const r of results) {
    for (const claim of r.claims ?? []) {
      for (const citation of claim.citations) {
        if (citation.provenance) {
          citedAccessions.add(citation.provenance.accession);
        }
      }
    }
  }

  const filings = repository.listFilings();
  const canonicalTexts: Record<string, string> = {};
  for (const accession of citedAccessions) {
    const text = repository.getCanonicalText(accession);
    if (text) {
      canonicalTexts[accession] = text;
    }
  }

  const snapshot: DemoSnapshot = {
    generatedAt: NOW,
    filings,
    canonicalTexts,
    audit: auditLog.list({ limit: 1000 }),
  };

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  const bytes = JSON.stringify(snapshot).length;
  process.stdout.write(
    `\nwrote ${outPath}\n` +
      `${filings.length} filings, ${Object.keys(canonicalTexts).length} canonical texts, ` +
      `${snapshot.audit.length} audit records, ${(bytes / 1024).toFixed(0)} KB\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
