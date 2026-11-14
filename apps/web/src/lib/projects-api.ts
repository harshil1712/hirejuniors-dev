import type { Project, ProjectCreate, ProjectUpdate } from "../../worker/api/schemas";

interface Envelope {
  error?: { code?: string; message?: string };
}

interface ListResult {
  data: Project[];
  nextCursor: string | null;
}

async function request<T>(
  method: string,
  path: string,
  body?: ProjectCreate | ProjectUpdate,
): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    let message: string | undefined;
    try {
      message = ((await res.json()) as Envelope)?.error?.message;
    } catch {
      // fall through to the generic message
    }
    throw new Error(message ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const PAGE_SIZE = 50;

export function listProjects(cursor?: string): Promise<ListResult> {
  const q = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
  return request<ListResult>("GET", `/api/projects?limit=${PAGE_SIZE}${q}`);
}

export function createProject(input: ProjectCreate): Promise<Project> {
  return request<{ data: Project }>("POST", "/api/projects", input).then((r) => r.data);
}

export function updateProject(id: string, patch: ProjectUpdate): Promise<Project> {
  return request<{ data: Project }>("PATCH", `/api/projects/${encodeURIComponent(id)}`, patch).then(
    (r) => r.data,
  );
}

export function deleteProject(id: string): Promise<void> {
  return request<void>("DELETE", `/api/projects/${encodeURIComponent(id)}`);
}
