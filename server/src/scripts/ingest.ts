/**
 * Stage 2: ingest the archive into the catalog and search index.
 *
 * For each project folder whose files changed since the last run:
 *   1. Extract a structured project record with the LLM (with per-field sources).
 *   2. Split every document into chunks and embed them.
 *   3. Replace the project's rows in SQLite in one transaction.
 * Unchanged projects are skipped (content hashes), and deleted folders are removed.
 *
 * Usage:
 *   npm run ingest              # only new or changed projects
 *   npm run ingest -- --force   # reprocess everything
 *   npm run ingest -- hlh-ed-reno-phases-1-5   # reprocess specific project ids
 */
import { config } from "../config.js";
import { getDb, vectorToBlob } from "../db/db.js";
import { readArchive, type ArchiveProject } from "../ingest/archive.js";
import { chunkText } from "../ingest/chunk.js";
import { extractProject } from "../ingest/extract.js";
import { chatModelName, embed } from "../llm/gemini.js";
import { forEachConcurrent } from "../lib/pool.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const onlyIds = new Set(args.filter((a) => !a.startsWith("--")));
const db = getDb();

// --- Change detection (prototype version of Graph delta queries) ---------------

function fingerprint(files: { filename: string; sha256: string }[]): string {
  return files
    .map((f) => `${f.filename}:${f.sha256}`)
    .sort()
    .join("|");
}

function storedFingerprints(): Map<string, string> {
  const rows = db.prepare("SELECT project_id, filename, sha256 FROM documents").all() as {
    project_id: string;
    filename: string;
    sha256: string;
  }[];
  const byProject = new Map<string, { filename: string; sha256: string }[]>();
  for (const r of rows) {
    const list = byProject.get(r.project_id) ?? [];
    list.push(r);
    byProject.set(r.project_id, list);
  }
  return new Map([...byProject].map(([id, files]) => [id, fingerprint(files)]));
}

// --- Processing one project ------------------------------------------------------

async function processProject(project: ArchiveProject) {
  const { record, needsReview } = await extractProject(project);
  const title = record.name.value ?? project.folder;

  const chunks = project.files.flatMap((file) =>
    chunkText(file.text).map((text, idx) => ({ file, idx, text })),
  );
  // Contextual chunking: the embedding sees the project name and document title,
  // so a chunk like "phase 2 was delayed" still knows which project it belongs to.
  const vectors = await embed(
    chunks.map((c) => ({ kind: "document" as const, title: `${title} - ${c.file.filename}`, text: c.text })),
    `${project.id}/embed`,
  );

  // All LLM work succeeded; now swap the project's rows atomically.
  db.exec("BEGIN");
  try {
    deleteProject(project.id);
    db.prepare(
      `INSERT INTO projects (id, folder, name, client, client_type, sector, location, original_value, final_value,
         start_date, completion_date, delivery_method, needs_review, record_json, extracted_at, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      project.id,
      project.folder,
      record.name.value,
      record.client.value,
      record.clientType.value,
      record.sector.value,
      record.location.value,
      record.originalValue.value,
      record.finalValue.value,
      record.startDate.value,
      record.completionDate.value,
      record.deliveryMethod.value,
      needsReview ? 1 : 0,
      JSON.stringify(record),
      new Date().toISOString(),
      chatModelName(),
    );

    const insertDoc = db.prepare(
      "INSERT INTO documents (project_id, filename, sha256, text) VALUES (?, ?, ?, ?) RETURNING id",
    );
    const insertChunk = db.prepare(
      "INSERT INTO chunks (project_id, document_id, idx, text, embedding) VALUES (?, ?, ?, ?, ?) RETURNING id",
    );
    const insertFts = db.prepare("INSERT INTO chunks_fts (rowid, text) VALUES (?, ?)");

    const docIds = new Map<string, number>();
    for (const f of project.files) {
      const row = insertDoc.get(project.id, f.filename, f.sha256, f.text) as { id: number };
      docIds.set(f.filename, row.id);
    }
    chunks.forEach((c, i) => {
      const row = insertChunk.get(project.id, docIds.get(c.file.filename)!, c.idx, c.text, vectorToBlob(vectors[i])) as {
        id: number;
      };
      insertFts.run(row.id, `${title}\n${c.file.filename}\n${c.text}`);
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { chunks: chunks.length, needsReview, issues: record.issues.length };
}

function deleteProject(id: string) {
  db.prepare("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE project_id = ?)").run(id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id); // cascades to documents and chunks
}

// --- Main ---------------------------------------------------------------------------

async function main() {
  const archive = readArchive();
  const stored = storedFingerprints();

  const removed = onlyIds.size ? [] : [...stored.keys()].filter((id) => !archive.some((p) => p.id === id));
  for (const id of removed) deleteProject(id);

  const changed = onlyIds.size
    ? archive.filter((p) => onlyIds.has(p.id))
    : archive.filter((p) => force || stored.get(p.id) !== fingerprint(p.files));
  console.log(
    `${archive.length} projects in archive: ${changed.length} to process, ${archive.length - changed.length} unchanged, ${removed.length} removed.`,
  );

  const failed: string[] = [];
  await forEachConcurrent(changed, config.concurrency, async (project, i) => {
    const started = Date.now();
    try {
      const r = await processProject(project);
      console.log(
        `[${i + 1}/${changed.length}] ${project.id}: ${r.chunks} chunks, ${r.issues} issues${r.needsReview ? ", NEEDS REVIEW" : ""} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
      );
    } catch (err) {
      console.error(`[${i + 1}/${changed.length}] ${project.id}: FAILED: ${(err as Error).message.slice(0, 300)}`);
      failed.push(project.id);
    }
  });

  const totals = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM projects) AS projects, (SELECT COUNT(*) FROM documents) AS documents,
              (SELECT COUNT(*) FROM chunks) AS chunks, (SELECT COUNT(*) FROM projects WHERE needs_review = 1) AS review`,
    )
    .get() as Record<string, number>;
  console.log(
    `\nCatalog: ${totals.projects} projects, ${totals.documents} documents, ${totals.chunks} chunks, ${totals.review} flagged for review.`,
  );
  if (failed.length) {
    console.log(`Failed: ${failed.join(", ")}. Rerun "npm run ingest" to retry only those.`);
    process.exitCode = 1;
  }
}

main();
