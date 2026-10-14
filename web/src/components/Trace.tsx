import { useState } from "react";
import type { SearchResult } from "../api";
import { label, money, month, STATUS_LABEL } from "../format";

// Shows what each pipeline step did, so anyone can see why a project was chosen.

export function Trace({ result }: { result: SearchResult }) {
  const { criteria, filter, ranking, verification, timingsMs } = result;
  const [showAllFiltered, setShowAllFiltered] = useState(false);
  const filteredOut = filter.projects.filter((p) => p.status !== "pass");
  const total = Object.values(timingsMs).reduce((a, b) => a + b, 0);

  return (
    <div className="trace">
      <section className="trace-step">
        <h3>
          <span className="step-num">1</span> Read the RFP <span className="timing">{(timingsMs.criteria / 1000).toFixed(1)}s · LLM</span>
        </h3>
        <p>{criteria.summary}</p>
        <div className="grid-2">
          <div>
            <div className="kicker">Hard limits (filter)</div>
            <ul className="plain">
              <li>Minimum value: {criteria.minValue ? money(criteria.minValue) : "none"}</li>
              <li>
                Completed within: {criteria.completedWithinYears ? `${criteria.completedWithinYears} years` : "any time"}
                {filter.cutoffDate && <span className="muted"> (after {month(filter.cutoffDate)})</span>}
              </li>
              <li>Client types: {criteria.clientTypes.length ? criteria.clientTypes.map(label).join(", ") : "any"}</li>
              <li>Projects requested: {criteria.projectsRequested ?? "not stated (showing 3)"}</li>
            </ul>
          </div>
          <div>
            <div className="kicker">Soft requirements (ranking)</div>
            <ul className="plain">
              {criteria.requirements.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <div className="chips">
              {criteria.sectors.map((s) => (
                <span key={s} className="chip">
                  sector: {label(s)}
                </span>
              ))}
              {criteria.keywords.map((k) => (
                <span key={k} className="chip">
                  keyword: {k}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="trace-step">
        <h3>
          <span className="step-num">2</span> Filter the catalog <span className="timing">{timingsMs.filter}ms · SQL</span>
        </h3>
        <p>
          <strong>{filter.counts.pass}</strong> projects meet every hard limit, <strong>{filter.counts.near_miss}</strong> miss by a small
          margin, <strong>{filter.counts.excluded}</strong> are excluded.{" "}
          {filter.relaxed
            ? "Too few projects passed, so near misses were let back in with a warning."
            : "Near misses were not needed."}
        </p>
        {filteredOut.length > 0 && (
          <>
            <table className="table compact">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Result</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {(showAllFiltered ? filteredOut : filteredOut.slice(0, 6)).map((p) => (
                  <tr key={p.id}>
                    <td>{p.name ?? p.id}</td>
                    <td>
                      <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                    </td>
                    <td className="muted">{p.reasons.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredOut.length > 6 && (
              <button className="link" onClick={() => setShowAllFiltered(!showAllFiltered)}>
                {showAllFiltered ? "Show fewer" : `Show all ${filteredOut.length}`}
              </button>
            )}
          </>
        )}
      </section>

      <section className="trace-step">
        <h3>
          <span className="step-num">3</span> Rank the candidates <span className="timing">{timingsMs.rank}ms · embeddings + keyword search</span>
        </h3>
        <p className="muted">
          Each signal produces its own ranking. They are combined with reciprocal rank fusion: every list adds 1 ÷ (60 + rank) to a
          project's score. The top 8 go to the next step.
        </p>
        <table className="table compact">
          <thead>
            <tr>
              <th>#</th>
              <th>Project</th>
              <th title="Average best-passage similarity across the soft requirements">Meaning</th>
              <th title="Full-text (BM25) rank for the RFP's terms">Keywords</th>
              <th>Sector</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {ranking.slice(0, 12).map((p, i) => (
              <tr key={p.id} className={p.sentToLlm ? "" : "dim"}>
                <td>{i + 1}</td>
                <td>
                  {p.name ?? p.id}
                  {p.status === "near_miss" && <span className="badge near_miss">Near miss</span>}
                </td>
                <td>
                  #{p.meaningRank} <span className="muted">({p.meaningScore.toFixed(3)})</span>
                </td>
                <td>{p.keywordRank ? `#${p.keywordRank}` : "—"}</td>
                <td>{p.sectorMatch ? "✓" : ""}</td>
                <td>{p.score.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="trace-step">
        <h3>
          <span className="step-num">4</span> Choose and justify <span className="timing">{(timingsMs.justify / 1000).toFixed(1)}s · LLM</span>
        </h3>
        <p>
          The model chose {result.picks.length} projects from the top 8 and cited passages for each claim. Every citation was checked
          against the passages actually shown to it:{" "}
          <strong>
            {verification.droppedCitations === 0 && verification.droppedPicks === 0
              ? "all citations valid."
              : `${verification.droppedCitations} invalid citations and ${verification.droppedPicks} invalid picks were removed.`}
          </strong>
        </p>
        <p className="muted small">Total time {(total / 1000).toFixed(1)}s.</p>
      </section>
    </div>
  );
}
