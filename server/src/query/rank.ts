import { blobToVector, getDb } from "../db/db.js";
import { embed } from "../llm/gemini.js";
import type { RfpCriteria } from "./criteria.js";
import type { FilteredProject } from "./filter.js";

// Step 3: rank the candidates with three signals, then merge the rankings.
//
//   meaning   For each requirement, the project's best-matching chunk by
//             embedding similarity. Averaged over requirements, so a project
//             that covers every requirement beats one that nails only one.
//   keywords  Full-text search (BM25) for the RFP's technical terms.
//   sector    Bonus when the project's sector is one the RFP cares about.
//
// The rankings are merged with reciprocal rank fusion (RRF): each list adds
// 1 / (60 + rank) to a project's score. It needs no tuning and doesn't care
// that similarity scores and BM25 scores are on different scales.

const RRF_K = 60;
const NEAR_MISS_PENALTY = 0.7;
const EVIDENCE_PER_PROJECT = 4;

export type Evidence = { chunkId: number; requirement: string | null; similarity: number | null };

export type RankedProject = FilteredProject & {
  score: number;
  meaningScore: number;
  meaningRank: number;
  keywordRank: number | null;
  sectorMatch: boolean;
  evidence: Evidence[];
};

type ChunkRow = { id: number; project_id: string; embedding: Uint8Array };

const STOPWORDS = new Set(
  "with that this from have will were been their they them than then into onto over under each such also only must shall within including projects project experience construction work works".split(" "),
);

export async function rankCandidates(criteria: RfpCriteria, candidates: FilteredProject[]): Promise<RankedProject[]> {
  if (candidates.length === 0) return [];
  const db = getDb();
  const ids = candidates.map((c) => c.id);
  const placeholders = ids.map(() => "?").join(",");

  // --- Meaning: embed each requirement, compare against every candidate chunk.
  const requirements = criteria.requirements.length ? criteria.requirements : [criteria.summary];
  const queryVectors = await embed(requirements.map((text) => ({ kind: "query" as const, text })), "query");

  const chunks = (db.prepare(`SELECT id, project_id, embedding FROM chunks WHERE project_id IN (${placeholders})`).all(...ids) as ChunkRow[]).map(
    (c) => ({ id: c.id, projectId: c.project_id, vector: blobToVector(c.embedding) }),
  );

  const meaning = new Map<string, { score: number; best: Evidence[] }>();
  for (const id of ids) {
    const own = chunks.filter((c) => c.projectId === id);
    const best: Evidence[] = requirements.map((req, r) => {
      let top: Evidence = { chunkId: -1, requirement: req, similarity: -1 };
      for (const c of own) {
        const s = dot(c.vector, queryVectors[r]);
        if (s > top.similarity!) top = { chunkId: c.id, requirement: req, similarity: s };
      }
      return top;
    });
    const score = best.reduce((sum, e) => sum + Math.max(0, e.similarity!), 0) / best.length;
    meaning.set(id, { score, best: best.filter((e) => e.chunkId !== -1) });
  }

  // --- Keywords: BM25 over the full-text index. Lower bm25 = better match.
  const keyword = new Map<string, { bm25: number; chunkId: number }>();
  const ftsQuery = buildFtsQuery(criteria);
  if (ftsQuery) {
    const hits = db
      .prepare(
        `SELECT c.id AS chunk_id, c.project_id, bm25(chunks_fts) AS bm25
           FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
          WHERE chunks_fts MATCH ? AND c.project_id IN (${placeholders})`,
      )
      .all(ftsQuery, ...ids) as { chunk_id: number; project_id: string; bm25: number }[];
    for (const h of hits) {
      const prev = keyword.get(h.project_id);
      if (!prev || h.bm25 < prev.bm25) keyword.set(h.project_id, { bm25: h.bm25, chunkId: h.chunk_id });
    }
  }

  // --- Merge with reciprocal rank fusion.
  const meaningOrder = [...ids].sort((a, b) => meaning.get(b)!.score - meaning.get(a)!.score);
  const keywordOrder = [...keyword.keys()].sort((a, b) => keyword.get(a)!.bm25 - keyword.get(b)!.bm25);

  const ranked = candidates.map((c): RankedProject => {
    const meaningRank = meaningOrder.indexOf(c.id) + 1;
    const kwIndex = keywordOrder.indexOf(c.id);
    const keywordRank = kwIndex === -1 ? null : kwIndex + 1;
    const sectorMatch = c.sector !== null && criteria.sectors.includes(c.sector);

    let score = 1 / (RRF_K + meaningRank);
    if (keywordRank !== null) score += 1 / (RRF_K + keywordRank);
    if (sectorMatch) score += 1 / (RRF_K + 1);
    if (c.status === "near_miss") score *= NEAR_MISS_PENALTY;

    // Evidence for the justification step: best chunk per requirement, plus the best keyword chunk.
    const evidence: Evidence[] = [...meaning.get(c.id)!.best];
    const kw = keyword.get(c.id);
    if (kw) evidence.push({ chunkId: kw.chunkId, requirement: null, similarity: null });
    const unique = evidence.filter((e, i) => evidence.findIndex((x) => x.chunkId === e.chunkId) === i);

    return {
      ...c,
      score,
      meaningScore: meaning.get(c.id)!.score,
      meaningRank,
      keywordRank,
      sectorMatch,
      evidence: unique.slice(0, EVIDENCE_PER_PROJECT),
    };
  });

  return ranked.sort((a, b) => b.score - a.score);
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // vectors are unit length, so this is cosine similarity
}

/** OR-query of quoted terms from keywords and requirements, e.g. "LEED" OR "heritage" OR "traffic". */
function buildFtsQuery(criteria: RfpCriteria): string | null {
  const terms = new Set<string>();
  for (const k of criteria.keywords) {
    const clean = k.replace(/"/g, "").trim();
    if (clean) terms.add(clean.toLowerCase());
  }
  for (const req of criteria.requirements) {
    for (const w of req.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      if (w.length > 3 && !STOPWORDS.has(w)) terms.add(w);
    }
  }
  if (!terms.size) return null;
  return [...terms].map((t) => `"${t}"`).join(" OR ");
}
