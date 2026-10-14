export const money = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}M`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const month = (yyyymm: string | null | undefined) => {
  if (!yyyymm) return "—";
  const [y, m] = yyyymm.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

/** "broader_public_sector" -> "Broader public sector" */
export const label = (s: string | null | undefined) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ").replace(/\bk12\b/i, "K-12") : "—";

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export const STATUS_LABEL = { pass: "Meets limits", near_miss: "Near miss", excluded: "Excluded" } as const;
