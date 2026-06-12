import { filterAudit } from "@/lib/snapshot";
import { loadSnapshot } from "@/server/snapshot";

// The query interface. In the read-only demo this lists recorded query sessions
// over the seeded index; clicking one opens the governed answer with its
// span-highlighted citations. Live querying is the self-host path (the CLI), so
// no generation route or API key is exposed here.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const snapshot = loadSnapshot();
  const records = filterAudit(snapshot, { query: q });

  return (
    <main>
      <h1>Governed RAG</h1>
      <p className="muted">
        RAG you could defend to a compliance officer. Every answer is traced to source
        text with character-level citations, verified for groundedness, and recorded in
        an audit log. This is a read-only demo over recorded query sessions; live
        querying runs via the self-hosted CLI.
      </p>

      <form method="get" className="filters">
        <label>
          Search recorded questions
          <input type="text" name="q" defaultValue={q ?? ""} placeholder="e.g. net sales" />
        </label>
        <button type="submit">Search</button>
      </form>

      <h2>Recorded queries</h2>
      {records.length === 0 ? <p className="muted">No matching queries.</p> : null}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Question</th>
              <th>Verdict</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.requestId}>
                <td>
                  <a href={`/audit/${r.requestId}`}>{r.query}</a>
                </td>
                <td>
                  <span className={`badge ${r.verdict}`}>{r.verdict}</span>
                </td>
                <td className="muted">{r.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
