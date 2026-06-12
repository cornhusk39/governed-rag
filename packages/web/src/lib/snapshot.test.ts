import { describe, expect, it } from "vitest";

import type { DemoSnapshot } from "@governed-rag/core";

import { auditTotals, filterAudit, getAuditRecord, listDocuments } from "./snapshot.js";

// A compact snapshot covering both verdicts and two documents.
const snapshot = {
  generatedAt: "2026-06-12T00:00:00Z",
  filings: [
    { cik: "1", accession: "acc-a", company: "Alpha Co", form: "10-K", filingDate: "2026-01-01" },
    { cik: "2", accession: "acc-b", company: "Beta Co", form: "10-Q", filingDate: "2026-02-01" },
  ],
  canonicalTexts: { "acc-a": "alpha text", "acc-b": "beta text" },
  audit: [
    {
      requestId: "r1",
      createdAt: "2026-06-12T10:00:00Z",
      query: "alpha revenue growth",
      verdict: "answered",
      retrieved: [{ accession: "acc-a", company: "Alpha Co" }],
      costUsd: 0.002,
    },
    {
      requestId: "r2",
      createdAt: "2026-06-10T10:00:00Z",
      query: "unrelated trivia",
      verdict: "refused",
      retrieved: [{ accession: "acc-a", company: "Alpha Co" }],
      costUsd: 0,
    },
    {
      requestId: "r3",
      createdAt: "2026-06-11T10:00:00Z",
      query: "beta margins",
      verdict: "answered",
      retrieved: [{ accession: "acc-b", company: "Beta Co" }],
      costUsd: 0.003,
    },
  ],
} as unknown as DemoSnapshot;

describe("filterAudit", () => {
  it("filters by verdict", () => {
    expect(filterAudit(snapshot, { verdict: "answered" }).map((r) => r.requestId)).toEqual([
      "r1",
      "r3",
    ]);
  });

  it("filters by query substring, case-insensitively", () => {
    expect(filterAudit(snapshot, { query: "ALPHA" }).map((r) => r.requestId)).toEqual(["r1"]);
  });

  it("filters by retrieved document accession", () => {
    expect(filterAudit(snapshot, { accession: "acc-b" }).map((r) => r.requestId)).toEqual(["r3"]);
  });

  it("filters by date range", () => {
    const got = filterAudit(snapshot, { since: "2026-06-11T00:00:00Z" }).map((r) => r.requestId);
    expect(got.sort()).toEqual(["r1", "r3"]);
  });
});

describe("getAuditRecord", () => {
  it("finds a record by request id", () => {
    expect(getAuditRecord(snapshot, "r3")?.query).toBe("beta margins");
  });
  it("returns undefined for an unknown id", () => {
    expect(getAuditRecord(snapshot, "nope")).toBeUndefined();
  });
});

describe("listDocuments and auditTotals", () => {
  it("lists the filings", () => {
    expect(listDocuments(snapshot).map((d) => d.accession)).toEqual(["acc-a", "acc-b"]);
  });

  it("computes totals including summed cost", () => {
    const totals = auditTotals(snapshot.audit);
    expect(totals).toEqual({ total: 3, answered: 2, refused: 1, totalCostUsd: 0.005 });
  });
});
