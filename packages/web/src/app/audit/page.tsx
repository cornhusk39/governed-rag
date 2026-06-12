import { auditTotals, filterAudit, listDocuments, type AuditFilters } from "@/lib/snapshot";
import { loadSnapshot } from "@/server/snapshot";

// The audit log explorer: filter recorded queries by verdict, document, text, and
// date, and see the cost. Each row links to the full lineage.
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const snapshot = loadSnapshot();

  const verdict = sp.verdict === "answered" || sp.verdict === "refused" ? sp.verdict : undefined;
  const filters: AuditFilters = {
    verdict,
    query: sp.q,
    accession: sp.accession,
    since: sp.since,
    until: sp.until,
  };
  const records = filterAudit(snapshot, filters);
  const totals = auditTotals(records);
  const documents = listDocuments(snapshot);

  return (
    <main>
      <h1>Audit log</h1>
      <p className="muted">
        {totals.total} record(s) · {totals.answered} answered · {totals.refused} refused ·
        total cost ${totals.totalCostUsd.toFixed(4)}
      </p>

      <form method="get" className="filters">
        <label>
          Verdict
          <select name="verdict" defaultValue={verdict ?? ""}>
            <option value="">Any</option>
            <option value="answered">Answered</option>
            <option value="refused">Refused</option>
          </select>
        </label>
        <label>
          Document
          <select name="accession" defaultValue={sp.accession ?? ""}>
            <option value="">Any</option>
            {documents.map((d) => (
              <option key={d.accession} value={d.accession}>
                {d.company} {d.form} ({d.filingDate})
              </option>
            ))}
          </select>
        </label>
        <label>
          Query contains
          <input type="text" name="q" defaultValue={sp.q ?? ""} />
        </label>
        <label>
          Since
          <input type="date" name="since" defaultValue={sp.since ?? ""} />
        </label>
        <label>
          Until
          <input type="date" name="until" defaultValue={sp.until ?? ""} />
        </label>
        <button type="submit">Filter</button>
      </form>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Verdict</th>
              <th>Query</th>
              <th>Document</th>
              <th>Cost</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const retrieved = (r.retrieved as Array<{ company?: string }> | null) ?? [];
              // For an answered query the cited document is meaningful; a refused
              // query did not answer from any document, so show a dash.
              const doc = r.verdict === "answered" ? (retrieved[0]?.company ?? "—") : "—";
              return (
                <tr key={r.requestId}>
                  <td className="muted">{r.createdAt.slice(0, 10)}</td>
                  <td>
                    <span className={`badge ${r.verdict}`}>{r.verdict}</span>
                  </td>
                  <td>
                    <a href={`/audit/${r.requestId}`}>{r.query}</a>
                  </td>
                  <td className="muted">{doc}</td>
                  <td className="mono">${r.costUsd.toFixed(5)}</td>
                  <td className="mono">{r.latencyMs}ms</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
