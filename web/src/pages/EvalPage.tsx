import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type EvalData } from "../api";
import { pct } from "../format";

export function EvalPage() {
  const [data, setData] = useState<EvalData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.evaluation().then(setData, (e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="page"><section className="card error">{error}</section></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const { extraction, search } = data;

  return (
    <div className="page">
      <section className="card">
        <h1>Evaluation</h1>
        <p className="muted">
          How well the system does against known answers. In production the same method uses the company's own past proposals: feed in old
          RFPs and check whether the system finds the projects the estimators actually chose.
        </p>
        <p className="warning small">
          ⚠ This data is synthetic. The documents and the answer key were written together, so these scores show the pipeline works end to
          end. They are not a prediction of accuracy on real archives.
        </p>
      </section>

      <section className="card">
        <h2>Search: does it find what the company actually chose?</h2>
        {!search ? (
          <p className="muted">Not run yet. Run npm run eval:search.</p>
        ) : (
          <>
            <div className="stats">
              <Stat value={pct(search.summary.recallPicks)} label="of the company's choices were in the final picks" />
              <Stat value={pct(search.summary.recallTop5)} label="were in the ranking's top 5" />
              <Stat value={String(search.summary.droppedCitations)} label="invalid citations had to be removed" />
            </div>
            <table className="table compact">
              <thead>
                <tr>
                  <th>Past RFP</th>
                  <th>Company chose</th>
                  <th>Found</th>
                </tr>
              </thead>
              <tbody>
                {search.results.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div>{r.title}</div>
                      <div className="muted small">RFP date {r.asOf}</div>
                    </td>
                    <td>
                      {r.chosen.map((c) => (
                        <div key={c.id}>
                          {c.picked ? <span className="ok">✓</span> : <span className="no">✗</span>}{" "}
                          <Link to={`/projects/${c.id}`}>{c.name}</Link>
                        </div>
                      ))}
                    </td>
                    <td>
                      {r.hitsPicks}/{r.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="card">
        <h2>Extraction: are the catalog records right?</h2>
        {!extraction ? (
          <p className="muted">Not run yet. Run npm run eval:extraction.</p>
        ) : (
          <>
            <div className="stats">
              <Stat value={pct(extraction.overall.correct / extraction.overall.total)} label={`of ${extraction.overall.total} fields correct`} />
              <Stat value={String(extraction.emptyCount)} label="left empty because no document states them" />
              <Stat value={String(extraction.wrongCount)} label="wrong values" />
            </div>
            <div className="grid-2">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th className="num">Correct</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(extraction.perField).map(([field, v]) => (
                    <tr key={field}>
                      <td>{field}</td>
                      <td className="num">
                        {v.correct}/{v.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div>
                <div className="kicker">Wrong values</div>
                <ul className="plain small">
                  {extraction.errors
                    .filter((e) => e.kind === "wrong")
                    .map((e) => (
                      <li key={e.project + e.field}>
                        {e.project}: {e.field} extracted as <code>{String(e.extracted)}</code>, truth <code>{String(e.truth)}</code>
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}
