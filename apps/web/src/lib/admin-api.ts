import type {
  Company,
  CompanyCreate,
  CompanyUpdate,
  DashboardSummary,
  IngestRun,
  Job,
  JobStatus,
  JobUpdate,
  Source,
  SourceCreate,
  SourcePreview,
  SourcePreviewResult,
  SourceRun,
  SourceUpdate,
} from "../../worker/api/schemas";

interface Envelope {
  error?: { code?: string; message?: string };
}

type ApiBody =
  | JobUpdate
  | CompanyCreate
  | CompanyUpdate
  | SourceCreate
  | SourceUpdate
  | SourcePreview
  | { level: string }
  | { domains: string[] };

async function request<T>(method: string, path: string, body?: ApiBody): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    let message: string | undefined;
    let code: string | undefined;
    try {
      const env = (await res.json()) as Envelope;
      message = env?.error?.message;
      code = env?.error?.code;
    } catch {
      // fall through to the generic message
    }
    const err = new Error(message ?? `Request failed (${res.status})`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = code;
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const PAGE_SIZE = 50;

export interface JobFilters {
  status?: JobStatus;
  level?: string;
  country?: string;
  companyId?: string;
  sourceId?: string;
  q?: string;
}

export function listJobs(
  filters: JobFilters,
  cursor?: string,
): Promise<{ data: Job[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (filters.status) params.set("status", filters.status);
  if (filters.level) params.set("level", filters.level);
  if (filters.country) params.set("country", filters.country);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.sourceId) params.set("sourceId", filters.sourceId);
  if (filters.q) params.set("q", filters.q);
  if (cursor) params.set("cursor", cursor);
  return request("GET", `/api/jobs?${params}`);
}

export function getJob(id: string): Promise<Job> {
  return request<{ data: Job }>("GET", `/api/jobs/${encodeURIComponent(id)}`).then((r) => r.data);
}

export function setJobStatus(id: string, status: "active" | "retired"): Promise<Job> {
  const body: JobUpdate = { status };
  return request<{ data: Job }>("PATCH", `/api/jobs/${encodeURIComponent(id)}`, body).then(
    (r) => r.data,
  );
}

export function approveJob(id: string, level: string): Promise<Job> {
  return request<{ data: Job }>("POST", `/api/jobs/${encodeURIComponent(id)}/approve`, {
    level,
  }).then((r) => r.data);
}

export function rejectJob(id: string): Promise<Job> {
  return request<{ data: Job }>("POST", `/api/jobs/${encodeURIComponent(id)}/reject`).then(
    (r) => r.data,
  );
}

export interface DiscoveryCandidate {
  id: string;
  origin: "manual" | "crawl";
  input: string;
  status: "queued" | "found" | "not_found" | "duplicate" | "failed";
  platform: string | null;
  board: string | null;
  sourceId: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export function listDiscovery(
  status?: string,
): Promise<{ data: DiscoveryCandidate[]; nextCursor: string | null }> {
  return request("GET", `/api/discovery${status ? `?status=${status}` : ""}`);
}

export function addDiscovery(domains: string[]): Promise<{ added: number }> {
  return request<{ data: { added: number } }>("POST", "/api/discovery", { domains }).then(
    (r) => r.data,
  );
}

export function listCompanies(): Promise<Company[]> {
  return request<{ data: Company[] }>("GET", "/api/companies").then((r) => r.data);
}

export function createCompany(input: CompanyCreate): Promise<Company> {
  return request<{ data: Company }>("POST", "/api/companies", input).then((r) => r.data);
}

export function updateCompany(id: string, patch: CompanyUpdate): Promise<Company> {
  return request<{ data: Company }>(
    "PATCH",
    `/api/companies/${encodeURIComponent(id)}`,
    patch,
  ).then((r) => r.data);
}

export function listSources(): Promise<Source[]> {
  return request<{ data: Source[] }>("GET", "/api/sources").then((r) => r.data);
}

export function createSource(input: SourceCreate): Promise<Source> {
  return request<{ data: Source }>("POST", "/api/sources", input).then((r) => r.data);
}

export function updateSource(id: string, patch: SourceUpdate): Promise<Source> {
  return request<{ data: Source }>("PATCH", `/api/sources/${encodeURIComponent(id)}`, patch).then(
    (r) => r.data,
  );
}

export function previewSource(input: SourcePreview): Promise<SourcePreviewResult["data"]> {
  return request<SourcePreviewResult>("POST", "/api/sources/preview", input).then((r) => r.data);
}

export function listRuns(
  cursor?: string,
): Promise<{ data: IngestRun[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  return request("GET", `/api/runs?${params}`);
}

export function getRun(id: string): Promise<IngestRun & { sourceRuns: SourceRun[] }> {
  return request<{ data: IngestRun & { sourceRuns: SourceRun[] } }>(
    "GET",
    `/api/runs/${encodeURIComponent(id)}`,
  ).then((r) => r.data);
}

export function triggerRun(): Promise<{ instanceId: string }> {
  return request<{ data: { instanceId: string } }>("POST", "/api/runs").then((r) => r.data);
}

export function getDashboardSummary(): Promise<DashboardSummary["data"]> {
  return request<DashboardSummary>("GET", "/api/dashboard").then((r) => r.data);
}
