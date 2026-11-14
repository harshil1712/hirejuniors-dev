/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vite-plus/test";
import { createV1Api } from "../worker/api/v1";
import { migrate, adminSessionCookie, seedCompany, seedSource, seedJob } from "./helpers";

interface Envelope {
  error: { code: string; message: string; requestId: string };
}
interface CompanyDto {
  id: string;
  name: string;
  slug: string;
}
interface JobDto {
  id: string;
  status: string;
  retireReason: string | null;
}

/** The /api/v1 request bodies the tests send (intentionally loose). */
interface V1Body {
  name?: string;
  slug?: string;
  status?: string;
  companyId?: string;
  platform?: string;
  board?: string;
  config?: string;
  includeAll?: boolean;
  enabled?: boolean;
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

/** Create a key for a fresh verified ADMIN user — every v1 resource route
 * requires the admin role. Returns the plaintext key. */
async function makeKey(email: string, scopes: string[]) {
  const cookie = await adminSessionCookie(email);
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

  it("companies CRUD via key; 400 envelope; 404 unknown id; session cookie rejected", async () => {
    const key = await makeKey(`v1a-${crypto.randomUUID()}@t.dev`, ["jobs:read", "jobs:write"]);

    const created = await v1(key, "POST", "/api/v1/companies", {
      name: "Agent Company",
    });
    expect(created.status).toBe(201);
    const company = (await created.json<{ data: CompanyDto }>()).data;
    expect(company.id).toMatch(/^cmp_/);
    expect(company.slug).toBe("agent-company");

    const listed = await v1(key, "GET", "/api/v1/companies");
    const list = await listed.json<{ data: CompanyDto[] }>();
    expect(list.data.map((p: CompanyDto) => p.id)).toContain(company.id);

    const patched = await v1(key, "PATCH", `/api/v1/companies/${company.id}`, {
      slug: "agent-co",
    });
    expect(patched.status).toBe(200);
    expect((await patched.json<{ data: CompanyDto }>()).data.slug).toBe("agent-co");
    expect((await v1(key, "GET", "/api/v1/jobs/job_nope")).status).toBe(404);

    // Validation failure: envelope code + requestId echo.
    const bad = await v1(key, "POST", "/api/v1/companies", { name: "" });
    expect(bad.status).toBe(400);
    const badBody = await bad.json<Envelope>();
    expect(badBody.error.code).toBe("validation_failed");
    expect(badBody.error.requestId).toBe(bad.headers.get("x-request-id"));

    // Session cookies are never consulted on /api/v1.
    const cookie = await adminSessionCookie(`v1c-${crypto.randomUUID()}@t.dev`);
    const byCookie = await SELF.fetch("https://x/api/v1/jobs", { headers: { cookie } });
    expect(byCookie.status).toBe(401);
  });

  it("jobs read + PATCH via key", async () => {
    const key = await makeKey(`v1j-${crypto.randomUUID()}@t.dev`, ["jobs:read", "jobs:write"]);
    const { id: cid } = await seedCompany({ name: "V1 Co" });
    const sid = await seedSource(cid);
    const jid = await seedJob(sid, cid);

    const listed = await v1(key, "GET", `/api/v1/jobs?sourceId=${sid}`);
    const list = await listed.json<{ data: JobDto[] }>();
    expect(list.data.map((j: JobDto) => j.id)).toContain(jid);

    const patched = await v1(key, "PATCH", `/api/v1/jobs/${jid}`, { status: "retired" });
    expect(patched.status).toBe(200);
    const updated = (await patched.json<{ data: JobDto }>()).data;
    expect(updated.status).toBe("retired");
    expect(updated.retireReason).toBe("manual");
  });

  it("scopes: read-only key → 403 insufficient_scope on writes, 200 on read", async () => {
    const key = await makeKey(`v1d-${crypto.randomUUID()}@t.dev`, ["jobs:read"]);
    for (const [method, path, body] of [
      ["POST", "/api/v1/companies", { name: "x" }],
      ["PATCH", "/api/v1/jobs/job_nope", { status: "retired" }],
      ["POST", "/api/v1/runs", {} as V1Body],
    ] as const) {
      const r = await v1(key, method, path, body);
      expect(r.status).toBe(403);
      expect((await r.json<Envelope>()).error.code).toBe("insufficient_scope");
    }
    expect((await v1(key, "GET", "/api/v1/jobs")).status).toBe(200);
  });

  it("415 for non-JSON writes; charset suffix OK; unknown path → 404 envelope", async () => {
    const key = await makeKey(`v1e-${crypto.randomUUID()}@t.dev`, ["jobs:write"]);
    const plain = await v1(key, "POST", "/api/v1/companies", { name: "x" }, "text/plain");
    expect(plain.status).toBe(415);
    expect((await plain.json<Envelope>()).error.code).toBe("unsupported_media_type");

    const utf8 = await v1(
      key,
      "POST",
      "/api/v1/companies",
      { name: "ok" },
      "application/json; charset=utf-8",
    );
    expect(utf8.status).toBe(201);

    const nope = await v1(key, "GET", "/api/v1/nope");
    expect(nope.status).toBe(404);
    expect((await nope.json<Envelope>()).error.code).toBe("not_found");
  });

  it("openapi.json: 401 without key, 200 with any key, public when publicSpec", async () => {
    const key = await makeKey(`v1f-${crypto.randomUUID()}@t.dev`, ["jobs:read"]);

    expect((await v1(undefined, "GET", "/api/v1/openapi.json")).status).toBe(401);

    const ok = await v1(key, "GET", "/api/v1/openapi.json");
    expect(ok.status).toBe(200);
    const doc = await ok.json<OpenApiDoc>();

    expect(doc.openapi).toMatch(/^3\.1\./);

    // Every path lives under /api/v1 and all operations exist.
    const paths = Object.keys(doc.paths);
    for (const p of paths) expect(p.startsWith("/api/v1/")).toBe(true);
    expect(new Set(paths)).toEqual(
      new Set([
        "/api/v1/me",
        "/api/v1/jobs",
        "/api/v1/jobs/{id}",
        "/api/v1/companies",
        "/api/v1/companies/{id}",
        "/api/v1/sources",
        "/api/v1/sources/preview",
        "/api/v1/sources/{id}",
        "/api/v1/runs",
        "/api/v1/runs/{id}",
      ]),
    );
    const ops = paths.flatMap((p) => Object.keys(doc.paths[p]));
    expect(new Set(ops)).toEqual(new Set(["get", "post", "patch"]));
    expect(ops).toHaveLength(14);

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
    const key = await makeKey(`v1g-${crypto.randomUUID()}@t.dev`, ["jobs:read"]);
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
      key === "" ? key : await makeKey(`v1h-${crypto.randomUUID()}@t.dev`, ["jobs:read"]),
      "GET",
      "/api/v1/me",
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("ratelimit-limit")).toBe("120");
    expect(first.headers.get("ratelimit-policy")).toBe("120;w=60");
  });
});
