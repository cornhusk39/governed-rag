// Renders a governed answer: the prose, then each claim with the source spans it
// is grounded in. Refusals render their reason instead. The data comes straight
// from an audit record, so what you see is exactly what was recorded.

import type { AnsweredClaim, AuditRecord, DemoSnapshot, VerificationResult } from "@governed-rag/core";

import { getCanonicalText } from "@/lib/snapshot";

import { CitationContext } from "./CitationContext";

// The audit log stores claims and verification as opaque JSON. We own the shape
// (the pipeline wrote it), so we narrow it here for rendering.
function asClaims(value: unknown): AnsweredClaim[] {
  return Array.isArray(value) ? (value as AnsweredClaim[]) : [];
}
function asVerification(value: unknown): VerificationResult | null {
  return value && typeof value === "object" ? (value as VerificationResult) : null;
}

export function AnswerView({
  record,
  snapshot,
}: {
  record: AuditRecord;
  snapshot: DemoSnapshot;
}) {
  if (record.verdict === "refused") {
    return (
      <div className="card">
        <span className="badge refused">refused</span>
        <p style={{ marginTop: "0.7rem" }}>
          This question is not supported by the available corpus.
        </p>
        <p className="muted">
          Reason: <span className="mono">{record.refusalReason}</span>
        </p>
      </div>
    );
  }

  const claims = asClaims(record.claims);
  const verification = asVerification(record.verification);

  return (
    <div>
      <div className="card">
        <span className="badge answered">answered</span>
        {verification ? (
          <span className="muted" style={{ marginLeft: "0.6rem", fontSize: "0.85rem" }}>
            verification: {verification.verdict}
          </span>
        ) : null}
        <p style={{ marginTop: "0.7rem", fontSize: "1.05rem" }}>{record.answer}</p>
      </div>

      <h2>Claims and evidence</h2>
      {claims.length === 0 ? <p className="muted">No claims recorded.</p> : null}
      {claims.map((claim, i) => (
        <div key={i} className={`claim ${claim.supported ? "verified" : "unverified"}`}>
          <p style={{ margin: "0 0 0.4rem" }}>{claim.text}</p>
          {claim.citations.map((citation, j) => {
            if (!citation.span || !citation.provenance) {
              return (
                <p key={j} className="muted" style={{ fontSize: "0.85rem" }}>
                  Citation to {citation.chunkId} did not resolve to a span.
                </p>
              );
            }
            const text = getCanonicalText(snapshot, citation.provenance.accession);
            if (!text) {
              return (
                <p key={j} className="muted" style={{ fontSize: "0.85rem" }}>
                  Source text for {citation.provenance.accession} is unavailable in this snapshot.
                </p>
              );
            }
            return (
              <CitationContext
                key={j}
                canonicalText={text}
                startOffset={citation.span.startOffset}
                endOffset={citation.span.endOffset}
                label={`${citation.provenance.company} · ${citation.provenance.sectionLabel}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
