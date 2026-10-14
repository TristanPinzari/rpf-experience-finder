/**
 * Run one search from the command line and print every step.
 *
 * Usage:
 *   npm run search -- E1                 # a past RFP from data/spec/past-rfps.json, scored against what the company chose
 *   npm run search -- "Provide three..."  # free text, as of today
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { SPEC_DIR } from "../config.js";
import { slugify } from "../ingest/archive.js";
import { runSearch } from "../query/pipeline.js";

type PastRfp = { id: string; asOf: string; title: string; requirements: string; chosen: string[] };

async function main() {
  const arg = process.argv.slice(2).join(" ").trim();
  if (!arg) throw new Error('Give an RFP id like E1, or the RFP text in quotes.');

  const past = (JSON.parse(readFileSync(path.join(SPEC_DIR, "past-rfps.json"), "utf8")) as { rfps: PastRfp[] }).rfps;
  const spec = (JSON.parse(readFileSync(path.join(SPEC_DIR, "projects.json"), "utf8")) as { projects: { id: string; folder: string }[] }).projects;
  const rfp = past.find((r) => r.id.toLowerCase() === arg.toLowerCase());

  const text = rfp ? rfp.requirements : arg;
  if (rfp) console.log(`${rfp.id}: ${rfp.title} (as of ${rfp.asOf})\n`);
  const r = await runSearch(text, rfp?.asOf);

  console.log("CRITERIA");
  console.log(JSON.stringify(r.criteria, null, 2));
  console.log(
    `\nFILTER  cutoff ${r.filter.cutoffDate ?? "none"}  pass ${r.filter.counts.pass}, near miss ${r.filter.counts.near_miss}, excluded ${r.filter.counts.excluded}${r.filter.relaxed ? "  (relaxed: near misses let back in)" : ""}`,
  );

  console.log("\nRANKING (top 10)");
  console.table(
    r.ranking.slice(0, 10).map((p) => ({
      project: p.id,
      status: p.status,
      score: p.score.toFixed(4),
      meaning: `#${p.meaningRank} (${p.meaningScore.toFixed(3)})`,
      keyword: p.keywordRank ? `#${p.keywordRank}` : "-",
      sector: p.sectorMatch ? "yes" : "",
    })),
  );

  console.log("PICKS");
  for (const [i, p] of r.picks.entries()) {
    console.log(`\n${i + 1}. ${p.name}  [${p.projectId}]  ${p.status}`);
    console.log(`   ${p.justification}`);
    for (const m of p.matched) console.log(`   + ${m.requirement}  <- ${m.citations.map((c) => c.filename).join(", ") || "NO VALID CITATION"}`);
    for (const g of p.gaps) console.log(`   - gap: ${g}`);
  }
  console.log(`\nVerification: ${r.verification.droppedCitations} invalid citations dropped, ${r.verification.droppedPicks} invalid picks dropped.`);
  console.log(`Timings (ms): ${JSON.stringify(r.timingsMs)}`);

  if (rfp) {
    const chosen = rfp.chosen.map((pid) => slugify(spec.find((s) => s.id === pid)!.folder));
    const top5 = r.ranking.slice(0, 5).map((p) => p.id);
    const picked = r.picks.map((p) => p.projectId);
    const hits = (list: string[]) => chosen.filter((c) => list.includes(c)).length;
    console.log(`\nCompany chose: ${chosen.join(", ")}`);
    console.log(`Found in final picks: ${hits(picked)}/${chosen.length}.  Found in ranking top 5: ${hits(top5)}/${chosen.length}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
