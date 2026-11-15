import { hc, type ClientResponse, type InferResponseType } from "hono/client";
import type { ApiRoutes } from "../../worker/api";

const client = hc<ApiRoutes>("/api");

interface Envelope {
  error?: { code?: string; message?: string };
}

/** Success body of a `hc` call: distribute over the response union and keep
 * the 2xx members. */
type Ok<R> =
  R extends ClientResponse<infer B, infer S, "json">
    ? S extends 200 | 201 | 202
      ? B
      : never
    : never;

/** Non-2xx → `Error` carrying `code`/`status` from the error envelope. */
async function request<R extends ClientResponse<unknown, number, "json">>(
  res: Promise<R>,
): Promise<Ok<R>> {
  const r = await res;
  if (!r.ok) {
    let message: string | undefined;
    let code: string | undefined;
    try {
      const env = (await r.json()) as Envelope;
      message = env?.error?.message;
      code = env?.error?.code;
    } catch {
      // fall through to the generic message
    }
    const err = new Error(message ?? `Request failed (${r.status})`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = code;
    err.status = r.status;
    throw err;
  }
  return r.json() as Promise<Ok<R>>;
}

const PAGE_SIZE = 50;

export type Job = InferResponseType<(typeof client.jobs)[":id"]["$get"], 200>["data"];
export type JobStatus = Job["status"];
export type Company = InferResponseType<typeof client.companies.$get, 200>["data"][number];
export type Source = InferResponseType<typeof client.sources.$get, 200>["data"][number];
export type IngestRun = InferResponseType<typeof client.runs.$get, 200>["data"][number];
export type SourceRun = InferResponseType<
  (typeof client.runs)[":id"]["$get"],
  200
>["data"]["sourceRuns"][number];
export type DashboardSummary = InferResponseType<typeof client.dashboard.$get, 200>;
export type DiscoveryCandidate = InferResponseType<
  typeof client.discovery.$get,
  200
>["data"][number];
export type SourcePreviewResult = InferResponseType<typeof client.sources.preview.$post, 200>;
export type SourcePlatform = Source["platform"];

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
  return request(client.jobs.$get({ query: Object.fromEntries(params) }));
}

export function getJob(id: string): Promise<Job> {
  return request(client.jobs[":id"].$get({ param: { id } })).then((r) => r.data);
}

export function setJobStatus(id: string, status: "active" | "retired"): Promise<Job> {
  return request(client.jobs[":id"].$patch({ param: { id }, json: { status } })).then(
    (r) => r.data,
  );
}

export function approveJob(id: string, level: NonNullable<Job["level"]>): Promise<Job> {
  return request(client.jobs[":id"].approve.$post({ param: { id }, json: { level } })).then(
    (r) => r.data,
  );
}

export function rejectJob(id: string): Promise<Job> {
  return request(client.jobs[":id"].reject.$post({ param: { id } })).then((r) => r.data);
}

export function listDiscovery(
  status?: string,
): Promise<{ data: DiscoveryCandidate[]; nextCursor: string | null }> {
  return request(
    client.discovery.$get({
      query: status ? { status: status as DiscoveryCandidate["status"] } : {},
    }),
  ) as Promise<{ data: DiscoveryCandidate[]; nextCursor: string | null }>;
}

export function addDiscovery(domains: string[]): Promise<{ added: number }> {
  return request(client.discovery.$post({ json: { domains } })).then((r) => r.data);
}

export function listCompanies(): Promise<Company[]> {
  return request(client.companies.$get()).then((r) => r.data);
}

type CompanyCreateInput = Parameters<typeof client.companies.$post>[0]["json"];

export function createCompany(input: CompanyCreateInput): Promise<Company> {
  return request(client.companies.$post({ json: input })).then((r) => r.data);
}

export function listSources(): Promise<Source[]> {
  return request(client.sources.$get()).then((r) => r.data);
}

type SourceCreateInput = Parameters<typeof client.sources.$post>[0]["json"];
type SourceUpdateInput = Parameters<(typeof client.sources)[":id"]["$patch"]>[0]["json"];
type SourcePreviewInput = Parameters<typeof client.sources.preview.$post>[0]["json"];

export function createSource(input: SourceCreateInput): Promise<Source> {
  return request(client.sources.$post({ json: input })).then((r) => r.data);
}

export function updateSource(id: string, patch: SourceUpdateInput): Promise<Source> {
  return request(client.sources[":id"].$patch({ param: { id }, json: patch })).then((r) => r.data);
}

export function previewSource(input: SourcePreviewInput): Promise<SourcePreviewResult["data"]> {
  return request(client.sources.preview.$post({ json: input })).then((r) => r.data);
}

export function listRuns(
  cursor?: string,
): Promise<{ data: IngestRun[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  return request(client.runs.$get({ query: Object.fromEntries(params) }));
}

export function getRun(id: string): Promise<IngestRun & { sourceRuns: SourceRun[] }> {
  return request(client.runs[":id"].$get({ param: { id } })).then((r) => r.data);
}

export function triggerRun(): Promise<{ instanceId: string }> {
  return request(client.runs.$post()).then((r) => r.data);
}

export function getDashboardSummary(): Promise<DashboardSummary["data"]> {
  return request(client.dashboard.$get()).then((r) => r.data);
}
