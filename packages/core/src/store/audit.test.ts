import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "./db.js";
import { AuditLog, type AuditRecordInput } from "./audit.js";
import type { DatabaseHandle } from "./types.js";

function record(overrides: Partial<AuditRecordInput> = {}): AuditRecordInput {
  return {
    requestId: "req-1",
    createdAt: "2026-06-12T10:00:00.000Z",
    query: "net sales",
    verdict: "answered",
    answer: "Net sales rose.",
    retrieved: [{ chunkId: "c1", rrf: 0.03 }],
    claims: [{ text: "Net sales rose.", verified: true }],
    verification: { verdict: "supported" },
    embedderId: "fake-hash-v1:256",
    generationModel: "scripted-generator",
    verifierId: "scripted-verifier",
    costUsd: 0.0012,
    latencyMs: 42,
    ...overrides,
  };
}

describe("AuditLog", () => {
  let db: DatabaseHandle;
  let audit: AuditLog;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:", dimensions: 64 });
    audit = new AuditLog(db);
  });

  it("appends a record and reads back the full lineage by request id", () => {
    audit.append(record());
    const got = audit.getByRequestId("req-1")!;
    expect(got.verdict).toBe("answered");
    expect(got.answer).toBe("Net sales rose.");
    // Structured fields round-trip through JSON.
    expect(got.retrieved).toEqual([{ chunkId: "c1", rrf: 0.03 }]);
    expect(got.verification).toEqual({ verdict: "supported" });
    expect(got.costUsd).toBeCloseTo(0.0012, 6);
  });

  it("stores refusals with a reason and null answer", () => {
    audit.append(
      record({
        requestId: "req-2",
        verdict: "refused",
        refusalReason: "low_retrieval_score",
        answer: null,
        claims: undefined,
        verification: undefined,
        generationModel: null,
        verifierId: null,
        costUsd: 0,
      }),
    );
    const got = audit.getByRequestId("req-2")!;
    expect(got.verdict).toBe("refused");
    expect(got.refusalReason).toBe("low_retrieval_score");
    expect(got.answer).toBeNull();
    expect(got.claims).toBeNull();
  });

  it("filters by verdict, date, and query substring, newest first", () => {
    audit.append(record({ requestId: "a", createdAt: "2026-06-10T00:00:00Z", query: "apple revenue" }));
    audit.append(record({ requestId: "b", createdAt: "2026-06-11T00:00:00Z", query: "risk factors", verdict: "refused", refusalReason: "no_claims" }));
    audit.append(record({ requestId: "c", createdAt: "2026-06-12T00:00:00Z", query: "apple margins" }));

    expect(audit.list({ verdict: "answered" }).map((r) => r.requestId)).toEqual(["c", "a"]);
    expect(audit.list({ queryContains: "apple" }).map((r) => r.requestId)).toEqual(["c", "a"]);
    expect(audit.list({ since: "2026-06-11T00:00:00Z" }).map((r) => r.requestId)).toEqual(["c", "b"]);
    expect(audit.count()).toBe(3);
  });

  it("treats LIKE wildcards in the query filter as literal characters", () => {
    audit.append(record({ requestId: "p1", query: "100% margin growth" }));
    audit.append(record({ requestId: "p2", query: "revenue and margin" }));
    // "100%" must match only the literal record, not act as a wildcard.
    expect(audit.list({ queryContains: "100%" }).map((r) => r.requestId)).toEqual(["p1"]);
    // A bare "%" would match everything if unescaped; it should match nothing.
    expect(audit.list({ queryContains: "z%z" })).toHaveLength(0);
  });

  it("enforces unique request ids (append-only, no overwrite)", () => {
    audit.append(record({ requestId: "dup" }));
    expect(() => audit.append(record({ requestId: "dup" }))).toThrow();
  });

  it("exposes no update or delete methods", () => {
    // Audit integrity: the only write path is append.
    const proto = AuditLog.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.append).toBe("function");
    expect(proto.update).toBeUndefined();
    expect(proto.delete).toBeUndefined();
    expect(proto.remove).toBeUndefined();
  });
});
