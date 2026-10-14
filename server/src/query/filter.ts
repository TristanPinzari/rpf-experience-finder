import { getDb } from "../db/db.js";
import type { ClientType, Sector } from "../domain/taxonomy.js";
import type { RfpCriteria } from "./criteria.js";

// Step 2: apply the hard limits to the structured catalog.
//
// Projects that miss a limit by a small margin are "near misses". They are only
// let back in when too few projects pass strictly, and they always carry a
// warning. Missing data never silently excludes a project: it becomes a warning.

export type CatalogProject = {
  id: string;
  name: string | null;
  client: string | null;
  clientType: ClientType | null;
  sector: Sector | null;
  location: string | null;
  value: number | null;
  completionDate: string | null;
  needsReview: boolean;
};

export type FilterStatus = "pass" | "near_miss" | "excluded";
export type FilteredProject = CatalogProject & { status: FilterStatus; reasons: string[] };

export type FilterResult = {
  asOf: string;
  cutoffDate: string | null;
  projects: FilteredProject[];
  candidates: FilteredProject[];
  relaxed: boolean;
};

const NEAR_VALUE_RATIO = 0.8; // within 20% of the minimum value
const NEAR_MONTHS = 12; // finished up to a year before the cutoff

const fmtMoney = (v: number) => `$${(v / 1_000_000).toFixed(1)}M`;

function shiftMonths(yyyymm: string, months: number): string {
  const [y, m] = yyyymm.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function loadCatalog(): CatalogProject[] {
  const rows = getDb()
    .prepare("SELECT id, name, client, client_type, sector, location, original_value, final_value, completion_date, needs_review FROM projects")
    .all() as Record<string, any>[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    client: r.client,
    clientType: r.client_type,
    sector: r.sector,
    location: r.location,
    value: r.final_value ?? r.original_value, // final value after change orders when known
    completionDate: r.completion_date,
    needsReview: r.needs_review === 1,
  }));
}

export function applyFilters(criteria: RfpCriteria, asOf: string, minCandidates: number): FilterResult {
  const asOfMonth = asOf.slice(0, 7);
  const cutoffDate =
    criteria.completedWithinYears !== null ? shiftMonths(asOfMonth, -Math.round(criteria.completedWithinYears * 12)) : null;

  const projects: FilteredProject[] = loadCatalog().map((p) => {
    const hard: string[] = []; // fails outright
    const near: string[] = []; // fails by a small margin
    const warn: string[] = []; // passes, but a human should double-check

    if (p.completionDate && p.completionDate > asOfMonth) hard.push(`completed ${p.completionDate}, after the RFP date`);
    if (cutoffDate) {
      if (!p.completionDate) warn.push("completion date unknown");
      else if (p.completionDate < cutoffDate) {
        (p.completionDate >= shiftMonths(cutoffDate, -NEAR_MONTHS) ? near : hard).push(
          `completed ${p.completionDate}, before the ${cutoffDate} cutoff`,
        );
      }
    }
    if (criteria.minValue !== null) {
      if (p.value === null) warn.push("contract value unknown");
      else if (p.value < criteria.minValue) {
        (p.value >= criteria.minValue * NEAR_VALUE_RATIO ? near : hard).push(
          `value ${fmtMoney(p.value)} is below the ${fmtMoney(criteria.minValue)} minimum`,
        );
      }
    }
    if (criteria.clientTypes.length) {
      if (!p.clientType) warn.push("client type unknown");
      else if (!criteria.clientTypes.includes(p.clientType)) hard.push(`client type ${p.clientType} not accepted`);
    }
    if (p.needsReview) warn.push("catalog record is flagged for review");

    const status: FilterStatus = hard.length ? "excluded" : near.length ? "near_miss" : "pass";
    return { ...p, status, reasons: [...hard, ...near, ...warn] };
  });

  const passing = projects.filter((p) => p.status === "pass");
  const relaxed = passing.length < minCandidates;
  const candidates = relaxed ? projects.filter((p) => p.status !== "excluded") : passing;
  return { asOf: asOfMonth, cutoffDate, projects, candidates, relaxed };
}
