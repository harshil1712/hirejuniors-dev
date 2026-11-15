/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vite-plus/test";
import {
  migrate,
  accessFetch,
  anonFetch,
  OWNER,
  seedCompany,
  seedSource,
  seedJob,
  seedRun,
  seedSourceRun,
} from "./helpers";

interface Envelope {
  error: { code: string; message: string; requestId: string };
}
interface JobDto {
  id: string;
  title: string;
  status: string;
  level: string;
  countryCode: string | null;
  retiredAt: string | null;
  retireReason: string | null;
  company: { id: string; name: string; slug: string };
  firstSeenAt: string;
}
interface CompanyDto {
  id: string;
  name: string;
  slug: string;
}
interface SourceDto {
  id: string;
  platform: string;
  board: string;
  enabled: boolean;
  activeJobs: number;
  company: { id: string; name: string };
  lastStatus: string | null;
}
interface RunDto {
  id: string;
  status: string;
  sourceRuns?: { id: string; sourceId: string; status: string; error: string | null }[];
}
interface RequestBody {
  status?: string;
  name?: string;
  slug?: string;
  homepageUrl?: string;
  companyId?: string;
  platform?: string;
  board?: string;
  config?: string;
  includeAll?: boolean;
  enabled?: boolean;
}

function req(email: string | null, method: string, path: string, body?: RequestBody) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return accessFetch(path, init, email);
}

beforeAll(migrate);

function session(method: string, path: string, body?: RequestBody) {
  return req(OWNER, method, path, body);
}

describe("jobs api", () => {
  it("401 without Access; 403 non-owner identity; owner OK", async () => {
    const anon = await anonFetch("/api/jobs");
    expect(anon.status).toBe(401);

    const forbidden = await req(`plain-${crypto.randomUUID()}@t.dev`, "GET", "/api/jobs");
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as Envelope).error.code).toBe("forbidden");

    const ok = await req(OWNER, "GET", "/api/jobs");
    expect(ok.status).toBe(200);
  });

  it("list: filters (status, level, country, q) and keyset pagination with no duplicates", async () => {
    const { id: cid } = await seedCompany({ name: "FilterCo" });
    const sid = await seedSource(cid);
    const base = Date.now() - 60_000;
    await seedJob(sid, cid, {
      title: "Frontend Intern",
      level: "internship",
      countryCode: "US",
      firstSeenAt: new Date(base),
    });
    await seedJob(sid, cid, {
      title: "Graduate Data Analyst",
      level: "graduate",
      countryCode: "GB",
      firstSeenAt: new Date(base + 1000),
    });
    await seedJob(sid, cid, {
      title: "Junior DevOps Engineer",
      level: "junior",
      countryCode: "US",
      status: "retired",
      retiredAt: new Date(),
      retireReason: "missing_from_feed",
      firstSeenAt: new Date(base + 2000),
    });

    const active = (await (await session("GET", `/api/jobs?sourceId=${sid}`)).json()) as {
      data: JobDto[];
    };
    expect(active.data).toHaveLength(2);

    const retired = (await (
      await session("GET", `/api/jobs?status=retired&sourceId=${sid}`)
    ).json()) as { data: JobDto[] };
    expect(retired.data).toHaveLength(1);
    expect(retired.data[0].retireReason).toBe("missing_from_feed");

    const byLevel = (await (
      await session("GET", `/api/jobs?level=graduate&sourceId=${sid}`)
    ).json()) as { data: JobDto[] };
    expect(byLevel.data.map((j: JobDto) => j.title)).toEqual(["Graduate Data Analyst"]);

    const byCountry = (await (
      await session("GET", `/api/jobs?country=us&sourceId=${sid}`)
    ).json()) as { data: JobDto[] };
    expect(byCountry.data.map((j: JobDto) => j.title)).toEqual(["Frontend Intern"]);

    const byQ = (await (await session("GET", `/api/jobs?q=graduate&sourceId=${sid}`)).json()) as {
      data: JobDto[];
    };
    expect(byQ.data).toHaveLength(1);

    const byCompany = (await (await session("GET", `/api/jobs?companyId=${cid}`)).json()) as {
      data: JobDto[];
    };
    expect(byCompany.data).toHaveLength(2);
    expect(byCompany.data[0].company.slug).toBeTruthy();

    // Pagination: 2 pages, disjoint, in first_seen_at DESC order.
    const p1 = (await (await session("GET", `/api/jobs?sourceId=${sid}&limit=1`)).json()) as {
      data: JobDto[];
      nextCursor: string | null;
    };
    expect(p1.data).toHaveLength(1);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await (
      await session("GET", `/api/jobs?sourceId=${sid}&limit=1&cursor=${p1.nextCursor}`)
    ).json()) as { data: JobDto[]; nextCursor: string | null };
    expect(p2.data).toHaveLength(1);
    const ids = [...p1.data, ...p2.data].map((j) => j.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("PATCH retire → manual + retired_at; restore → active; 404 unknown id", async () => {
    const { id: cid } = await seedCompany();
    const sid = await seedSource(cid);
    const jid = await seedJob(sid, cid);

    const retired = (await (
      await session("PATCH", `/api/jobs/${jid}`, { status: "retired" })
    ).json()) as { data: JobDto };
    expect(retired.data.status).toBe("retired");
    expect(retired.data.retireReason).toBe("manual");
    expect(retired.data.retiredAt).toBeTruthy();

    const restored = (await (
      await session("PATCH", `/api/jobs/${jid}`, { status: "active" })
    ).json()) as { data: JobDto };
    expect(restored.data.status).toBe("active");
    expect(restored.data.retireReason).toBeNull();
    expect(restored.data.retiredAt).toBeNull();

    const missing = await session("PATCH", "/api/jobs/job_nope", { status: "retired" });
    expect(missing.status).toBe(404);
    const gone = await session("GET", "/api/jobs/job_nope");
    expect(gone.status).toBe(404);
  });
});

