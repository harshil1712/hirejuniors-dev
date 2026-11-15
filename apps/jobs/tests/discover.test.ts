import { describe, expect, it, beforeAll } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { discoveryCandidate, source } from "@hirejuniors/db/schema";
import { discoverStep, listingsCandidates, normalizeInput } from "../src/discover";
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
const jsonRes = (body: string) =>
  new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const greenhouseJobs = (n: number) =>
  jsonRes(
    JSON.stringify({
      jobs: Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        title: "x",
        absolute_url: `https://x.test/${i}`,
      })),
    }),
  );
const ashbyJobs = (n: number) =>
  jsonRes(JSON.stringify({ jobs: Array.from({ length: n }, (_, i) => ({ id: `j${i}` })) }));
const page = () => new Response("<html>no boards here</html>", { status: 200 });

async function cand(
  id: string,
  input: string,
  origin: "manual" | "listings" = "manual",
  over = {},
) {
  await db()
    .insert(discoveryCandidate)
    .values({ id, origin, input, status: "queued", ...over });
}
async function getCand(id: string) {
  return (await db().select().from(discoveryCandidate).where(eq(discoveryCandidate.id, id)))[0];
}

describe("normalizeInput", () => {
  it("domains → bare lower-case host; ATS URLs → platform:board", () => {
    expect(normalizeInput("Stripe.com")).toBe("stripe.com");
    expect(normalizeInput("figma.com/careers")).toBe("figma.com");
    expect(normalizeInput("https://boards.greenhouse.io/acme")).toBe("greenhouse:acme");
    expect(normalizeInput("https://jobs.lever.co/beta/jobs/123")).toBe("lever:beta");
    expect(normalizeInput("https://jobs.ashbyhq.com/gamma")).toBe("ashby:gamma");
    // Board slugs are case-sensitive.
    expect(normalizeInput("https://jobs.ashbyhq.com/Notion/abc")).toBe("ashby:Notion");
    expect(normalizeInput("https://example.com/about")).toBeNull();
    expect(normalizeInput("not a domain")).toBeNull();
    expect(normalizeInput("nodot")).toBeNull();
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
    const res = await discoverStep(db(), { fetcher: f });
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
    await discoverStep(db(), { fetcher: f });
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
    await discoverStep(db(), { fetcher: f });
    const c = await getCand("dsc_c1");
    expect(c.board).toBe("gammaco");
    expect(c.platform).toBe("ashby");
  });

  it("no successful probe → not_found", async () => {
    await cand("dsc_e1", "noluck.io");
    const f = fetcher({
      "noluck.io": new Response("<html>page</html>", {
        headers: { "content-type": "text/html" },
      }),
    });
    await discoverStep(db(), { fetcher: f });
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
    await discoverStep(db(), { fetcher: f });
    const c = await getCand("dsc_f1");
    expect(c.status).toBe("failed");
    expect(c.attempts).toBe(1);
  });

  it("domain guess: datadoghq.com → datadoghq + datadog; GH datadog named 'Datadog' 5 jobs → found", async () => {
    await cand("dsc_gu1", "datadoghq.com");
    const f = fetcher({
      "datadoghq.com": page(),
      // boards-api probes for the wrong guess 404 by default; datadog answers
      "boards-api.greenhouse.io/v1/boards/datadog/jobs": greenhouseJobs(5),
      "boards-api.greenhouse.io/v1/boards/datadog": jsonRes(JSON.stringify({ name: "Datadog" })),
    });
    await discoverStep(db(), { fetcher: f });
    const c = await getCand("dsc_gu1");
    expect(c.status).toBe("found");
    expect(c.platform).toBe("greenhouse");
    expect(c.board).toBe("datadog");
  });

  it("domain guess: GH name mismatch ('Wise Worksite Field Sales') → not_found", async () => {
    await cand("dsc_gu2", "wise.com");
    const f = fetcher({
      "wise.com": page(),
      "boards-api.greenhouse.io/v1/boards/wise/jobs": greenhouseJobs(3),
      "boards-api.greenhouse.io/v1/boards/wise": jsonRes(
        JSON.stringify({ name: "Wise Worksite Field Sales" }),
      ),
    });
    await discoverStep(db(), { fetcher: f });
    expect((await getCand("dsc_gu2")).status).toBe("not_found");
  });

  it("domain guess: most jobs wins — GH ramp 1 job vs Ashby ramp 180 → ashby", async () => {
    await cand("dsc_gu3", "ramp.com");
    const f = fetcher({
      "ramp.com": page(),
      "boards-api.greenhouse.io/v1/boards/ramp/jobs": greenhouseJobs(1),
      "boards-api.greenhouse.io/v1/boards/ramp": jsonRes(JSON.stringify({ name: "RAMP" })),
      "api.ashbyhq.com/posting-api/job-board/ramp": ashbyJobs(180),
    });
    await discoverStep(db(), { fetcher: f });
    const c = await getCand("dsc_gu3");
    expect(c.status).toBe("found");
    expect(c.platform).toBe("ashby");
    expect(c.board).toBe("ramp");
  });

  it("domain guess: GH board name 'Canonical - Jobs' normalises to the guess", async () => {
    await cand("dsc_gu4", "canonical.com");
    const f = fetcher({
      "canonical.com": page(),
      "boards-api.greenhouse.io/v1/boards/canonical/jobs": greenhouseJobs(7),
      "boards-api.greenhouse.io/v1/boards/canonical": jsonRes(
        JSON.stringify({ name: "Canonical - Jobs" }),
      ),
    });
    await discoverStep(db(), { fetcher: f });
    const c = await getCand("dsc_gu4");
    expect(c.status).toBe("found");
    expect(c.platform).toBe("greenhouse");
    expect(c.board).toBe("canonical");
  });

  it("duplicate (platform,board) source → duplicate + source_id", async () => {
    await seedCompany({ id: "cmp_dup01", slug: "dupco", name: "Dup Co" });
    const src = await seedSource({
      id: "src_dup01",
      companyId: "cmp_dup01",
      platform: "lever",
      board: "dupco",
    });
    await cand("dsc_g1", "lever:dupco", "listings");
    await discoverStep(db(), { fetcher: fetcher({ "api.lever.co/v0/postings/dupco": leverOk() }) });
    const c = await getCand("dsc_g1");
    expect(c.status).toBe("duplicate");
    expect(c.sourceId).toBe(src.id);
  });

  it("company slug collision → -2", async () => {
    await seedCompany({ id: "cmp_gh01", slug: "gh-co", name: "GH Co" });
    await cand("dsc_h1", "greenhouse:ghco", "listings");
    await discoverStep(db(), {
      fetcher: fetcher({ "boards-api.greenhouse.io/v1/boards/ghco/jobs": greenhouseOk() }),
    });
    const c = await getCand("dsc_h1");
    expect(c.status).toBe("found");
    const [s] = await db().select().from(source).where(eq(source.id, c.sourceId!));
    expect(s.origin).toBe("discovered");
    expect(s.trial).toBe(true);
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
    await discoverStep(db(), { fetcher: f });
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
    await discoverStep(db(), { fetcher: f });
    const c = await getCand("dsc_m2");
    expect(c.status).toBe("found");
    expect(c.board).toBe("subco");
  });

  it("every fetch AND every probe throws → failed, attempts incremented", async () => {
    await cand("dsc_m4", "alldown.dev");
    const f = fetcher({
      "alldown.dev": "error",
      "boards-api.greenhouse.io": "error",
      "api.lever.co": "error",
      "api.ashbyhq.com": "error",
    });
    await discoverStep(db(), { fetcher: f });
    const c = await getCand("dsc_m4");
    expect(c.status).toBe("failed");
    expect(c.attempts).toBe(1);
  });

  it("probes return 404 → not_found, not failed", async () => {
    await cand("dsc_m5", "realdead.dev");
    const f = fetcher({}); // every route → 404 real answer
    await discoverStep(db(), { fetcher: f });
    expect((await getCand("dsc_m5")).status).toBe("not_found");
  });

  it("manual candidates probe before older listings ones (limit 1)", async () => {
    // Clear leftovers queued/failed by earlier tests in the shared DB.
    await db().update(discoveryCandidate).set({ status: "found" });
    await cand("dsc_old_listing", "lever:older", "listings");
    // manual created after the listings candidate
    await new Promise((r) => setTimeout(r, 5));
    await cand("dsc_new_manual", "first.dev", "manual");
    const f = fetcher({
      "api.lever.co/v0/postings/older": leverOk(),
      "first.dev": "error",
      "boards-api.greenhouse.io": "error",
      "api.lever.co/v0/postings/first": leverOk(),
      "api.ashbyhq.com": "error",
    });
    await discoverStep(db(), { fetcher: f }, 1);
    const manual = await getCand("dsc_new_manual");
    expect(manual.attempts).toBe(1); // probed first despite being newer
  });
});

