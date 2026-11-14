/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vite-plus/test";
import { createV1Api } from "../worker/api/v1";
import { migrate, verifiedSessionCookie } from "./helpers";

interface Envelope {
  error: { code: string; message: string; requestId: string };
}
interface ProjectDto {
  id: string;
  name: string;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** The /api/v1 request bodies the tests send (intentionally loose). */
interface V1Body {
  name?: string;
  status?: string;
  notes?: string;
}

interface OpenApiOp {
  security?: { bearerAuth?: string[] }[];
}
interface OpenApiSchema {
  example?: unknown;
  properties?: Record<string, { example?: unknown }>;
}
interface OpenApiDoc {
  openapi: string;
  paths: Record<string, Record<string, OpenApiOp>>;
  components: {
    securitySchemes: Record<string, { type: string; scheme?: string }>;
    schemas: Record<string, OpenApiSchema>;
  };
}

/** Create a key for a fresh verified user; returns the plaintext key. */
async function makeKey(email: string, scopes: string[]) {
  const cookie = await verifiedSessionCookie(email);
  const r = await SELF.fetch("https://x/api/api-keys", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "t", scopes, expiresInDays: 30 }),
  });
  expect(r.status).toBe(201);
  return (await r.json<{ data: { key: string } }>()).data.key;
}

function v1(
  key: string | undefined,
  method: string,
  path: string,
  body?: V1Body,
  contentType = "application/json",
) {
  const headers = new Headers();
  if (key) headers.set("authorization", `Bearer ${key}`);
  if (body !== undefined) headers.set("content-type", contentType);
  return SELF.fetch(`https://x${path}`, {
    method,
    headers,
    body:
      body !== undefined
        ? contentType.startsWith("application/json")
          ? JSON.stringify(body)
          : "raw body"
        : undefined,
  });
}

