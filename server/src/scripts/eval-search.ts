/**
 * Stage 5: run every past RFP through the search and compare with the projects
 * the company actually chose in its submitted proposal.
 *
 *   recall in picks = share of the company's choices that the system also picked
 *   recall in top 5 = share that appear in the first five ranked projects
 *
 * Usage: npm run eval:search   (writes data/eval/search.json)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, SPEC_DIR } from "../config.js";
import { getDb } from "../db/db.js";
import { slugify } from "../ingest/archive.js";
import { runSearch } from "../query/pipeline.js";

type PastRfp = { id: string; asOf: string; title: string; requirements: string; chosen: string[] };
type RfpResult = {
  id: string;
  title: string;
  asOf: string;
  chosen: { id: string; name: string; picked: boolean; inTop5: boolean }[];
  picks: { id: string; name: string | null; companyChose: boolean }[];
  hitsPicks: number;
  hitsTop5: number;
  total: number;
  droppedCitations: number;
  timingsMs: Record<string, number>;
};

async function main() {
  const past = (JSON.parse(readFileSync(path.join(SPEC_DIR, "past-rfps.json"), "utf8")) as { rfps: PastRfp[] }).rfps;
  const spec = (JSON.parse(readFileSync(path.join(SPEC_DIR, "projects.json"), "utf8")) as { projects: { id: string; folder: string }[] }).projects;
  const names = new Map((getDb().prepare("SELECT id, name FROM projects").all() as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  const toCatalogId = (pid: string) => slugify(spec.find((s) => s.id === pid)!.folder);

  const results: RfpResult[] = [];
  for (const rfp of past) {
    process.stdout.write(`${rfp.id} ${rfp.title} ... `);
    const r = await runSearch(rfp.requirements, rfp.asOf);
    const chosen = rfp.chosen.map(toCatalogId);
    const picks = r.picks.map((p) => p.projectId);
    const top5 = r.ranking.slice(0, 5).map((p) => p.id);
    const hitsPicks = chosen.filter((c) => picks.includes(c)).length;
    const hitsTop5 = chosen.filter((c) => top5.includes(c)).length;
    console.log(`picks ${hitsPicks}/${chosen.length}, top 5 ${hitsTop5}/${chosen.length}`);
    results.push({
      id: rfp.id,
      title: rfp.title,
      asOf: rfp.asOf,
      chosen: chosen.map((id) => ({ id, name: names.get(id) ?? id, picked: picks.includes(id), inTop5: top5.includes(id) })),
      picks: r.picks.map((p) => ({ id: p.projectId, name: p.name, companyChose: chosen.includes(p.projectId) })),
      hitsPicks,
      hitsTop5,
      total: chosen.length,
      droppedCitations: r.verification.droppedCitations,
      timingsMs: r.timingsMs,
    });
  }

  const sum = (k: "hitsPicks" | "hitsTop5" | "total" | "droppedCitations") => results.reduce((a, r) => a + r[k], 0);
  const summary = {
    rfps: results.length,
    chosenTotal: sum("total"),
    recallPicks: sum("hitsPicks") / sum("total"),
    recallTop5: sum("hitsTop5") / sum("total"),
    droppedCitations: sum("droppedCitations"),
  };
  console.log(
    `\nRecall in picks: ${sum("hitsPicks")}/${sum("total")} (${(100 * summary.recallPicks).toFixed(0)}%). Recall in top 5: ${sum("hitsTop5")}/${sum("total")} (${(100 * summary.recallTop5).toFixed(0)}%). Invalid citations dropped: ${summary.droppedCitations}.`,
  );

  const outDir = path.join(DATA_DIR, "eval");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "search.json"), JSON.stringify({ generatedAt: new Date().toISOString(), summary, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
