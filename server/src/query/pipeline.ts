import { extractCriteria, type RfpCriteria } from "./criteria.js";
import { applyFilters, type FilterStatus } from "./filter.js";
import { justifyPicks, type Pick } from "./justify.js";
import { rankCandidates } from "./rank.js";

// The full search: criteria -> filter -> rank -> justify.
// Returns the answer plus a trace of every step, which the frontend shows so
// a user (or an interviewer) can see exactly why each project was chosen.

const TOP_FOR_JUSTIFY = 8;

export type SearchResult = {
  criteria: RfpCriteria;
  filter: {
    asOf: string;
    cutoffDate: string | null;
    relaxed: boolean;
    counts: Record<FilterStatus, number>;
    projects: { id: string; name: string | null; status: FilterStatus; reasons: string[] }[];
  };
  ranking: {
    id: string;
    name: string | null;
    status: FilterStatus;
    score: number;
    meaningScore: number;
    meaningRank: number;
    keywordRank: number | null;
    sectorMatch: boolean;
    sentToLlm: boolean;
  }[];
  picks: (Pick & {
    name: string | null;
    client: string | null;
    clientType: string | null;
    sector: string | null;
    value: number | null;
    completionDate: string | null;
    status: FilterStatus;
    warnings: string[];
  })[];
  verification: { droppedCitations: number; droppedPicks: number };
  timingsMs: Record<string, number>;
};

export async function runSearch(rfpText: string, asOf = new Date().toISOString().slice(0, 10)): Promise<SearchResult> {
  const timingsMs: Record<string, number> = {};
  const time = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const start = Date.now();
    const result = await fn();
    timingsMs[name] = Date.now() - start;
    return result;
  };

  const criteria = await time("criteria", () => extractCriteria(rfpText));
  const count = Math.min(5, Math.max(1, criteria.projectsRequested ?? 3));

  const filtered = await time("filter", () => applyFilters(criteria, asOf, Math.max(5, count + 2)));
  const ranked = await time("rank", () => rankCandidates(criteria, filtered.candidates));
  const top = ranked.slice(0, TOP_FOR_JUSTIFY);
  const justified = await time("justify", () => justifyPicks(criteria, top, count));

  const byId = new Map(ranked.map((p) => [p.id, p]));
  const counts = { pass: 0, near_miss: 0, excluded: 0 };
  for (const p of filtered.projects) counts[p.status]++;

  return {
    criteria,
    filter: {
      asOf: filtered.asOf,
      cutoffDate: filtered.cutoffDate,
      relaxed: filtered.relaxed,
      counts,
      projects: filtered.projects.map((p) => ({ id: p.id, name: p.name, status: p.status, reasons: p.reasons })),
    },
    ranking: ranked.map((p, i) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      score: p.score,
      meaningScore: p.meaningScore,
      meaningRank: p.meaningRank,
      keywordRank: p.keywordRank,
      sectorMatch: p.sectorMatch,
      sentToLlm: i < TOP_FOR_JUSTIFY,
    })),
    picks: justified.picks.map((pick) => {
      const p = byId.get(pick.projectId)!;
      return {
        ...pick,
        name: p.name,
        client: p.client,
        clientType: p.clientType,
        sector: p.sector,
        value: p.value,
        completionDate: p.completionDate,
        status: p.status,
        warnings: p.reasons,
      };
    }),
    verification: { droppedCitations: justified.droppedCitations, droppedPicks: justified.droppedPicks },
    timingsMs,
  };
}