describe("/api/v1", () => {
  beforeAll(migrate);

  it("projects CRUD via key; 400 envelope; not-yours 404; session cookie rejected", async () => {
    const key = await makeKey(`v1a-${crypto.randomUUID()}@t.dev`, [
      "projects:read",
      "projects:write",
    ]);

    const created = await v1(key, "POST", "/api/v1/projects", {
      name: "Agent project",
      notes: "via key",
    });
    expect(created.status).toBe(201);
    const prj = (await created.json<{ data: ProjectDto }>()).data;
    expect(prj.id).toMatch(/^prj_/);

    const listed = await v1(key, "GET", "/api/v1/projects");
    const list = await listed.json<{ data: ProjectDto[] }>();
    expect(list.data.map((p: ProjectDto) => p.id)).toContain(prj.id);

    expect((await v1(key, "GET", `/api/v1/projects/${prj.id}`)).status).toBe(200);
    const patched = await v1(key, "PATCH", `/api/v1/projects/${prj.id}`, { status: "paused" });
    expect(patched.status).toBe(200);
    expect((await patched.json<{ data: ProjectDto }>()).data.status).toBe("paused");
    expect((await v1(key, "DELETE", `/api/v1/projects/${prj.id}`)).status).toBe(204);
    expect((await v1(key, "GET", `/api/v1/projects/${prj.id}`)).status).toBe(404);

    // Validation failure: envelope code + requestId echo.
    const bad = await v1(key, "POST", "/api/v1/projects", { name: "" });
    expect(bad.status).toBe(400);
    const badBody = await bad.json<Envelope>();
    expect(badBody.error.code).toBe("validation_failed");
    expect(badBody.error.requestId).toBe(bad.headers.get("x-request-id"));

    // Another user's project id → 404.
    const other = await makeKey(`v1b-${crypto.randomUUID()}@t.dev`, [
      "projects:read",
      "projects:write",
    ]);
    const mine = (
      await (
        await v1(key, "POST", "/api/v1/projects", { name: "mine" })
      ).json<{ data: ProjectDto }>()
    ).data;
    expect((await v1(other, "GET", `/api/v1/projects/${mine.id}`)).status).toBe(404);

    // Session cookies are never consulted on /api/v1.
    const cookie = await verifiedSessionCookie(`v1c-${crypto.randomUUID()}@t.dev`);
    const byCookie = await SELF.fetch("https://x/api/v1/projects", { headers: { cookie } });
    expect(byCookie.status).toBe(401);
  });

  it("scopes: read-only key → 403 insufficient_scope on writes, 200 on read", async () => {
    const key = await makeKey(`v1d-${crypto.randomUUID()}@t.dev`, ["projects:read"]);
    for (const [method, path, body] of [
      ["POST", "/api/v1/projects", { name: "x" }],
      ["PATCH", "/api/v1/projects/prj_nope", { name: "x" }],
      ["DELETE", "/api/v1/projects/prj_nope", undefined],
    ] as const) {
      const r = await v1(key, method, path, body);
      expect(r.status).toBe(403);
      expect((await r.json<Envelope>()).error.code).toBe("insufficient_scope");
    }
    expect((await v1(key, "GET", "/api/v1/projects")).status).toBe(200);
  });

  it("415 for non-JSON writes; charset suffix OK; unknown path → 404 envelope", async () => {
    const key = await makeKey(`v1e-${crypto.randomUUID()}@t.dev`, ["projects:write"]);
    const plain = await v1(key, "POST", "/api/v1/projects", { name: "x" }, "text/plain");
    expect(plain.status).toBe(415);
    expect((await plain.json<Envelope>()).error.code).toBe("unsupported_media_type");

    const utf8 = await v1(
      key,
      "POST",
      "/api/v1/projects",
      { name: "ok" },
      "application/json; charset=utf-8",
    );
    expect(utf8.status).toBe(201);

    const nope = await v1(key, "GET", "/api/v1/nope");
    expect(nope.status).toBe(404);
    expect((await nope.json<Envelope>()).error.code).toBe("not_found");
  });

  it("openapi.json: 401 without key, 200 with any key, public when publicSpec", async () => {
    const key = await makeKey(`v1f-${crypto.randomUUID()}@t.dev`, ["projects:read"]);

    expect((await v1(undefined, "GET", "/api/v1/openapi.json")).status).toBe(401);

    const ok = await v1(key, "GET", "/api/v1/openapi.json");
    expect(ok.status).toBe(200);
    const doc = await ok.json<OpenApiDoc>();

    expect(doc.openapi).toMatch(/^3\.1\./);

    // Every path lives under /api/v1 and all six operations exist.
    const paths = Object.keys(doc.paths);
    for (const p of paths) expect(p.startsWith("/api/v1/")).toBe(true);
    expect(paths).toContain("/api/v1/me");
    expect(paths).toContain("/api/v1/projects");
    expect(paths).toContain("/api/v1/projects/{id}");
    const ops = paths.flatMap((p) => Object.keys(doc.paths[p]));
    expect(new Set(ops)).toEqual(new Set(["get", "post", "patch", "delete"]));
    expect(ops).toHaveLength(6);

    // Every operation is secured with bearerAuth; the scheme is http/bearer.
    for (const p of paths)
      for (const m of Object.keys(doc.paths[p]))
        expect(doc.paths[p][m].security).toEqual([{ bearerAuth: [] }]);
    expect(doc.components.securitySchemes.bearerAuth).toEqual({ type: "http", scheme: "bearer" });

    // Every component schema carries an example somewhere (top level or a
    // property) — dropped a full meta-schema validation because ajv codegen
    // is forbidden in workerd.
    for (const name of Object.keys(doc.components.schemas)) {
      const schema = doc.components.schemas[name];
      const hasExample =
        schema.example !== undefined ||
        Object.keys(schema.properties ?? {}).some(
          (p) => schema.properties![p].example !== undefined,
        );
      expect(hasExample, `schema ${name} lacks an example`).toBe(true);
    }

    // Public spec: fresh factory instance — no key needed.
    const pub = createV1Api({ publicSpec: true });
    const res = await pub.request("/api/v1/openapi.json", {}, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { openapi: string }).openapi).toMatch(/^3\.1\./);
  });

  it("rate limit: 21 keyed requests → 429 with Retry-After; 200s carry policy headers", async () => {
    const key = await makeKey(`v1g-${crypto.randomUUID()}@t.dev`, ["projects:read"]);
    let last = 0;
    let headers: Headers | null = null;
    for (let i = 0; i < 21; i++) {
      const r = await v1(key, "GET", "/api/v1/me");
      last = r.status;
      headers = r.headers;
      if (r.status === 429) break;
    }
    expect(last).toBe(429);
    expect(headers!.get("retry-after")).toBe("60");
    const first = await v1(
      key === "" ? key : await makeKey(`v1h-${crypto.randomUUID()}@t.dev`, ["projects:read"]),
      "GET",
      "/api/v1/me",
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("ratelimit-limit")).toBe("120");
    expect(first.headers.get("ratelimit-policy")).toBe("120;w=60");
  });
});
