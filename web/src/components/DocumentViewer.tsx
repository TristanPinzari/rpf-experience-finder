import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type DocumentText } from "../api";

// A modal that shows a source document's full text. When opened from a
// citation, the cited passage is highlighted and scrolled into view, so the
// reader can check the claim against the original document.

export type DocRequest = { documentId: number; highlight?: string };

export function DocumentViewer({ request, onClose }: { request: DocRequest | null; onClose: () => void }) {
  const [doc, setDoc] = useState<DocumentText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const markRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!request) return;
    setDoc(null);
    setError(null);
    api.document(request.documentId).then(setDoc, (e: Error) => setError(e.message));
  }, [request]);

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center" });
  }, [doc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!request) return null;

  let body: ReactNode = <p className="muted">Loading…</p>;
  if (error) body = <p className="error">{error}</p>;
  else if (doc) {
    const start = request.highlight ? doc.text.indexOf(request.highlight.trim()) : -1;
    body =
      start === -1 ? (
        <pre className="doc-text">{doc.text}</pre>
      ) : (
        <pre className="doc-text">
          {doc.text.slice(0, start)}
          <mark ref={markRef}>{doc.text.slice(start, start + request.highlight!.trim().length)}</mark>
          {doc.text.slice(start + request.highlight!.trim().length)}
        </pre>
      );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <div className="modal-title">{doc?.filename ?? "Document"}</div>
            {doc?.project_name && <div className="muted small">{doc.project_name}</div>}
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{body}</div>
      </div>
    </div>
  );
}
