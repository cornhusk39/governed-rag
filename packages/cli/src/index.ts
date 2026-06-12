#!/usr/bin/env node
// Governed RAG command line. This is the live self-host driver: it builds the
// real collaborators (Voyage embeddings, Anthropic generation and verification,
// SQLite) from the environment and runs the dependency-injected commands. Keys
// come from the environment only. The read-only web demo never runs this; it
// reads an exported snapshot instead.

import { readFileSync, writeFileSync } from "node:fs";

import {
  AnthropicGenerator,
  AnthropicVerifier,
  AuditLog,
  FakeEmbedder,
  HybridRetriever,
  Repository,
  VoyageEmbedder,
  openDatabase,
  openExistingDatabase,
  type Embedder,
} from "@governed-rag/core";

import { parseArgs, requireFlag } from "./args.js";
import { runExport, runIngest, runQuery } from "./commands.js";
import { startTelemetry } from "./telemetry.js";

export const CLI_VERSION = "0.1.0";

const DEFAULT_DB_PATH = "./data/governed-rag.db";

function dbPath(flags: Record<string, string | boolean>): string {
  const fromFlag = flags.db;
  if (typeof fromFlag === "string") {
    return fromFlag;
  }
  return process.env.GOVERNED_RAG_DB_PATH ?? DEFAULT_DB_PATH;
}

// The embedder for ingest and query. A real run uses Voyage; --fake-embeddings is
// a deterministic, key-free option for local development against fixtures.
function buildEmbedder(flags: Record<string, string | boolean>): Embedder {
  if (flags["fake-embeddings"]) {
    return new FakeEmbedder({ dimensions: 256 });
  }
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is not set (or pass --fake-embeddings for local dev)");
  }
  return new VoyageEmbedder({ apiKey });
}

async function dispatch(argv: string[]): Promise<number> {
  const { command, positionals, flags } = parseArgs(argv);
  const log = (message: string) => process.stdout.write(`${message}\n`);

  if (command === undefined || command === "--version" || command === "-v") {
    log(`governed-rag cli ${CLI_VERSION}`);
    return 0;
  }

  switch (command) {
    case "ingest": {
      const file = positionals[0] ?? requireFlag(flags, "file");
      const embedder = buildEmbedder(flags);
      const db = openDatabase({ path: dbPath(flags), dimensions: embedder.dimensions });
      const repository = new Repository(db);
      await runIngest(
        {
          html: readFileSync(file, "utf8"),
          meta: {
            cik: requireFlag(flags, "cik"),
            accession: requireFlag(flags, "accession"),
            company: requireFlag(flags, "company"),
            form: requireFlag(flags, "form") as "10-K" | "10-Q",
            filingDate: requireFlag(flags, "filing-date"),
          },
        },
        { repository, embedder, now: () => new Date().toISOString(), log },
      );
      db.close();
      return 0;
    }

    case "query": {
      const query = positionals[0] ?? requireFlag(flags, "query");
      const embedder = buildEmbedder(flags);
      const db = openDatabase({ path: dbPath(flags), dimensions: embedder.dimensions });
      const repository = new Repository(db);
      const auditLog = new AuditLog(db);
      const retriever = new HybridRetriever({ repository, embedder });
      const generator = new AnthropicGenerator({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
      const verifier = new AnthropicVerifier({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
      const result = await runQuery(
        { query },
        { answerDeps: { retriever, generator, verifier, auditLog }, log },
      );
      db.close();
      // A refusal is a valid governed outcome, not a CLI error.
      return result.verdict === "answered" || result.verdict === "refused" ? 0 : 1;
    }

    case "export": {
      const outPath = positionals[0] ?? requireFlag(flags, "out");
      const db = openExistingDatabase(dbPath(flags));
      const repository = new Repository(db);
      const auditLog = new AuditLog(db);
      runExport(
        { outPath },
        {
          repository,
          auditLog,
          now: () => new Date().toISOString(),
          writeFile: (path, contents) => writeFileSync(path, contents),
          log,
        },
      );
      db.close();
      return 0;
    }

    default:
      process.stderr.write(`unknown command: ${command}\n`);
      process.stderr.write("commands: ingest, query, export\n");
      return 1;
  }
}

// Exported for testing the dispatcher wiring without spawning a process.
export { dispatch };

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  // Start tracing before any pipeline work so spans are exported, and flush on the
  // way out. A no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
  const telemetry = startTelemetry();
  dispatch(process.argv.slice(2))
    .then(async (code) => {
      await telemetry.shutdown();
      process.exit(code);
    })
    .catch(async (error: unknown) => {
      await telemetry.shutdown();
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