describe("companies api", () => {
  it("create derives slug; duplicate slug → 409", async () => {
    const r = await session("POST", "/api/companies", { name: "Dupe Co, Inc." });
    expect(r.status).toBe(201);
    const created = ((await r.json()) as { data: CompanyDto }).data;
    expect(created.slug).toBe("dupe-co-inc");

    const dupe = await session("POST", "/api/companies", {
      name: "Other",
      slug: "dupe-co-inc",
    });
    expect(dupe.status).toBe(409);
    expect(((await dupe.json()) as Envelope).error.code).toBe("conflict");
  });

  it("list + patch", async () => {
    const list = (await (await session("GET", "/api/companies")).json()) as { data: CompanyDto[] };
    expect(list.data.length).toBeGreaterThan(0);

    const r = await session("POST", "/api/companies", { name: "Patch Me" });
    const id = ((await r.json()) as { data: CompanyDto }).data.id;
    const patched = (await (
      await session("PATCH", `/api/companies/${id}`, { homepageUrl: "https://x.dev" })
    ).json()) as { data: CompanyDto & { homepageUrl: string | null } };
    expect(patched.data.homepageUrl).toBe("https://x.dev");
  });
});

describe("sources api", () => {
  it("create validates config via the platform adapter (bad → 400); duplicate → 409", async () => {
    const { id: cid } = await seedCompany({ name: "Src Co" });
    const bad = await session("POST", "/api/sources", {
      companyId: cid,
      platform: "greenhouse",
      board: "badboard",
      config: '{"departmentIds": ["not-a-number"]}',
      includeAll: false,
      enabled: true,
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Envelope).error.code).toBe("validation_failed");

    const ok = await session("POST", "/api/sources", {
      companyId: cid,
      platform: "greenhouse",
      board: "myboard",
      config: "{}",
      includeAll: false,
      enabled: true,
    });
    expect(ok.status).toBe(201);

    const dupe = await session("POST", "/api/sources", {
      companyId: cid,
      platform: "greenhouse",
      board: "myboard",
      config: "{}",
      includeAll: false,
      enabled: true,
    });
    expect(dupe.status).toBe(409);
  });

  it("PATCH enable/disable; list includes the active job count", async () => {
    const { id: cid } = await seedCompany({ name: "Count Co" });
    const created = (await (
      await session("POST", "/api/sources", {
        companyId: cid,
        platform: "lever",
        board: `lever-${crypto.randomUUID().slice(0, 6)}`,
        config: "{}",
        includeAll: true,
        enabled: true,
      })
    ).json()) as { data: SourceDto };
    const sid = created.data.id;
    await seedJob(sid, cid);
    await seedJob(sid, cid, { status: "retired", retiredAt: new Date(), retireReason: "expired" });

    const list = (await (await session("GET", "/api/sources")).json()) as { data: SourceDto[] };
    const row = list.data.find((s: SourceDto) => s.id === sid)!;
    expect(row.activeJobs).toBe(1);
    expect(row.company.id).toBe(cid);

    const off = await session("PATCH", `/api/sources/${sid}`, { enabled: false });
    expect(((await off.json()) as { data: SourceDto }).data.enabled).toBe(false);
    const on = await session("PATCH", `/api/sources/${sid}`, { enabled: true });
    expect(((await on.json()) as { data: SourceDto }).data.enabled).toBe(true);
  });

  it("preview validates config → 400 on bad input", async () => {
    const bad = await session("POST", "/api/sources/preview", {
      platform: "ashby",
      board: "whatever",
      config: '{"unexpected": true}',
      includeAll: false,
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Envelope).error.code).toBe("validation_failed");
  });

  it("preview fetches the upstream feed and returns fetched/kept/sample", async () => {
    // miniflare's outboundService (vite.config.ts → fixture-feed) answers
    // the Greenhouse board API with a 5-job payload.
    const r = await session("POST", "/api/sources/preview", {
      platform: "greenhouse",
      board: "fixture",
      config: "{}",
      includeAll: false,
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      data: {
        fetched: number;
        kept: number;
        sample: {
          title: string;
          level: string | null;
          locationRaw: string;
          countryCode: string | null;
        }[];
      };
    };
    expect(body.data.fetched).toBe(5);
    // Senior + Manager titles are dropped; intern/graduate/junior are kept.
    expect(body.data.kept).toBe(3);
    expect(body.data.sample.map((s: { title: string }) => s.title)).toEqual([
      "Software Engineer Intern",
      "Graduate Data Analyst",
      "Junior Frontend Developer",
    ]);
    expect(body.data.sample[0].countryCode).toBe("US");
  });
});

describe("runs api", () => {
  it("list latest first; detail includes source runs", async () => {
    const { id: cid } = await seedCompany({ name: "Run Co" });
    const sid = await seedSource(cid);
    const t = Date.now() - 120_000;
    const run1 = await seedRun({ startedAt: new Date(t), status: "failed", error: "boom" });
    const run2 = await seedRun({ startedAt: new Date(t + 1000), trigger: "manual" });
    await seedSourceRun(run2, sid, { status: "failed", error: "fetch failed" });

    const list = (await (await session("GET", "/api/runs")).json()) as { data: RunDto[] };
    const idx2 = list.data.findIndex((r: RunDto) => r.id === run2);
    const idx1 = list.data.findIndex((r: RunDto) => r.id === run1);
    expect(idx2).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeLessThan(idx1);

    const detail = (await (await session("GET", `/api/runs/${run2}`)).json()) as { data: RunDto };
    expect(detail.data.sourceRuns).toHaveLength(1);
    expect(detail.data.sourceRuns![0].error).toBe("fetch failed");

    const missing = await session("GET", "/api/runs/run_nope");
    expect(missing.status).toBe(404);
  });

  it("POST /runs → 503 without the workflow binding", async () => {
    expect(env.INGEST_WORKFLOW).toBeUndefined();
    const r = await session("POST", "/api/runs");
    expect(r.status).toBe(503);
    expect(((await r.json()) as Envelope).error.code).toBe("unavailable");
  });
});
