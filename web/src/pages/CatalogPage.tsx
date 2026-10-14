import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type CatalogRow } from "../api";
import { label, money, month } from "../format";

export function CatalogPage() {
  const [rows, setRows] = useState<CatalogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.projects().then(setRows, (e: Error) => setError(e.message));
  }, []);

  const visible = useMemo(() => {
    const q = query.toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (!reviewOnly || r.needs_review === 1) &&
        [r.name, r.client, r.sector, r.client_type, r.location, r.folder].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [rows, query, reviewOnly]);

  const flagged = (rows ?? []).filter((r) => r.needs_review === 1).length;

  return (
    <div className="page">
      <section className="card">
        <h1>Project catalog</h1>
        <p className="muted">
          One record per project, extracted by the LLM from that project's documents. Every value links back to the document it came
          from. Records with conflicting or missing key facts are flagged for a person to review.
        </p>
        <div className="form-row">
          <input className="search-input" placeholder="Filter by name, client, sector…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="small">
            <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} /> Needs review only ({flagged})
          </label>
        </div>
      </section>

      {error && <section className="card error">{error}</section>}
      {!rows && !error && <p className="muted">Loading…</p>}

      {rows && (
        <section className="card table-wrap">
          <table className="table clickable">
            <thead>
              <tr>
                <th>Project</th>
                <th>Client</th>
                <th>Client type</th>
                <th>Sector</th>
                <th className="num">Final value</th>
                <th>Completed</th>
                <th>Docs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/projects/${r.id}`)}>
                  <td>
                    <div>{r.name ?? "—"}</div>
                    <div className="muted small">{r.folder}</div>
                  </td>
                  <td>{r.client ?? "—"}</td>
                  <td>{label(r.client_type)}</td>
                  <td>{label(r.sector)}</td>
                  <td className="num">{money(r.final_value)}</td>
                  <td>{month(r.completion_date)}</td>
                  <td>{r.document_count}</td>
                  <td>{r.needs_review === 1 && <span className="badge near_miss">Review</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <p className="muted">No projects match.</p>}
        </section>
      )}
    </div>
  );
}
