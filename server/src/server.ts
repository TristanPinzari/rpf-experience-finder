import cors from "cors";
import express from "express";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, SPEC_DIR } from "./config.js";
import { getDb } from "./db/db.js";
import { runSearch } from "./query/pipeline.js";

// HTTP API for the frontend. No auth: this is a local prototype.

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const db = getDb();

/** The whole catalog, for the browse page. */
app.get("/api/projects", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, folder, name, client, client_type, sector, location, original_value, final_value,
              start_date, completion_date, delivery_method, needs_review,
              (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id) AS document_count
         FROM projects p ORDER BY completion_date DESC`,
    )
    .all();
  res.json(rows);
});

/** One project: the full extracted record (with per-field sources and issues) and its documents. */
app.get("/api/projects/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id) as Record<string, any> | undefined;
  if (!row) return void res.status(404).json({ error: "Project not found" });
  const documents = db.prepare("SELECT id, filename FROM documents WHERE project_id = ? ORDER BY filename").all(req.params.id);
  const { record_json, ...columns } = row;
  res.json({ ...columns, record: JSON.parse(record_json), documents });
});

/** One source document's full text, so every citation can be opened. */
app.get("/api/documents/:id", (req, res) => {
  const doc = db
    .prepare("SELECT d.id, d.filename, d.text, d.project_id, p.name AS project_name FROM documents d JOIN projects p ON p.id = d.project_id WHERE d.id = ?")
    .get(Number(req.params.id));
  if (!doc) return void res.status(404).json({ error: "Document not found" });
  res.json(doc);
});

const SearchBody = z.object({
  rfpText: z.string().trim().min(20, "Paste at least a sentence of RFP requirements."),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Run the full pipeline on pasted RFP requirements. */
app.post("/api/search", async (req, res) => {
  const body = SearchBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid request" });
  try {
    res.json(await runSearch(body.data.rfpText, body.data.asOf));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: `Search failed: ${(err as Error).message.slice(0, 300)}` });
  }
});

const readJson = (file: string) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

/** Past RFPs, offered as one-click samples on the search page. */
app.get("/api/sample-rfps", (_req, res) => {
  const past = readJson(path.join(SPEC_DIR, "past-rfps.json"));
  res.json((past?.rfps ?? []).map(({ id, title, asOf, requirements }: Record<string, string>) => ({ id, title, asOf, requirements })));
});

/** Latest evaluation results, written by npm run eval:extraction and npm run eval:search. */
app.get("/api/eval", (_req, res) => {
  res.json({
    extraction: readJson(path.join(DATA_DIR, "eval", "extraction.json")),
    search: readJson(path.join(DATA_DIR, "eval", "search.json")),
  });
});

// Serve the built frontend when it exists (npm run build in web/).
const webDist = path.join(DATA_DIR, "..", "web", "dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
