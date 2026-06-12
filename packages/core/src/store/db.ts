// Database setup: open SQLite, load sqlite-vec, and migrate the schema.
//
// The whole data plane is one SQLite file: relational rows, a vector index via
// sqlite-vec, and a keyword index via FTS5. That is the self-host-first promise,
// no external services to stand up. Retrieval (M2) reads these tables; here we
// only create them and prove they round-trip.

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

import type { DatabaseHandle } from "./types.js";

export interface OpenDatabaseOptions {
  // File path, or ":memory:" for ephemeral test databases.
  path: string;
  // Embedding dimensionality. The vector index is created against this and cannot
  // change without a rebuild, so we record it and refuse a mismatched reopen.
  dimensions: number;
}

// The vector table dimension is fixed at creation, so we keep the value we built
// with in a meta table and check it on reopen. A silent dimension mismatch would
// corrupt similarity search in ways that are painful to debug later.
function assertDimensions(db: DatabaseHandle, dimensions: number): void {
  const row = db
    .prepare("select value from meta where key = 'embedding_dimensions'")
    .get() as { value: string } | undefined;

  if (row === undefined) {
    db.prepare("insert into meta(key, value) values ('embedding_dimensions', ?)").run(
      String(dimensions),
    );
    return;
  }

  const existing = Number.parseInt(row.value, 10);
  if (existing !== dimensions) {
    throw new Error(
      `Embedding dimension mismatch: index was built with ${existing}, but ${dimensions} was requested. Rebuild the index.`,
    );
  }
}

function migrate(db: DatabaseHandle, dimensions: number): void {
  db.exec(`
    create table if not exists meta (
      key text primary key,
      value text not null
    );

    create table if not exists filing (
      id integer primary key,
      cik text not null,
      accession text not null unique,
      company text not null,
      form text not null,
      filing_date text not null,
      -- The canonical, extracted, PII-redacted text. Citations resolve their
      -- character offsets against this exact string, so it is the source of truth.
      canonical_text text not null,
      ingested_at text not null
    );

    create table if not exists chunk (
      id integer primary key,
      -- Deterministic id (accession plus offsets) for stable, idempotent ingest.
      chunk_uid text not null unique,
      filing_id integer not null references filing(id) on delete cascade,
      section_id text not null,
      section_label text not null,
      start_offset integer not null,
      end_offset integer not null,
      text text not null,
      embedder_id text not null
    );

    create index if not exists chunk_filing_idx on chunk(filing_id);

    -- The audit log. One row per governed query, holding the full lineage:
    -- query, retrieved chunks with scores, answer, claims with citations,
    -- verification result, model, cost, and latency. Writes are append-only by
    -- contract: the Repository exposes insert and read, never update or delete.
    create table if not exists audit (
      id integer primary key,
      request_id text not null unique,
      created_at text not null,
      query text not null,
      verdict text not null,
      refusal_reason text,
      answer text,
      retrieved_json text not null,
      claims_json text,
      verification_json text,
      embedder_id text not null,
      generation_model text,
      verifier_id text,
      cost_usd real not null,
      latency_ms integer not null
    );

    create index if not exists audit_created_idx on audit(created_at);
    create index if not exists audit_verdict_idx on audit(verdict);
  `);

  // The vector index. Its rowid is the chunk row id, so similarity hits join back
  // to chunks directly.
  db.exec(
    `create virtual table if not exists vec_chunk using vec0(embedding float[${dimensions}]);`,
  );

  // The keyword index. Standalone FTS5 over chunk text; we insert with an explicit
  // rowid matching chunk.id so keyword hits also join straight back to chunks.
  db.exec(`create virtual table if not exists fts_chunk using fts5(text);`);

  assertDimensions(db, dimensions);
}

/**
 * Open (or create) a Governed RAG database with the vector extension loaded and
 * the schema migrated. Foreign keys are enabled so cascade deletes work, which is
 * how re-ingesting a filing cleans up its old chunks.
 */
export function openDatabase(options: OpenDatabaseOptions): DatabaseHandle {
  const db = new Database(options.path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db);
  migrate(db, options.dimensions);
  return db;
}

/**
 * Open an existing Governed RAG database without knowing its embedding dimension
 * up front, reading it back from the meta table. Used by read-only and export
 * paths (query, export) that do not construct an embedder. Throws if the file is
 * not a migrated Governed RAG database.
 */
export function openExistingDatabase(path: string): DatabaseHandle {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db);

  const metaExists = db
    .prepare("select name from sqlite_master where type = 'table' and name = 'meta'")
    .get();
  const row = metaExists
    ? (db
        .prepare("select value from meta where key = 'embedding_dimensions'")
        .get() as { value: string } | undefined)
    : undefined;
  if (!row) {
    db.close();
    throw new Error(`${path} is not an initialized Governed RAG database`);
  }
  migrate(db, Number.parseInt(row.value, 10));
  return db;
}
