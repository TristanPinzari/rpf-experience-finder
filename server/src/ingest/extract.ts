import { ExtractedProject, KEY_FIELDS } from "../domain/project-record.js";
import { generateJson } from "../llm/gemini.js";
import type { ArchiveProject } from "./archive.js";

// Reads all documents of one project and extracts a single structured record.
// This step turns thousands of messy documents into a few hundred clean rows
// that can be filtered by value, date, client type and sector.

const SYSTEM = `You extract structured project records for a construction company's past-project catalog.
The catalog is used to pick relevant past projects for new government proposals, so accuracy matters more than completeness.

Rules:
- Use only what the documents say. Never guess a value; use null and add an issue instead.
- For every value, give the exact filename of the document you took it from.
- Documents can disagree. When two documents state different values for the same fact, use the most authoritative and most recent one (a final change order log beats an earlier completion report) and record the conflict in issues.
- A scheduled or target date is not a conflict with an actual date. Always use the actual date and do not report the difference.
- Money is in Canadian dollars as a plain number. Convert "$9.1M" or "approximately $4.6 million" to 9100000 or 4600000. Only words like "approximately" or "nearly" make a figure uncertain.
- Dates are YYYY-MM.
- The same project may appear under different names or abbreviations. Use the most complete formal name and list the others as aliases.`;

export type ExtractionResult = { record: ExtractedProject; needsReview: boolean };

export async function extractProject(project: ArchiveProject): Promise<ExtractionResult> {
  const docs = project.files.map((f) => `===== DOCUMENT: ${f.filename} =====\n${f.text.trim()}`).join("\n\n");
  const raw = await generateJson({
    schema: ExtractedProject,
    system: SYSTEM,
    prompt: `Project folder: "${project.folder}"\n\n${docs}`,
    temperature: 0,
    label: project.id,
  });
  const record = cleanRecord(raw, new Set(project.files.map((f) => f.filename)));
  // Review is needed when a key filter field is empty, or when any value was
  // contested or uncertain. A missing non-key field (e.g. location) is just noted.
  const missingKey = KEY_FIELDS.some((k) => record[k].value === null);
  const doubtful = record.issues.some((i) => i.severity === "conflict" || i.severity === "uncertain");
  return { record, needsReview: missingKey || doubtful };
}

/** Code-side checks on the model's output, so bad values never reach the catalog. */
function cleanRecord(r: ExtractedProject, filenames: Set<string>): ExtractedProject {
  const issues = [...r.issues];
  const fields = ["name", "client", "clientType", "sector", "location", "originalValue", "finalValue", "startDate", "completionDate", "deliveryMethod"] as const;

  for (const field of fields) {
    const f = r[field] as { value: unknown; source: string | null };
    // A citation must point at a real file in this project.
    if (f.source !== null && !filenames.has(f.source)) {
      issues.push({ field, severity: "uncertain", description: `Cited source "${f.source}" is not a file in this project.` });
      f.source = null;
    }
  }
  for (const field of ["startDate", "completionDate"] as const) {
    const v = r[field].value;
    if (v !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) {
      issues.push({ field, severity: "uncertain", description: `Date "${v}" is not in YYYY-MM format.` });
      r[field].value = null;
    }
  }
  for (const field of ["originalValue", "finalValue"] as const) {
    const v = r[field].value;
    if (v !== null && (!Number.isFinite(v) || v <= 0)) {
      issues.push({ field, severity: "uncertain", description: `Invalid amount ${v}.` });
      r[field].value = null;
    }
  }
  return { ...r, issues };
}
