// Pure query helpers over the read-only demo snapshot.
//
// The web app never touches a database; it reads the snapshot the CLI exported
// and answers the explorer's questions in memory. These functions are the data
// layer, kept pure and framework-free so they are easy to test.

import type { AuditRecord, DemoSnapshot, SnapshotFiling } from "@governed-rag/core";

// Re-export the core types the UI consumes, so components import them from here.
export type { AuditRecord, DemoSnapshot, SnapshotFiling };

export interface AuditFilters {
  verdict?: "answered" | "refused";
  // Substring match on the query text (case-insensitive).
  query?: string;
  // Filter to records that retrieved from a given filing accession.
  accession?: string;
  since?: string;
  until?: string;
}

function recordTouchesAccession(record: AuditRecord, accession: string): boolean {
  const retrieved = record.retrieved as Array<{ accession?: string }> | null;
  if (!Array.isArray(retrieved)) {
    return false;
  }
  return retrieved.some((r) => r.accession === accession);
}

export function filterAudit(snapshot: DemoSnapshot, filters: AuditFilters = {}): AuditRecord[] {
  const query = filters.query?.toLowerCase();
  return snapshot.audit.filter((record) => {
    if (filters.verdict && record.verdict !== filters.verdict) {
      return false;
    }
    if (query && !record.query.toLowerCase().includes(query)) {
      return false;
    }
    if (filters.accession && !recordTouchesAccession(record, filters.accession)) {
      return false;
    }
    if (filters.since && record.createdAt < filters.since) {
      return false;
    }
    if (filters.until && record.createdAt > filters.until) {
      return false;
    }
    return true;
  });
}

export function getAuditRecord(snapshot: DemoSnapshot, requestId: string): AuditRecord | undefined {
  return snapshot.audit.find((r) => r.requestId === requestId);
}

export function getCanonicalText(snapshot: DemoSnapshot, accession: string): string | undefined {
  return snapshot.canonicalTexts[accession];
}

// The set of filings, for the document filter dropdown.
export function listDocuments(snapshot: DemoSnapshot): SnapshotFiling[] {
  return snapshot.filings;
}

// Aggregate numbers for the explorer header.
export interface AuditTotals {
  total: number;
  answered: number;
  refused: number;
  totalCostUsd: number;
}

export function auditTotals(records: AuditRecord[]): AuditTotals {
  let answered = 0;
  let refused = 0;
  let totalCostUsd = 0;
  for (const r of records) {
    if (r.verdict === "answered") {
      answered++;
    } else {
      refused++;
    }
    totalCostUsd += r.costUsd;
  }
  return { total: records.length, answered, refused, totalCostUsd };
}
