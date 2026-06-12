import { notFound } from "next/navigation";

import { AnswerView } from "@/components/AnswerView";
import { getAuditRecord } from "@/lib/snapshot";
import { loadSnapshot } from "@/server/snapshot";

// The full lineage of one governed query: the answer with span-highlighted
// citations, the retrieved context with its scores, and the run metadata
// (models, cost, latency).
export default async function AuditDetail({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  const snapshot = loadSnapshot();
  const record = getAuditRecord(snapshot, requestId);
  if (!record) {
    notFound();
  }

  const retrieved =
    (record.retrieved as Array<{
      chunkId: string;
      company?: string;
      sectionLabel?: string;
      rrf?: number;
      vectorRank?: number;
      keywordRank?: number;
      vectorDistance?: number;
    }> | null) ?? [];

  return (
    <main>
      <p>
        <a href="/audit">← Audit log</a>
      </p>
      <h1>{record.query}</h1>

      <AnswerView record={record} snapshot={snapshot} />

      <h2>Run metadata</h2>
      <dl className="kv">
        <dt>Request id</dt>
        <dd className="mono">{record.requestId}</dd>
        <dt>Timestamp</dt>
        <dd>{record.createdAt}</dd>
        <dt>Embedder</dt>
        <dd className="mono">{record.embedderId}</dd>
        <dt>Generation model</dt>
        <dd className="mono">{record.generationModel ?? "—"}</dd>
        <dt>Verifier</dt>
        <dd className="mono">{record.verifierId ?? "—"}</dd>
        <dt>Cost</dt>
        <dd className="mono">${record.costUsd.toFixed(6)}</dd>
        <dt>Latency</dt>
        <dd className="mono">{record.latencyMs}ms</dd>
      </dl>

      <h2>Retrieved context</h2>
      <div className="table-scroll">
        <table>
        <thead>
          <tr>
            <th>Chunk</th>
            <th>Document / section</th>
            <th>RRF</th>
            <th>Vector</th>
            <th>Keyword</th>
          </tr>
        </thead>
        <tbody>
          {retrieved.map((c) => (
            <tr key={c.chunkId}>
              <td className="mono">{c.chunkId}</td>
              <td>
                {c.company} · {c.sectionLabel}
              </td>
              <td className="mono">{c.rrf?.toFixed(4) ?? "—"}</td>
              <td className="mono">
                {c.vectorRank ? `#${c.vectorRank}` : "—"}
                {c.vectorDistance !== undefined ? ` (${c.vectorDistance.toFixed(2)})` : ""}
              </td>
              <td className="mono">{c.keywordRank ? `#${c.keywordRank}` : "—"}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </main>
  );
}
