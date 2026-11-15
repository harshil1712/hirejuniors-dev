import { describe, expect, it, beforeAll } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { discoveryCandidate, source } from "@hirejuniors/db/schema";
import { addManualCandidates, crawlHost, discoverStep, normalizeDomain } from "../src/discover";
import { db, migrate, seedCompany, seedSource } from "./helpers";

beforeAll(migrate);

function fetcher(routes: Record<string, Response | "error">): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    for (const [key, res] of Object.entries(routes)) {
      if (url.includes(key)) {
        if (res === "error") throw new Error("network down");
        return res.clone();
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}
const leverOk = () =>
  new Response(JSON.stringify([{ id: "p1" }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const greenhouseOk = () =>
  new Response(
    JSON.stringify({ jobs: [{ id: 1, title: "x", absolute_url: "https://x.test/1" }] }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
const ashbyOk = () =>
  new Response(JSON.stringify({ jobs: [{ id: "j1" }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

async function cand(id: string, input: string, origin: "manual" | "crawl" = "manual", over = {}) {
  await db()
    .insert(discoveryCandidate)
    .values({ id, origin, input, status: "queued", ...over });
}
async function getCand(id: string) {
  return (await db().select().from(discoveryCandidate).where(eq(discoveryCandidate.id, id)))[0];
}

describe("normalizeDomain", () => {
  it("validates hostnames", () => {
    expect(normalizeDomain("Stripe.com")).toBe("stripe.com");
    expect(normalizeDomain("https://figma.com/careers")).toBe("figma.com");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("nodot")).toBeNull();
  });
});

describe("discoverStep", () => {
  it("careers page with greenhouse link → found", async () => {
    await cand("dsc_a1", "acme.com");
    const f = fetcher({
      "acme.com": new Response('<a href="https://boards.greenhouse.io/acmeco">Jobs</a>', {
        headers: { "content-type": "text/html" },
      }),
      "boards-api.greenhouse.io/v1/boards/acmeco": greenhouseOk(),
    });
    const res = await discoverStep(db(), f);
    expect(res.probed).toBeGreaterThanOrEqual(1);
    const c = await getCand("dsc_a1");
    expect(c.status).toBe("found");
    expect(c.platform).toBe("greenhouse");
    expect(c.board).toBe("acmeco");
    expect(c.sourceId).not.toBeNull();
  });

  it("lever + ashby patterns, first-match order", async () => {
    await cand("dsc_b1", "beta.io");
    const f = fetcher({
      "beta.io": new Response('<a href="https://jobs.lever.co/betaco">x</a>', {
        headers: { "content-type": "text/html" },
      }),
      "api.lever.co/v0/postings/betaco": leverOk(),
    });
    await discoverStep(db(), f);
    const c = await getCand("dsc_b1");
    expect(c.platform).toBe("lever");
    expect(c.board).toBe("betaco");
  });

  it("ignore list skipped; next valid match wins", async () => {
    await cand("dsc_c1", "gamma.dev");
    const f = fetcher({
      "gamma.dev": new Response(
        '<a href="https://boards.greenhouse.io/embed">x</a><a href="https://jobs.ashbyhq.com/gammaco">y</a>',
        { headers: { "content-type": "text/html" } },
      ),
      "api.ashbyhq.com/posting-api/job-board/gammaco": ashbyOk(),
    });
    await discoverStep(db(), f);
    const c = await getCand("dsc_c1");
    expect(c.board).toBe("gammaco");
    expect(c.platform).toBe("ashby");
  });

  it("slug-guess fallback order greenhouse→lever→ashby", async () => {
    await cand("dsc_d1", "probeonly.io");
    const f = fetcher({
      "probeonly.io": new Response("<html>no ats links</html>", {
        headers: { "content-type": "text/html" },
      }),
      "api.lever.co/v0/postings/probeonly": leverOk(),
    });
    await discoverStep(db(), f);
    const c = await getCand("dsc_d1");
    expect(c.status).toBe("found");
    expect(c.platform).toBe("lever");
    expect(c.board).toBe("probeonly");
  });

  it("no successful probe → not_found", async () => {
    await cand("dsc_e1", "noluck.io");
    const f = fetcher({
      "noluck.io": new Response("<html>page</html>", {
        headers: { "content-type": "text/html" },
      }),
    });
    await discoverStep(db(), f);
    expect((await getCand("dsc_e1")).status).toBe("not_found");
  });

  it("all network errors → failed with attempts", async () => {
    await cand("dsc_f1", "dead.io");
    const f = fetcher({
      "dead.io": "error",
      "boards-api.greenhouse.io": "error",
      "api.lever.co": "error",
      "api.ashbyhq.com": "error",
    });
    await discoverStep(db(), f);
    const c = await getCand("dsc_f1");
    expect(c.status).toBe("failed");
    expect(c.attempts).toBe(1);
  });

  it("duplicate (platform,board) source → duplicate + source_id", async () => {
    await seedCompany({ id: "cmp_dup01", slug: "dupco", name: "Dup Co" });
    const src = await seedSource({
      id: "src_dup01",
      companyId: "cmp_dup01",
      platform: "lever",
      board: "dupco",
    });
    await cand("dsc_g1", "lever:dupco", "crawl");
    await discoverStep(db(), fetcher({ "api.lever.co/v0/postings/dupco": leverOk() }));
    const c = await getCand("dsc_g1");
    expect(c.status).toBe("duplicate");
    expect(c.sourceId).toBe(src.id);
  });

  it("company slug collision → -2", async () => {
    await seedCompany({ id: "cmp_gh01", slug: "gh-co", name: "GH Co" });
    await cand("dsc_h1", "greenhouse:ghco", "crawl");
    await discoverStep(
      db(),
      fetcher({ "boards-api.greenhouse.io/v1/boards/ghco/jobs": greenhouseOk() }),
    );
    const c = await getCand("dsc_h1");
    expect(c.status).toBe("found");
    const [s] = await db().select().from(source).where(eq(source.id, c.sourceId!));
    expect(s.origin).toBe("discovered");
    expect(s.trial).toBe(true);
  });
});

describe("crawlHost", () => {
  const CDX = "https://index.commoncrawl.org/CC-MAIN-TEST-index";
  it("parses urls → candidates; cursor advances on success", async () => {
    const f = fetcher({
      showNumPages: new Response(JSON.stringify({ pages: 1 }), {
        headers: { "content-type": "application/json" },
      }),
      "index.commoncrawl.org": new Response(
        JSON.stringify([["url"], ["boards.greenhouse.io/newco"], ["boards.greenhouse.io/embed"]]),
        { headers: { "content-type": "application/json" } },
      ),
    });
    const n = await crawlHost(db(), f, "CC-MAIN-TEST", CDX, "boards.greenhouse.io", "greenhouse");
    expect(n).toBe(1);
    const rows = await db()
      .select()
      .from(discoveryCandidate)
      .where(eq(discoveryCandidate.input, "greenhouse:newco"));
    expect(rows).toHaveLength(1);
  });

  it("tolerates the Wayback array-of-arrays body", async () => {
    const f = fetcher({
      showNumPages: new Response(JSON.stringify({ pages: 1 }), {
        headers: { "content-type": "application/json" },
      }),
      "index.commoncrawl.org": new Response(
        JSON.stringify([["url"], ["boards.greenhouse.io/arrayco"]]),
        { headers: { "content-type": "application/json" } },
      ),
    });
    await crawlHost(db(), f, "CC-MAIN-ARR", CDX, "boards.greenhouse.io", "greenhouse");
    const rows = await db()
      .select()
      .from(discoveryCandidate)
      .where(eq(discoveryCandidate.input, "greenhouse:arrayco"));
    expect(rows).toHaveLength(1);
  });

  it("504 → no throw, no candidates, cursor not advanced", async () => {
    const f = fetcher({
      "index.commoncrawl.org": new Response(null, { status: 504 }),
    });
    await expect(
      crawlHost(db(), f, "CC-MAIN-TEST", CDX, "jobs.lever.co", "lever"),
    ).resolves.not.toThrow();
    const rows = await db()
      .select()
      .from(discoveryCandidate)
      .where(eq(discoveryCandidate.input, "lever:anything"));
    expect(rows).toHaveLength(0);
  });
});

describe("manual flow — URL order and outcomes", () => {
  it("link found only on /careers", async () => {
    await cand("dsc_m1", "careersonly.dev");
    const f = fetcher({
      "careersonly.dev/careers": new Response(
        '<a href="https://jobs.ashbyhq.com/careersco">jobs</a>',
        { headers: { "content-type": "text/html" } },
      ),
      "api.ashbyhq.com/posting-api/job-board/careersco": ashbyOk(),
    });
    await discoverStep(db(), f);
    const c = await getCand("dsc_m1");
    expect(c.status).toBe("found");
    expect(c.platform).toBe("ashby");
  });

  it("link found only on careers.{d}", async () => {
    await cand("dsc_m2", "subco.dev");
    const f = fetcher({
      "careers.subco.dev": new Response('<a href="https://boards.greenhouse.io/subco">jobs</a>', {
        headers: { "content-type": "text/html" },
      }),
      "boards-api.greenhouse.io/v1/boards/subco": greenhouseOk(),
    });
    await discoverStep(db(), f);
    const c = await getCand("dsc_m2");
    expect(c.status).toBe("found");
    expect(c.board).toBe("subco");
  });

  it("every page fetch fails but slug guess finds a board → found", async () => {
    await cand("dsc_m3", "guessco.dev");
    const f = fetcher({
      "guessco.dev": "error", // covers /careers, /jobs, apex
      "boards-api.greenhouse.io/v1/boards/guessco": greenhouseOk(),
    });
    await discoverStep(db(), f);
    const c = await getCand("dsc_m3");
    expect(c.status).toBe("found");
    expect(c.board).toBe("guessco");
  });

  it("every fetch AND every probe throws → failed, attempts incremented", async () => {
    await cand("dsc_m4", "alldown.dev");
    const f = fetcher({
      "alldown.dev": "error",
      "boards-api.greenhouse.io": "error",
      "api.lever.co": "error",
      "api.ashbyhq.com": "error",
    });
    await discoverStep(db(), f);
    const c = await getCand("dsc_m4");
    expect(c.status).toBe("failed");
    expect(c.attempts).toBe(1);
  });

  it("probes return 404 → not_found, not failed", async () => {
    await cand("dsc_m5", "realdead.dev");
    const f = fetcher({}); // every route → 404 real answer
    await discoverStep(db(), f);
    expect((await getCand("dsc_m5")).status).toBe("not_found");
  });

  it("manual candidates probe before older crawl ones (limit 1)", async () => {
    await cand("dsc_old_crawl", "lever:older", "crawl");
    // manual created after the crawl candidate
    await new Promise((r) => setTimeout(r, 5));
    await cand("dsc_new_manual", "first.dev", "manual");
    const f = fetcher({
      "api.lever.co/v0/postings/older": leverOk(),
      "first.dev": "error",
      "boards-api.greenhouse.io": "error",
      "api.lever.co/v0/postings/first": leverOk(),
      "api.ashbyhq.com": "error",
    });
    await discoverStep(db(), f, 1);
    const manual = await getCand("dsc_new_manual");
    expect(manual.attempts).toBe(1); // probed first despite being newer
  });
});
