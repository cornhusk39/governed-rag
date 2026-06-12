// The demo snapshot: a self-contained, read-only export of everything the web UI
// needs, with no database and no keys.
//
// The public demo is the governance trail, not a live model. Rather than ship a
// SQLite file and a native driver to the browser host, we export a JSON snapshot:
// the audit log (recorded query sessions), the filing metadata, and the canonical
// texts that citation spans resolve against. The web app reads this and nothing
// else, which is what makes the hosted demo safe to deploy with no secrets.

import type { AuditLog, AuditRecord } from "./store/audit.js";
import type { Repository } from "./store/repository.js";

export interface SnapshotFiling {
  cik: string;
  accession: string;
  company: string;
  form: string;
  filingDate: string;
}

export interface DemoSnapshot {
  generatedAt: string;
  filings: SnapshotFiling[];
  // Accession to canonical (redacted) filing text, so the UI can show a cited
  // span highlighted in its surrounding context.
  canonicalTexts: Record<string, string>;
  // Recorded query sessions, newest first.
  audit: AuditRecord[];
}

export interface BuildSnapshotOptions {
  // Injected so the snapshot is reproducible; pass a fixed value in tests.
  generatedAt: string;
  // Cap on how many audit rows to include.
  auditLimit?: number;
}

export function buildSnapshot(
  repository: Repository,
  auditLog: AuditLog,
  options: BuildSnapshotOptions,
): DemoSnapshot {
  const filings = repository.listFilings();
  const canonicalTexts: Record<string, string> = {};
  for (const filing of filings) {
    const text = repository.getCanonicalText(filing.accession);
    if (text !== undefined) {
      canonicalTexts[filing.accession] = text;
    }
  }

  return {
    generatedAt: options.generatedAt,
    filings,
    canonicalTexts,
    audit: auditLog.list({ limit: options.auditLimit ?? 1000 }),
  };
}
