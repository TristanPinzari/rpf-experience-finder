// Response shapes from the Express API, and small fetch helpers.

export type FilterStatus = "pass" | "near_miss" | "excluded";

export type Criteria = {
  summary: string;
  projectsRequested: number | null;
  minValue: number | null;
  completedWithinYears: number | null;
  clientTypes: string[];
  sectors: string[];
  requirements: string[];
  keywords: string[];
};

export type Citation = { chunkId: number; documentId: number; filename: string; text: string };

export type Pick = {
  projectId: string;
  name: string | null;
  client: string | null;
  clientType: string | null;
  sector: string | null;
  value: number | null;
  completionDate: string | null;
  status: FilterStatus;
  warnings: string[];
  justification: string;
  matched: { requirement: string; citations: Citation[] }[];
  gaps: string[];
};

export type SearchResult = {
  criteria: Criteria;
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
  picks: Pick[];
  verification: { droppedCitations: number; droppedPicks: number };
  timingsMs: Record<string, number>;
};

export type CatalogRow = {
  id: string;
  folder: string;
  name: string | null;
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
  document_count: number;
};

export type Sourced<T> = { value: T | null; source: string | null };

export type ProjectRecord = {
  name: Sourced<string>;
  aliases: string[];
  client: Sourced<string>;
  clientType: Sourced<string>;
  sector: Sourced<string>;
  location: Sourced<string>;
  originalValue: Sourced<number>;
  finalValue: Sourced<number>;
  startDate: Sourced<string>;
  completionDate: Sourced<string>;
  deliveryMethod: Sourced<string>;
  scopeSummary: string;
  features: string[];
  keyPersonnel: { role: string; name: string }[];
  issues: { field: string; severity: "conflict" | "uncertain" | "missing"; description: string }[];
};

export type ProjectDetail = CatalogRow & {
  record: ProjectRecord;
  documents: { id: number; filename: string }[];
  extracted_at: string;
  model: string | null;
};

export type DocumentText = { id: number; filename: string; text: string; project_id: string; project_name: string | null };

export type SampleRfp = { id: string; title: string; asOf: string; requirements: string };

export type EvalData = {
  extraction: {
    overall: { correct: number; total: number };
    perField: Record<string, { correct: number; total: number }>;
    emptyCount: number;
    wrongCount: number;
    silentWrongCount: number;
    errors: { project: string; field: string; kind: "empty" | "wrong"; extracted: unknown; truth: unknown; flagged: boolean }[];
  } | null;
  search: {
    generatedAt: string;
    summary: { rfps: number; chosenTotal: number; recallPicks: number; recallTop5: number; droppedCitations: number };
    results: {
      id: string;
      title: string;
      asOf: string;
      chosen: { id: string; name: string; picked: boolean; inTop5: boolean }[];
      picks: { id: string; name: string | null; companyChose: boolean }[];
      hitsPicks: number;
      hitsTop5: number;
      total: number;
    }[];
  } | null;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  search: (rfpText: string, asOf?: string) =>
    request<SearchResult>("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rfpText, asOf: asOf || undefined }),
    }),
  projects: () => request<CatalogRow[]>("/api/projects"),
  project: (id: string) => request<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`),
  document: (id: number) => request<DocumentText>(`/api/documents/${id}`),
  samples: () => request<SampleRfp[]>("/api/sample-rfps"),
  evaluation: () => request<EvalData>("/api/eval"),
};
