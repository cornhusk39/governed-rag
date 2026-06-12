// The CLI commands, written as dependency-injected functions so they can be
// tested offline with fakes. The live entry point (index.ts) constructs the real
// collaborators (Voyage embedder, Anthropic generator and verifier, SQLite) from
// the environment and calls these.

import {
  answerQuery,
  buildSnapshot,
  ingestFiling,
  filingMetaSchema,
  type AnswerDeps,
  type AuditLog,
  type Embedder,
  type FilingMeta,
  type GovernedAnswer,
  type Repository,
} from "@governed-rag/core";

export interface CommandIo {
  log: (message: string) => void;
}

// --- ingest ---

export interface IngestArgs {
  html: string;
  meta: FilingMeta;
}

export interface IngestDeps extends CommandIo {
  repository: Repository;
  embedder: Embedder;
  now: () => string;
}

export async function runIngest(args: IngestArgs, deps: IngestDeps): Promise<number> {
  const meta = filingMetaSchema.parse(args.meta);
  const result = await ingestFiling(
    { html: args.html, meta },
    { embedder: deps.embedder, repository: deps.repository, now: deps.now },
  );
  deps.log(
    `ingested ${meta.company} ${meta.form} (${meta.accession}): ` +
      `${result.sectionCount} sections, ${result.chunkCount} chunks, ` +
      `${result.redactionHits.length} PII redactions`,
  );
  return result.chunkCount;
}

// --- query ---

export interface QueryArgs {
  query: string;
}

export interface QueryDeps extends CommandIo {
  answerDeps: AnswerDeps;
}

export async function runQuery(args: QueryArgs, deps: QueryDeps): Promise<GovernedAnswer> {
  const result = await answerQuery(args.query, deps.answerDeps);

  deps.log(`request: ${result.requestId}`);
  deps.log(`verdict: ${result.verdict}`);
  if (result.verdict === "refused") {
    deps.log(`refused: ${result.refusalReason}`);
    deps.log(result.message);
  } else {
    deps.log("");
    deps.log(result.message);
    deps.log("");
    deps.log("claims:");
    for (const claim of result.claims ?? []) {
      const mark = claim.supported ? "+" : "-";
      deps.log(`  [${mark}] ${claim.text}`);
      for (const citation of claim.citations) {
        if (citation.span && citation.provenance) {
          deps.log(
            `      ${citation.provenance.company} ${citation.provenance.sectionLabel} ` +
              `[${citation.span.startOffset}-${citation.span.endOffset}]`,
          );
        }
      }
    }
  }
  deps.log("");
  deps.log(`cost: $${result.usage.costUsd.toFixed(6)} | latency: ${result.usage.latencyMs}ms`);
  return result;
}

// --- export (build the read-only demo snapshot) ---

export interface ExportArgs {
  outPath: string;
}

export interface ExportDeps extends CommandIo {
  repository: Repository;
  auditLog: AuditLog;
  now: () => string;
  writeFile: (path: string, contents: string) => void;
}

export function runExport(args: ExportArgs, deps: ExportDeps): number {
  const snapshot = buildSnapshot(deps.repository, deps.auditLog, { generatedAt: deps.now() });
  deps.writeFile(args.outPath, JSON.stringify(snapshot, null, 2));
  deps.log(
    `wrote snapshot to ${args.outPath}: ` +
      `${snapshot.filings.length} filings, ${snapshot.audit.length} audit records`,
  );
  return snapshot.audit.length;
}
