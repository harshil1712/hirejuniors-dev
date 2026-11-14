/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vite-plus/test";
import type { ProjectCreate, ProjectUpdate } from "../worker/api/schemas";
import { migrate, verifiedSessionCookie, PASSWORD } from "./helpers";

interface Envelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: { path: string; message: string }[];
  };
}
interface ProjectDto {
  id: string;
  name: string;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

function req(cookie: string, method: string, path: string, body?: ProjectCreate | ProjectUpdate) {
  const headers = new Headers({ cookie });
  if (body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`https://x${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("projects api", () => {
  beforeAll(migrate);

  it("401 without a session, with the unauthorized envelope", async () => {
    const r = await req("", "GET", "/api/projects");
    expect(r.status).toBe(401);
    const j = await r.json<Envelope>();
    expect(j.error.code).toBe("unauthorized");
    expect(j.error.requestId).toBe(r.headers.get("x-request-id"));
  });

  it("create → list → get → patch → delete → get 404", async () => {
    const cookie = await verifiedSessionCookie(`p1-${crypto.randomUUID()}@t.dev`);

    const created = await req(cookie, "POST", "/api/projects", { name: "Demo", notes: "n" });
    expect(created.status).toBe(201);
    const prj = (await created.json<{ data: ProjectDto }>()).data;
    expect(prj.id).toMatch(/^prj_/);
    expect(prj.status).toBe("active");
    expect(prj.notes).toBe("n");
    expect(Date.parse(prj.createdAt)).not.toBeNaN();

    const listed = await req(cookie, "GET", "/api/projects");
    const list = await listed.json<{ data: ProjectDto[]; nextCursor: string | null }>();
    expect(list.data.map((p: ProjectDto) => p.id)).toContain(prj.id);

    const got = await req(cookie, "GET", `/api/projects/${prj.id}`);
    expect(got.status).toBe(200);
    expect((await got.json<{ data: ProjectDto }>()).data.name).toBe("Demo");

    const patched = await req(cookie, "PATCH", `/api/projects/${prj.id}`, {
      status: "paused",
      notes: "later",
    });
    expect(patched.status).toBe(200);
    const upd = (await patched.json<{ data: ProjectDto }>()).data;
    expect(upd.status).toBe("paused");
    expect(upd.notes).toBe("later");
    expect(upd.name).toBe("Demo");
    expect(Date.parse(upd.updatedAt)).toBeGreaterThanOrEqual(Date.parse(prj.updatedAt));

    const del = await req(cookie, "DELETE", `/api/projects/${prj.id}`);
    expect(del.status).toBe(204);

    const gone = await req(cookie, "GET", `/api/projects/${prj.id}`);
    expect(gone.status).toBe(404);
    expect((await gone.json<Envelope>()).error.code).toBe("not_found");
  });

  it("empty name → 400 envelope with requestId and details[0].path === 'name'", async () => {
    const cookie = await verifiedSessionCookie(`p2-${crypto.randomUUID()}@t.dev`);
    const r = await req(cookie, "POST", "/api/projects", { name: "" });
    expect(r.status).toBe(400);
    const j = await r.json<Envelope>();
    expect(j.error.code).toBe("validation_failed");
    expect(j.error.requestId).toBe(r.headers.get("x-request-id"));
    expect(j.error.details?.[0].path).toBe("name");
  });

  it("PATCH {} → 400", async () => {
    const cookie = await verifiedSessionCookie(`p3-${crypto.randomUUID()}@t.dev`);
    const c = await req(cookie, "POST", "/api/projects", { name: "x" });
    const id = (await c.json<{ data: ProjectDto }>()).data.id;
    const r = await req(cookie, "PATCH", `/api/projects/${id}`, {});
    expect(r.status).toBe(400);
    expect((await r.json<Envelope>()).error.code).toBe("validation_failed");
  });

  it("another user's project → 404 on get/patch/delete", async () => {
    const c1 = await verifiedSessionCookie(`pa-${crypto.randomUUID()}@t.dev`);
    const c2 = await verifiedSessionCookie(`pb-${crypto.randomUUID()}@t.dev`);
    const c = await req(c1, "POST", "/api/projects", { name: "mine" });
    const id = (await c.json<{ data: ProjectDto }>()).data.id;

    for (const m of ["GET", "PATCH", "DELETE"] as const) {
      const r = await req(c2, m, `/api/projects/${id}`, m === "PATCH" ? { name: "y" } : undefined);
      expect(r.status).toBe(404);
      expect((await r.json<Envelope>()).error.code).toBe("not_found");
    }
    // and the owner's copy still exists
    expect((await req(c1, "GET", `/api/projects/${id}`)).status).toBe(200);
  });

  it("pagination: limit=2 → 2 + cursor → 1 + null, no overlap; status filter; bad cursor → 400", async () => {
    const cookie = await verifiedSessionCookie(`p4-${crypto.randomUUID()}@t.dev`);
    const ids: string[] = [];
    for (const [name, status] of [
      ["a", "active"],
      ["b", "paused"],
      ["c", "active"],
    ] as const) {
      const r = await req(cookie, "POST", "/api/projects", { name, status });
      expect(r.status).toBe(201);
      ids.push((await r.json<{ data: ProjectDto }>()).data.id);
    }

    const p1 = await req(cookie, "GET", "/api/projects?limit=2");
    const j1 = await p1.json<{ data: ProjectDto[]; nextCursor: string | null }>();
    expect(j1.data).toHaveLength(2);
    expect(j1.nextCursor).toBeTruthy();

    const p2 = await req(cookie, "GET", `/api/projects?limit=2&cursor=${j1.nextCursor}`);
    const j2 = await p2.json<{ data: ProjectDto[]; nextCursor: string | null }>();
    expect(j2.data).toHaveLength(1);
    expect(j2.nextCursor).toBeNull();

    const all = [...j1.data, ...j2.data].map((p: ProjectDto) => p.id).sort();
    expect(all).toEqual([...ids].sort());

    const filtered = await req(cookie, "GET", "/api/projects?status=paused");
    const jf = await filtered.json<{ data: ProjectDto[] }>();
    expect(jf.data).toHaveLength(1);
    expect(jf.data[0].status).toBe("paused");

    const bad = await req(cookie, "GET", "/api/projects?cursor=!!!bogus!!!");
    expect(bad.status).toBe(400);
    expect((await bad.json<Envelope>()).error.code).toBe("validation_failed");
  });

  it("deleting the user cascades their projects", async () => {
    const email = `pd-${crypto.randomUUID()}@t.dev`;
    const cookie = await verifiedSessionCookie(email);
    const c = await req(cookie, "POST", "/api/projects", { name: "doomed" });
    const id = (await c.json<{ data: ProjectDto }>()).data.id;

    const del = await SELF.fetch("https://x/api/auth/delete-user", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "http://localhost:8787",
      },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(del.status).toBe(200);

    const row = await env.DB.prepare("SELECT id FROM project WHERE id = ?").bind(id).first();
    expect(row).toBeNull();
  });
});
