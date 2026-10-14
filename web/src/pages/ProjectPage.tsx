import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type ProjectDetail, type Sourced } from "../api";
import { DocumentViewer, type DocRequest } from "../components/DocumentViewer";
import { label, money, month } from "../format";

export function ProjectPage() {
  const { id = "" } = useParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocRequest | null>(null);

  useEffect(() => {
    setProject(null);
    api.project(id).then(setProject, (e: Error) => setError(e.message));
  }, [id]);

  if (error) return <div className="page"><section className="card error">{error}</section></div>;
  if (!project) return <div className="page"><p className="muted">Loading…</p></div>;

  const r = project.record;
  const docIdByName = new Map(project.documents.map((d) => [d.filename, d.id]));
  const openSource = (filename: string | null) => {
    const docId = filename ? docIdByName.get(filename) : undefined;
    if (docId) setDoc({ documentId: docId });
  };

  const fields: [string, Sourced<string | number>, (v: any) => string][] = [
    ["Client", r.client, (v) => v],
    ["Client type", r.clientType, label],
    ["Sector", r.sector, label],
    ["Location", r.location, (v) => v],
    ["Original value", r.originalValue, money],
    ["Final value", r.finalValue, money],
    ["Start", r.startDate, month],
    ["Substantial completion", r.completionDate, month],
    ["Delivery method", r.deliveryMethod, label],
  ];

  return (
    <div className="page">
      <Link to="/catalog" className="small">
        ← Catalog
      </Link>
      <section className="card">
        <div className="pick-header">
          <div>
            <h1>{r.name.value ?? project.folder}</h1>
            <div className="muted small">
              Folder: {project.folder}
              {r.aliases.length > 0 && <> · Also called: {r.aliases.join(", ")}</>}
            </div>
          </div>
          {project.needs_review === 1 && <span className="badge near_miss">Needs review</span>}
        </div>
        <p>{r.scopeSummary}</p>
        <div className="chips">
          {r.features.map((f) => (
            <span key={f} className="chip">
              {f}
            </span>
          ))}
        </div>
      </section>

      {r.issues.length > 0 && (
        <section className="card">
          <h2>Issues found during extraction</h2>
          <ul className="issues">
            {r.issues.map((i, n) => (
              <li key={n}>
                <span className={`badge ${i.severity === "missing" ? "neutral" : "near_miss"}`}>{i.severity}</span>{" "}
                <strong>{i.field}</strong>: {i.description}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid-2">
        <section className="card">
          <h2>Extracted record</h2>
          <table className="table compact">
            <tbody>
              {fields.map(([name, f, fmt]) => (
                <tr key={name}>
                  <th>{name}</th>
                  <td>{f.value === null ? <span className="muted">not stated</span> : fmt(f.value)}</td>
                  <td className="small">
                    {f.source ? (
                      <button className="cite" onClick={() => openSource(f.source)}>
                        {f.source.replace(/\.txt$/, "")}
                      </button>
                    ) : (
                      <span className="muted">no source</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.keyPersonnel.length > 0 && (
            <p className="small">
              <strong>Key personnel:</strong> {r.keyPersonnel.map((p) => `${p.name} (${p.role})`).join(", ")}
            </p>
          )}
          <p className="muted small">
            Extracted {new Date(project.extracted_at).toLocaleString()} {project.model && `by ${project.model}`}
          </p>
        </section>

        <section className="card">
          <h2>Source documents</h2>
          <ul className="doc-list">
            {project.documents.map((d) => (
              <li key={d.id}>
                <button className="link" onClick={() => setDoc({ documentId: d.id })}>
                  📄 {d.filename}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <DocumentViewer request={doc} onClose={() => setDoc(null)} />
    </div>
  );
}