describe("listingsCandidates", () => {
  const feed = (rows: unknown[]) =>
    new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const FEED_A = "https://raw.test/feed-a.json";
  const FEED_B = "https://raw.test/feed-b.json";

  async function crawlInputs() {
    const rows = await db()
      .select({ input: discoveryCandidate.input, origin: discoveryCandidate.origin })
      .from(discoveryCandidate)
      .where(eq(discoveryCandidate.origin, "listings"));
    return rows;
  }

  it("parses ATS urls across two feeds; skips workday, inactive, malformed, dupes", async () => {
    const f = fetcher({
      "feed-a": feed([
        { url: "https://boards.greenhouse.io/stripe", active: true },
        { url: "https://job-boards.greenhouse.io/datadog", active: true },
        { url: "https://jobs.lever.co/ramp" },
        { url: "https://boards.greenhouse.io/stripe", active: true }, // dup
        { url: "https://acme.myworkdayjobs.com/careers", active: true }, // ignored
        { url: "https://jobs.lever.co/inactiveco", active: false },
        { url: 42 }, // malformed
        "not an object",
      ]),
      "feed-b": feed([
        { url: "https://jobs.ashbyhq.com/notion", active: true },
        { url: "https://jobs.lever.co/ramp" }, // dup across feeds
      ]),
    });
    const n = await listingsCandidates(db(), f, [FEED_A, FEED_B]);
    expect(n).toBe(4);
    const inputs = (await crawlInputs()).map((r) => r.input);
    expect(inputs).toEqual(
      expect.arrayContaining([
        "ashby:notion",
        "greenhouse:datadog",
        "greenhouse:stripe",
        "lever:ramp",
      ]),
    );
    // workday / inactive rows produced no candidates
    expect(inputs.filter((i) => i.includes("acme") || i.includes("inactiveco"))).toEqual([]);
  });

  it("one feed 500s and one returns invalid JSON → other's candidates still insert", async () => {
    const f = fetcher({
      "feed-a": new Response(null, { status: 500 }),
      "feed-b": feed([{ url: "https://jobs.lever.co/okco", active: true }]),
    });
    const n = await listingsCandidates(db(), f, [FEED_A, FEED_B]);
    expect(n).toBe(1);
    const f2 = fetcher({
      "feed-a": new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      "feed-b": feed([{ url: "https://jobs.ashbyhq.com/okco2", active: true }]),
    });
    const n2 = await listingsCandidates(db(), f2, [FEED_A, FEED_B]);
    expect(n2).toBe(1);
    const inputs = (await crawlInputs()).map((r) => r.input).sort();
    expect(inputs).toContain("lever:okco");
    expect(inputs).toContain("ashby:okco2");
  });

  it("a feed with 250 boards inserts 250 candidates (D1 param-limit guard)", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({
      url: `https://boards.greenhouse.io/bulk${i}`,
      active: true,
    }));
    const f = fetcher({ "feed-a": feed(rows) });
    const n = await listingsCandidates(db(), f, [FEED_A]);
    expect(n).toBe(250);
    const inputs = (await crawlInputs()).map((r) => r.input);
    for (let i = 0; i < 250; i++) expect(inputs).toContain(`greenhouse:bulk${i}`);
  });

  it("calling twice doesn't duplicate rows", async () => {
    const f = fetcher({
      "feed-a": feed([{ url: "https://boards.greenhouse.io/dupe", active: true }]),
    });
    await listingsCandidates(db(), f, [FEED_A]);
    await listingsCandidates(db(), f, [FEED_A]);
    const rows = (await crawlInputs()).filter((r) => r.input === "greenhouse:dupe");
    expect(rows).toHaveLength(1);
  });
});
