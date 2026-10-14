import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Pick, type SampleRfp, type SearchResult } from "../api";
import { DocumentViewer, type DocRequest } from "../components/DocumentViewer";
import { Trace } from "../components/Trace";
import { label, money, month, STATUS_LABEL } from "../format";

const STEPS = ["Reading the RFP", "Filtering the catalog", "Ranking candidates", "Choosing and justifying"];

export function SearchPage() {
  const [samples, setSamples] = useState<SampleRfp[]>([]);
  const [rfpText, setRfpText] = useState("");
  const [asOf, setAsOf] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [doc, setDoc] = useState<DocRequest | null>(null);

  useEffect(() => {
    api.samples().then(setSamples, () => setSamples([]));
  }, []);

  // The API answers in one response, so this just walks through the step names
  // at roughly the pace the real steps take.
  useEffect(() => {
    if (!loading) return;
    setStep(0);
    const timers = [3000, 3600, 4400].map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [loading]);

  const loadSample = (s: SampleRfp) => {
    setRfpText(s.requirements);
    setAsOf(s.asOf);
    setResult(null);
    setError(null);
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.search(rfpText, asOf));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <section className="card">
        <h1>Find relevant past projects</h1>
        <p className="muted">
          Paste the "relevant experience" requirements from an RFP. The system filters the project catalog on hard limits, ranks the rest
          against the requirements, and explains each pick with citations to the source documents.
        </p>

        {samples.length > 0 && (
          <div className="samples">
            <span className="muted small">Try a past RFP:</span>
            {samples.map((s) => (
              <button key={s.id} className="chip-button" onClick={() => loadSample(s)} title={s.title}>
                {s.title.split(":")[0]}
              </button>
            ))}
          </div>
        )}

        <textarea
          value={rfpText}
          onChange={(e) => setRfpText(e.target.value)}
          placeholder="e.g. Provide three projects completed within the past seven years involving rehabilitation of highway bridges, each valued at $5,000,000 or more…"
          rows={6}
        />
        <div className="form-row">
          <label className="small">
            RFP date{" "}
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            <span className="muted"> (blank = today; projects finished after it are ignored)</span>
          </label>
          <button className="primary" onClick={run} disabled={loading || rfpText.trim().length < 20}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </section>

      {loading && (
        <section className="card progress">
          {STEPS.map((s, i) => (
            <div key={s} className={i < step ? "done" : i === step ? "active" : ""}>
              {i < step ? "✓" : i === step ? "●" : "○"} {s}
            </div>
          ))}
          <p className="muted small">Usually 10 to 20 seconds.</p>
        </section>
      )}

      {error && <section className="card error">{error}</section>}

      {result && (
        <>
          <h2>Recommended projects</h2>
          {result.picks.length === 0 && <section className="card">No suitable projects found.</section>}
          {result.picks.map((p, i) => (
            <PickCard key={p.projectId} pick={p} rank={i + 1} onCite={setDoc} />
          ))}

          <details className="card" open>
            <summary>
              <h2 className="inline">How these were chosen</h2>
            </summary>
            <Trace result={result} />
          </details>
        </>
      )}

      <DocumentViewer request={doc} onClose={() => setDoc(null)} />
    </div>
  );
}

function PickCard({ pick, rank, onCite }: { pick: Pick; rank: number; onCite: (d: DocRequest) => void }) {
  const warnings = pick.warnings.filter(Boolean);
  return (
    <article className="card pick">
      <header className="pick-header">
        <span className="rank">{rank}</span>
        <div>
          <h3>
            <Link to={`/projects/${pick.projectId}`}>{pick.name ?? pick.projectId}</Link>
          </h3>
          <div className="facts">
            <span>{pick.client ?? "Unknown client"}</span>
            <span>{label(pick.clientType)}</span>
            <span>{label(pick.sector)}</span>
            <span>{money(pick.value)}</span>
            <span>Completed {month(pick.completionDate)}</span>
          </div>
        </div>
        <span className={`badge ${pick.status}`}>{STATUS_LABEL[pick.status]}</span>
      </header>

      <p className="justification">{pick.justification}</p>

      <ul className="matches">
        {pick.matched.map((m) => (
          <li key={m.requirement}>
            <span className="ok">✓</span> {m.requirement}
            <span className="cites">
              {m.citations.length === 0 && <span className="muted small">no verified citation</span>}
              {m.citations.map((c) => (
                <button
                  key={c.chunkId}
                  className="cite"
                  title={c.text.slice(0, 300)}
                  onClick={() => onCite({ documentId: c.documentId, highlight: c.text })}
                >
                  {c.filename.replace(/\.txt$/, "")}
                </button>
              ))}
            </span>
          </li>
        ))}
        {pick.gaps.map((g) => (
          <li key={g} className="gap">
            <span className="no">✗</span> {g}
          </li>
        ))}
      </ul>

      {warnings.length > 0 && <p className="warning small">⚠ {warnings.join(" · ")}</p>}
    </article>
  );
}
