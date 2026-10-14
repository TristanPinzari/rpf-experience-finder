/**
 * Stage 1: generate the synthetic document archive.
 *
 * Reads the ground-truth spec (data/spec/projects.json) and asks Gemini to write
 * each project's documents as plain text files under data/archive/<folder>/.
 * The archive stands in for the company's SharePoint library.
 *
 * Runs LLM_CONCURRENCY projects in parallel (see .env.example).
 *
 * Usage:
 *   npm run generate              # generate any project folders that don't exist yet
 *   npm run generate -- P04 P11   # (re)generate specific projects only
 *   npm run generate -- --force   # regenerate everything
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ARCHIVE_DIR, SPEC_DIR, config } from "../config.js";
import { forEachConcurrent } from "../lib/pool.js";
import { DOC_TYPES, type DocType } from "../domain/taxonomy.js";
import { generateJson } from "../llm/gemini.js";

type SpecProject = {
  id: string;
  folder: string;
  documents: DocType[];
  quirks: string;
  [key: string]: unknown;
};

const DOC_TYPE_GUIDE: Record<DocType, string> = {
  contract_summary:
    "Contract award summary or memo: parties, contract number, ORIGINAL contract price, scheduled start and completion, delivery method, scope summary, key staff.",
  change_order_log:
    "Change order log as a plain-text table: numbered change orders with dates, short descriptions and amounts, ending with the revised (final) contract value.",
  meeting_minutes:
    "Minutes of one or two site or progress meetings: date, attendees with roles, numbered discussion items, action items. Informal wording and abbreviations.",
  completion_report:
    "Project completion / closeout report: summary of work performed, final cost, substantial completion date, challenges and how they were handled, safety record, lessons learned.",
  reference_letter:
    "Short reference letter from the client's representative on client letterhead, praising the contractor and mentioning the project and a few highlights.",
};

const GeneratedDocs = z.object({
  documents: z.array(
    z.object({
      docType: z.enum(DOC_TYPES),
      filename: z.string().describe("Realistic, slightly messy filename ending in .txt"),
      content: z.string(),
    }),
  ),
});

const SYSTEM = `You write realistic internal documents for a Canadian general contractor, Ridgeline Constructors Ltd.
They form a SYNTHETIC dataset used to test a document search system, so realism and messiness matter.

Rules:
- Use only the facts provided. You may invent minor plausible details (meeting dates, subcontractor names, contract numbers, weather delays), but never contradict the facts unless the quirks tell you to.
- Follow the quirks exactly. They describe where facts are missing, inconsistent or hard to find.
- Do not copy the fact sheet. Each document type includes only what that type of document would naturally contain.
- Vary tone and formatting between document types. Plain text only, no markdown headings with #.
- Each document is 150 to 450 words.
- Filenames look like real office files, for example "Contract Summary - 2019-031.txt", "CO_Log_rev4.txt", "Mtg Minutes 2021-09-14.txt".`;

function buildPrompt(p: SpecProject): string {
  const { documents, quirks, folder, ...facts } = p;
  const wanted = documents.map((d) => `- ${d}: ${DOC_TYPE_GUIDE[d]}`).join("\n");
  return `Project facts (ground truth):
${JSON.stringify(facts, null, 2)}

Quirks to apply: ${quirks}

Write exactly these documents, one of each:
${wanted}`;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const onlyIds = new Set(args.filter((a) => !a.startsWith("--")));

  const spec = JSON.parse(readFileSync(path.join(SPEC_DIR, "projects.json"), "utf8")) as {
    projects: SpecProject[];
  };
  const targets = spec.projects.filter((p) => onlyIds.size === 0 || onlyIds.has(p.id));

  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const todo = targets.filter(
    (p) => force || onlyIds.has(p.id) || !existsSync(path.join(ARCHIVE_DIR, p.folder)),
  );
  const skipped = targets.length - todo.length;
  let generated = 0;
  const failed: string[] = [];
  console.log(`Generating ${todo.length} projects (${skipped} already exist), ${config.concurrency} at a time.`);

  await forEachConcurrent(todo, config.concurrency, async (project, i) => {
    const dir = path.join(ARCHIVE_DIR, project.folder);
    console.log(`[${i + 1}/${todo.length}] ${project.id} ${project.folder}: started`);
    try {
      const result = await generateJson({
        schema: GeneratedDocs,
        system: SYSTEM,
        prompt: buildPrompt(project),
        temperature: 0.9,
        label: project.id,
      });

      const missing = project.documents.filter((d) => !result.documents.some((doc) => doc.docType === d));
      if (missing.length) console.warn(`  ${project.id}: missing doc types: ${missing.join(", ")}`);

      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      for (const doc of result.documents) {
        const safeName = doc.filename.replace(/[<>:"/\\|?*]/g, "-").trim() || `${doc.docType}.txt`;
        writeFileSync(path.join(dir, safeName.endsWith(".txt") ? safeName : `${safeName}.txt`), doc.content);
      }
      console.log(`  ${project.id}: wrote ${result.documents.length} documents`);
      generated++;
    } catch (err) {
      console.error(`  ${project.id}: FAILED: ${(err as Error).message}`);
      failed.push(project.id);
    }
  });

  console.log(`\nGenerated ${generated}, skipped ${skipped} existing, failed ${failed.length}.`);
  if (failed.length) {
    console.log(`Retry the failures with: npm run generate -- ${failed.join(" ")}`);
    process.exitCode = 1;
  }
}

main();
