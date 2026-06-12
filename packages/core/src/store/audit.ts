// Append-only audit log.
//
// Audit integrity is part of the threat model: there is no update and no delete
// path here, only append and read. Every governed query writes exactly one row
// capturing its full lineage, so a reviewer can reconstruct what was asked, what
// was retrieved, what was answered, whether it was verified, and what it cost.
// The structured fields (retrieved chunks, claims, verification) are stored as
// JSON text and parsed back on read.

import type { DatabaseHandle } from "./types.js";

// What the caller hands us to record. Structured pieces are arbitrary
// JSON-serializable shapes owned by the pipeline; the audit log does not
// interpret them, it just preserves them.
export interface AuditRecordInput {
  requestId: string;
  createdAt: string;
  query: string;
  verdict: "answered" | "refused";
  refusalReason?: string | null;
  answer?: string | null;
  retrieved: unknown;
  claims?: unknown;
  verification?: unknown;
  embedderId: string;
  generationModel?: string | null;
  verifierId?: string | null;
  costUsd: number;
  latencyMs: number;
}

export interface AuditRecord {
  id: number;
  requestId: string;
  createdAt: string;
  query: string;
  verdict: "answered" | "refused";
  refusalReason: string | null;
  answer: string | null;
  retrieved: unknown;
  claims: unknown;
  verification: unknown;
  embedderId: string;
  generationModel: string | null;
  verifierId: string | null;
  costUsd: number;
  latencyMs: number;
}

export interface AuditListFilters {
  verdict?: "answered" | "refused";
  // ISO date bounds, inclusive, compared lexically against created_at.
  since?: string;
  until?: string;
  // Substring match on the query text.
  queryContains?: string;
  limit?: number;
  offset?: number;
}

interface AuditRow {
  id: number;
  request_id: string;
  created_at: string;
  query: string;
  verdict: "answered" | "refused";
  refusal_reason: string | null;
  answer: string | null;
  retrieved_json: string;
  claims_json: string | null;
  verification_json: string | null;
  embedder_id: string;
  generation_model: string | null;
  verifier_id: string | null;
  cost_usd: number;
  latency_ms: number;
}

function parseMaybe(json: string | null): unknown {
  return json === null ? null : JSON.parse(json);
}

function rowToRecord(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    requestId: row.request_id,
    createdAt: row.created_at,
    query: row.query,
    verdict: row.verdict,
    refusalReason: row.refusal_reason,
    answer: row.answer,
    retrieved: parseMaybe(row.retrieved_json),
    claims: parseMaybe(row.claims_json),
    verification: parseMaybe(row.verification_json),
    embedderId: row.embedder_id,
    generationModel: row.generation_model,
    verifierId: row.verifier_id,
    costUsd: row.cost_usd,
    latencyMs: row.latency_ms,
  };
}

export class AuditLog {
  constructor(private readonly db: DatabaseHandle) {}

  // The only write path. Returns the new row id.
  append(record: AuditRecordInput): number {
    const result = this.db
      .prepare(
        `insert into audit (
           request_id, created_at, query, verdict, refusal_reason, answer,
           retrieved_json, claims_json, verification_json, embedder_id,
           generation_model, verifier_id, cost_usd, latency_ms
         ) values (
           @requestId, @createdAt, @query, @verdict, @refusalReason, @answer,
           @retrievedJson, @claimsJson, @verificationJson, @embedderId,
           @generationModel, @verifierId, @costUsd, @latencyMs
         )`,
      )
      .run({
        requestId: record.requestId,
        createdAt: record.createdAt,
        query: record.query,
        verdict: record.verdict,
        refusalReason: record.refusalReason ?? null,
        answer: record.answer ?? null,
        retrievedJson: JSON.stringify(record.retrieved),
        claimsJson: record.claims === undefined ? null : JSON.stringify(record.claims),
        verificationJson:
          record.verification === undefined ? null : JSON.stringify(record.verification),
        embedderId: record.embedderId,
        generationModel: record.generationModel ?? null,
        verifierId: record.verifierId ?? null,
        costUsd: record.costUsd,
        latencyMs: record.latencyMs,
      });
    return Number(result.lastInsertRowid);
  }

  getByRequestId(requestId: string): AuditRecord | undefined {
    const row = this.db
      .prepare("select * from audit where request_id = ?")
      .get(requestId) as AuditRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  // Read path for the explorer UI. Filters compose with AND; results are newest
  // first.
  list(filters: AuditListFilters = {}): AuditRecord[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filters.verdict) {
      where.push("verdict = @verdict");
      params.verdict = filters.verdict;
    }
    if (filters.since) {
      where.push("created_at >= @since");
      params.since = filters.since;
    }
    if (filters.until) {
      where.push("created_at <= @until");
      params.until = filters.until;
    }
    if (filters.queryContains) {
      // Escape LIKE wildcards so a user filter containing % or _ matches those
      // characters literally rather than acting as a pattern. (Binding already
      // prevents injection; this is about correct, unsurprising results.)
      const escaped = filters.queryContains.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      where.push("query like @q escape '\\'");
      params.q = `%${escaped}%`;
    }
    const clause = where.length > 0 ? `where ${where.join(" and ")}` : "";
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const rows = this.db
      .prepare(
        `select * from audit ${clause} order by created_at desc, id desc limit @limit offset @offset`,
      )
      .all({ ...params, limit, offset }) as AuditRow[];
    return rows.map(rowToRecord);
  }

  count(): number {
    const row = this.db.prepare("select count(*) as n from audit").get() as { n: number };
    return row.n;
  }
}
