import { z } from "zod";
import { getDb } from "../db/db.js";
import { generateJson } from "../llm/gemini.js";
import type { RfpCriteria } from "./criteria.js";
import type { RankedProject } from "./rank.js";

// Step 4: the LLM reads the top candidates' evidence, picks the final projects
// and explains each pick, citing chunk ids. Code then verifies every citation:
// a cited chunk must be one we actually showed the model for that project.
// Invalid citations are dropped and counted, so hallucinated sources never reach the user.

const Picks = z.object({
  picks: z.array(
    z.object({
      projectId: z.string(),
      justification: z.string().describe("Two or three sentences a proposal writer could adapt, stating why this project fits."),
      matched: z
        .array(z.object({ requirement: z.string(), chunkIds: z.array(z.number().int()) }))
        .describe("Each RFP requirement this project meets, with the chunk ids that prove it."),
      gaps: z.array(z.string()).describe("RFP requirements this project does NOT clearly meet. Be honest."),
    }),
  ),
});

export type Citation = { chunkId: number; documentId: number; filename: string; text: string };
export type Pick = {
  projectId: string;
  justification: string;
  matched: { requirement: string; citations: Citation[] }[];
  gaps: string[];
};
export type JustifyResult = { picks: Pick[]; droppedCitations: number; droppedPicks: number };

const SYSTEM = `You help a construction company choose past projects for the "relevant experience" section of a proposal.
You get the RFP requirements and a shortlist of candidate projects with evidence passages, each labelled [chunk N].

Rules:
- Pick only from the candidates, best first.
- Every claim must be supported by a cited chunk from that same project. Cite chunk ids, never invent them.
- A candidate marked NEAR MISS fails a hard limit by a small margin. Prefer projects without warnings unless a near miss is clearly more relevant, and mention the shortfall in gaps.
- List gaps honestly. A weaker but honest pick is better than an overstated one.`;

type ChunkInfo = { id: number; project_id: string; document_id: number; filename: string; text: string };

export async function justifyPicks(criteria: RfpCriteria, ranked: RankedProject[], count: number): Promise<JustifyResult> {
  if (ranked.length === 0) return { picks: [], droppedCitations: 0, droppedPicks: 0 };

  const chunkIds = ranked.flatMap((p) => p.evidence.map((e) => e.chunkId));
  const chunks = new Map(
    (
      getDb()
        .prepare(
          `SELECT c.id, c.project_id, c.document_id, d.filename, c.text
             FROM chunks c JOIN documents d ON d.id = c.document_id
            WHERE c.id IN (${chunkIds.map(() => "?").join(",")})`,
        )
        .all(...chunkIds) as ChunkInfo[]
    ).map((c) => [c.id, c]),
  );

  const candidateText = ranked
    .map((p) => {
      const facts = [
        `client: ${p.client ?? "unknown"} (${p.clientType ?? "unknown type"})`,
        `sector: ${p.sector ?? "unknown"}`,
        `value: ${p.value ? `$${(p.value / 1e6).toFixed(1)}M` : "unknown"}`,
        `completed: ${p.completionDate ?? "unknown"}`,
      ].join("; ");
      const warning = p.status === "near_miss" ? `\nNEAR MISS: ${p.reasons.join("; ")}` : "";
      const evidence = p.evidence
        .map((e) => chunks.get(e.chunkId))
        .filter((c): c is ChunkInfo => !!c)
        .map((c) => `[chunk ${c.id}] (${c.filename})\n${c.text}`)
        .join("\n\n");
      return `### Candidate ${p.id}: ${p.name}\n${facts}${warning}\n\n${evidence}`;
    })
    .join("\n\n");

  const prompt = `RFP asks for: ${criteria.summary}
Requirements:
${criteria.requirements.map((r) => `- ${r}`).join("\n")}

Choose the ${count} best projects.

${candidateText}`;

  const raw = await generateJson({ schema: Picks, system: SYSTEM, prompt, temperature: 0, label: "justify" });

  // --- Verify. Picks must be real candidates; citations must be evidence shown for that project.
  const allowed = new Map(ranked.map((p) => [p.id, new Set(p.evidence.map((e) => e.chunkId))]));
  let droppedCitations = 0;
  let droppedPicks = 0;
  const seen = new Set<string>();
  const picks: Pick[] = [];

  for (const pick of raw.picks) {
    const ok = allowed.get(pick.projectId);
    if (!ok || seen.has(pick.projectId)) {
      droppedPicks++;
      continue;
    }
    seen.add(pick.projectId);
    const matched = pick.matched.map((m) => {
      const valid = m.chunkIds.filter((id) => ok.has(id));
      droppedCitations += m.chunkIds.length - valid.length;
      return {
        requirement: m.requirement,
        citations: valid.map((id) => {
          const c = chunks.get(id)!;
          return { chunkId: id, documentId: c.document_id, filename: c.filename, text: c.text };
        }),
      };
    });
    picks.push({ projectId: pick.projectId, justification: pick.justification, matched, gaps: pick.gaps });
    if (picks.length >= count) break;
  }
  return { picks, droppedCitations, droppedPicks };
}
