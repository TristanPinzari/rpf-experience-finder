/**
 * Scores the extracted catalog against the synthetic ground truth.
 *
 * For each field: how often extraction got it right. For each error: was the
 * record flagged for review? An error on a flagged record would be caught by a
 * human; an error on an unflagged record is a silent failure, the worst kind.
 *
 * Usage: npm run eval:extraction   (writes data/eval/extraction.json)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, SPEC_DIR } from "../config.js";
import { getDb } from "../db/db.js";
import { slugify } from "../ingest/archive.js";

type Spec = {
  id: string;
  folder: string;
  client: string;
  clientType: string;
  sector: string;
  location: string;
  originalValue: number;
  finalValue: number;
  startDate: string;
  completionDate: string;
  deliveryMethod: string;
};

type Row = {
  id: string;
  client: string | null;
  client_type: string | null;
  sector: string | null;
  location: string | null;
  original_value: number | null;
  final_value: number | null;
  start_date: string | null;
  completion_date: string | null;
  delivery_method: string | null;
  needs_review: number;
};

const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const city = (s: string | null) => norm((s ?? "").split(",")[0]);
const money = (a: number | null, b: number) => a !== null && Math.abs(a - b) / b <= 0.01;
/** Names match if most words of the shorter name appear in the longer one (ignores extra qualifiers and abbreviations). */
const sameName = (extracted: string | null, truth: string) => {
  const words = (x: string | null) => norm(x).split(" ").filter((w) => w.length > 2);
  const [a, b] = [words(extracted), words(truth)];
  if (!a.length || !b.length) return false;
  const [short, long] = a.length <= b.length ? [a, new Set(b)] : [b, new Set(a)];
  return short.filter((w) => long.has(w)).length / short.length >= 0.75;
};

const FIELDS: { name: string; check: (row: Row, spec: Spec) => boolean; show: (row: Row) => unknown; truth: (s: Spec) => unknown }[] = [
  { name: "clientType", check: (r, s) => r.client_type === s.clientType, show: (r) => r.client_type, truth: (s) => s.clientType },
  { name: "sector", check: (r, s) => r.sector === s.sector, show: (r) => r.sector, truth: (s) => s.sector },
  {
    name: "client",
    check: (r, s) => sameName(r.client, s.client),
    show: (r) => r.client,
    truth: (s) => s.client,
  },
  { name: "location", check: (r, s) => city(r.location) === city(s.location), show: (r) => r.location, truth: (s) => s.location },
  { name: "originalValue", check: (r, s) => money(r.original_value, s.originalValue), show: (r) => r.original_value, truth: (s) => s.originalValue },
  { name: "finalValue", check: (r, s) => money(r.final_value, s.finalValue), show: (r) => r.final_value, truth: (s) => s.finalValue },
  { name: "startDate", check: (r, s) => r.start_date === s.startDate, show: (r) => r.start_date, truth: (s) => s.startDate },
  { name: "completionDate", check: (r, s) => r.completion_date === s.completionDate, show: (r) => r.completion_date, truth: (s) => s.completionDate },
  { name: "deliveryMethod", check: (r, s) => r.delivery_method === s.deliveryMethod, show: (r) => r.delivery_method, truth: (s) => s.deliveryMethod },
];

function main() {
  const spec = (JSON.parse(readFileSync(path.join(SPEC_DIR, "projects.json"), "utf8")) as { projects: Spec[] }).projects;
  const rows = new Map(
    (getDb().prepare("SELECT * FROM projects").all() as Row[]).map((r) => [r.id, r]),
  );

  const perField = Object.fromEntries(FIELDS.map((f) => [f.name, { correct: 0, total: 0 }]));
  const errors: { project: string; field: string; kind: "empty" | "wrong"; extracted: unknown; truth: unknown; flagged: boolean }[] = [];
  const missing: string[] = [];

  for (const s of spec) {
    const row = rows.get(slugify(s.folder));
    if (!row) {
      missing.push(s.id);
      continue;
    }
    for (const f of FIELDS) {
      perField[f.name].total++;
      if (f.check(row, s)) perField[f.name].correct++;
      else {
        const extracted = f.show(row);
        errors.push({
          project: `${s.id} ${s.folder}`,
          field: f.name,
          kind: extracted === null ? "empty" : "wrong",
          extracted,
          truth: f.truth(s),
          flagged: row.needs_review === 1,
        });
      }
    }
  }

  const total = Object.values(perField).reduce((a, f) => ({ correct: a.correct + f.correct, total: a.total + f.total }), { correct: 0, total: 0 });
  const pct = (c: number, t: number) => (t ? `${((100 * c) / t).toFixed(1)}%` : "n/a");

  console.log("\nExtraction accuracy by field");
  console.table(Object.fromEntries(Object.entries(perField).map(([k, v]) => [k, { correct: `${v.correct}/${v.total}`, accuracy: pct(v.correct, v.total) }])));
  console.log(`Overall: ${total.correct}/${total.total} fields correct (${pct(total.correct, total.total)})`);

  // An empty field is honest: the documents didn't state it. A wrong value is
  // worse, and a wrong value on an unflagged record is the worst case.
  const empty = errors.filter((e) => e.kind === "empty");
  const wrong = errors.filter((e) => e.kind === "wrong");
  const silentWrong = wrong.filter((e) => !e.flagged);
  console.log(`Errors: ${errors.length}. Left empty (not stated or not confident): ${empty.length}. Wrong values: ${wrong.length}, of which ${silentWrong.length} on records not flagged for review.`);
  if (errors.length) console.table(errors);
  if (missing.length) console.log(`Projects not in the catalog (run ingest first): ${missing.join(", ")}`);

  const outDir = path.join(DATA_DIR, "eval");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "extraction.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), overall: total, perField, emptyCount: empty.length, wrongCount: wrong.length, silentWrongCount: silentWrong.length, errors, missing },
      null,
      2,
    ),
  );
}

main();
