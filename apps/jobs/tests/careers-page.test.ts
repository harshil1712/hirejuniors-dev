import { describe, expect, it, beforeAll } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { job } from "@hirejuniors/db/schema";
import { ingestSource, startRun } from "../src/ingest";
import { extractMarkdownLinks, parseJobLinks } from "../src/platforms";
import type { AdapterCtx } from "../src/platforms";
import type { AiModels } from "../src/ai";
import type { Browser } from "../src/browser";
import { db, migrate, seedCompany, seedSource } from "./helpers";

beforeAll(migrate);

const LISTING = "https://acme.com/careers";

interface PageMap {
  [url: string]: string;
}

function fakeBrowser(pages: PageMap, calls?: string[]): Browser {
  return {
    msUsed: 0,
    links: () => Promise.reject(new Error("links not expected")),
    markdown: (url: string) => {
      calls?.push(url);
      if (!(url in pages)) return Promise.reject(new Error(`no page ${url}`));
      return Promise.resolve(pages[url]);
    },
  };
}

/** Fake clef: marks every link a job link at `noul(id)` (default 1.0). */
function fakeDecide(noul: (qid: string) => number = () => 1): AiModels {
  return {
    decide: (_m, _s, questions) => {
      const answers: Record<string, { type: "noul"; noul: number }> = {};
      for (const id of Object.keys(questions)) {
        answers[id] = { type: "noul", noul: noul(id) };
      }
      return Promise.resolve({ answers, inputTokens: 1 });
    },
    extract: () => Promise.reject(new Error("extract not expected")),
  };
}

function ctx(browser: Browser, ai: AiModels, knownExternalIds?: Set<string>): AdapterCtx {
  return { fetcher: fetch, browser, ai, knownExternalIds };
}

describe("extractMarkdownLinks", () => {
  const md = [
    "[Junior Dev](/jobs/123)",
    "[Intern](https://acme.com/jobs/456)",
    "[Mail](mailto:hr@acme.com)",
    "[Call](tel:+15551234)",
    "[Anchor](#team)",
    "[ ](https://acme.com/x)",
    "[Offsite](https://other.com/jobs/1)",
    "[WD](https://acme.myworkdayjobs.com/en-US/job/1)",
    "[Junior Dev again](/jobs/123)",
  ].join("\n");

  it("resolves relative URLs and drops mailto/tel/#/empty text", () => {
    const links = extractMarkdownLinks(md, LISTING);
    const urls = links.map((l) => l.url);
    expect(urls).toContain("https://acme.com/jobs/123");
    expect(urls).toContain("https://acme.com/jobs/456");
    expect(urls).not.toContain("mailto:hr@acme.com");
    expect(urls.some((u) => u.startsWith("tel:"))).toBe(false);
    expect(urls.some((u) => u.includes("#team"))).toBe(false);
    expect(links.find((l) => l.text === " ")).toBeUndefined();
  });

  it("drops off-domain links but keeps myworkdayjobs", () => {
    const links = extractMarkdownLinks(md, LISTING);
    const urls = links.map((l) => l.url);
    expect(urls).not.toContain("https://other.com/jobs/1");
    expect(urls.some((u) => u.includes("myworkdayjobs.com"))).toBe(true);
  });

  it("dedupes by normalised URL", () => {
    const links = extractMarkdownLinks(md, LISTING);
    expect(links.filter((l) => l.url === "https://acme.com/jobs/123")).toHaveLength(1);
  });

  it("caps at 200 links", () => {
    const many = Array.from({ length: 250 }, (_, i) => `[J${i}](https://acme.com/j/${i})`).join(
      "\n",
    );
    expect(extractMarkdownLinks(many, LISTING)).toHaveLength(200);
  });
});

describe("parseJobLinks", () => {
  it("batches: 61 links → 2 clef calls", async () => {
    const md = Array.from({ length: 61 }, (_, i) => `[J${i}](https://acme.com/j/${i})`).join("\n");
    let calls = 0;
    const ai: AiModels = {
      decide: (_m, _s, q) => {
        calls++;
        const answers: Record<string, { type: "noul"; noul: number }> = {};
        for (const id of Object.keys(q)) answers[id] = { type: "noul" as const, noul: 1 };
        return Promise.resolve({ answers, inputTokens: 1 });
      },
      extract: () => Promise.reject(new Error("no")),
    };
    const links = await parseJobLinks(ctx(fakeBrowser({ [LISTING]: md }), ai), LISTING);
    expect(calls).toBe(2);
    expect(links).toHaveLength(61);
  });

  it("0.70 threshold: 0.69 dropped, 0.70 kept", async () => {
    const md = "[A](https://acme.com/j/a)\n[B](https://acme.com/j/b)";
    const ai = fakeDecide((id) => (id === "l0" ? 0.69 : 0.7));
    const links = await parseJobLinks(ctx(fakeBrowser({ [LISTING]: md }), ai), LISTING);
    expect(links.map((l) => l.url)).toEqual(["https://acme.com/j/b"]);
  });
});

describe("careers_page ingest", () => {
  const page = "Role text\n\n- item one\n- item two";
  const clairic: AiModels = {
    decide: (_m, _s, q) =>
      Promise.resolve({
        answers: Object.fromEntries(
          Object.keys(q).map((id) => [id, { type: "noul" as const, noul: 1 }]),
        ),
        inputTokens: 1,
      }),
    extract: (_s, _f, _d) =>
      Promise.resolve({
        answers: {
          location: { value: "Austin, TX", confidence: 0.9 },
          posted_date: { value: "2026-01-15", confidence: 0.85 },
        },
        inputTokens: 1,
      }),
  };

  async function seed(id: string, board = LISTING) {
    await seedCompany({ id: `cmp_${id}`, slug: id, name: id });
    return seedSource({
      id: `src_${id}`,
      companyId: `cmp_${id}`,
      platform: "careers_page",
      board,
      config: JSON.stringify({ listingUrl: board }),
    });
  }

  it("new links fetch pages + Clairic (0.80 gate); markdownToHtml output", async () => {
    const src = await seed("cp_a");
    const calls: string[] = [];
    const browser = fakeBrowser(
      { [LISTING]: "[Junior Dev](https://acme.com/j/1)", "https://acme.com/j/1": page },
      calls,
    );
    const runId = await startRun(db(), "manual", "inst-cp-a");
    const counts = await ingestSource(db(), runId, src.id, ctx(browser, clairic));
    expect(counts.inserted).toBe(1);
    const [j] = await db().select().from(job).where(eq(job.sourceId, src.id));
    expect(j.title).toBe("Junior Dev");
    expect(j.locationRaw).toBe("Austin, TX");
    expect(j.descriptionHtml).toContain("<ul>");
    expect(j.descriptionHtml).toContain("<p>Role text</p>");
    expect(calls).toContain("https://acme.com/j/1");
  });

  it("low-confidence Clairic → empty location", async () => {
    const src = await seed("cp_b", "https://acme.com/team");
    const lowAi: AiModels = {
      ...clairic,
      extract: () =>
        Promise.resolve({
          answers: {
            location: { value: "Nowhere", confidence: 0.5 },
            posted_date: { value: null, confidence: 0.1 },
          },
          inputTokens: 1,
        }),
    };
    const runId = await startRun(db(), "manual", "inst-cp-b");
    await ingestSource(
      db(),
      runId,
      src.id,
      ctx(
        fakeBrowser({
          "https://acme.com/team": "[X](https://acme.com/j/9)",
          "https://acme.com/j/9": "x",
        }),
        lowAi,
      ),
    );
    const [j] = await db().select().from(job).where(eq(job.sourceId, src.id));
    expect(j.locationRaw).toBe("");
    expect(j.postedAt).toBeNull();
  });

  it("existing links re-seen without a page fetch; missing link retires", async () => {
    const src = await seed("cp_c", "https://acme.com/work");
    const calls: string[] = [];
    const listing1 = "[A](https://acme.com/j/a)\n[B](https://acme.com/j/b)";
    const runId = await startRun(db(), "manual", "inst-cp-c1");
    await ingestSource(
      db(),
      runId,
      src.id,
      ctx(
        fakeBrowser(
          {
            "https://acme.com/work": listing1,
            "https://acme.com/j/a": "a",
            "https://acme.com/j/b": "b",
          },
          calls,
        ),
        clairic,
      ),
    );
    const [ja] = await db().select().from(job).where(eq(job.externalId, "https://acme.com/j/a"));
    await db().update(job).set({ status: "active", level: "junior" }).where(eq(job.id, ja.id));
    calls.length = 0;
    // Second run: only A still listed; B missing → retires; A not re-fetched
    // (j/a is absent from pages so a fetch would reject).
    const runId2 = await startRun(db(), "manual", "inst-cp-c2");
    await ingestSource(
      db(),
      runId2,
      src.id,
      ctx(fakeBrowser({ "https://acme.com/work": "[A](https://acme.com/j/a)" }, calls), clairic),
    );
    expect(calls).not.toContain("https://acme.com/j/a");
    const [jb] = await db().select().from(job).where(eq(job.externalId, "https://acme.com/j/b"));
    expect(jb.status).toBe("retired");
  });

  it("30-new cap: overflow links deferred (not upserted, not retired)", async () => {
    const src = await seed("cp_d", "https://acme.com/jobs");
    const LIST2 = "https://acme.com/jobs";
    const listing1 =
      "[Old](https://acme.com/j/old)\n" +
      Array.from({ length: 35 }, (_, i) => `[N${i}](https://acme.com/j/n${i})`).join("\n");
    const pages: PageMap = { [LIST2]: listing1 };
    for (let i = 0; i < 35; i++) pages[`https://acme.com/j/n${i}`] = "x";
    pages["https://acme.com/j/old"] = "old";
    const calls: string[] = [];
    const runId = await startRun(db(), "manual", "inst-cp-d1");
    const counts = await ingestSource(db(), runId, src.id, ctx(fakeBrowser(pages, calls), clairic));
    // 36 job links, all new — cap fetches only 30 pages this run.
    expect(counts.inserted).toBe(30);
    const fetchedPages = calls.filter((u) => u !== LIST2);
    expect(fetchedPages).toHaveLength(30);
    // Second run with the same listing: the deferred 6 are new-fetched, and
    // no stored job is retired just because the cap was hit last run.
    const pages2: PageMap = { [LIST2]: listing1 };
    for (let i = 0; i < 35; i++) pages2[`https://acme.com/j/n${i}`] = "x";
    const runId2 = await startRun(db(), "manual", "inst-cp-d2");
    const c2 = await ingestSource(db(), runId2, src.id, ctx(fakeBrowser(pages2), clairic));
    const rows = await db().select().from(job).where(eq(job.sourceId, src.id));
    expect(rows.filter((r) => r.status !== "retired")).toHaveLength(36);
    expect(c2.inserted).toBe(6);
  });

  it("retired non-manual job reactivates when its link reappears; manual stays retired", async () => {
    const src = await seed("cp_e", "https://acme.com/hiring");
    const listing1 =
      "[A](https://acme.com/j/ea)\n[B](https://acme.com/j/eb)\n[C](https://acme.com/j/ec)";
    const runId = await startRun(db(), "manual", "inst-cp-e1");
    await ingestSource(
      db(),
      runId,
      src.id,
      ctx(
        fakeBrowser({
          "https://acme.com/hiring": listing1,
          "https://acme.com/j/ea": "a",
          "https://acme.com/j/eb": "b",
          "https://acme.com/j/ec": "c",
        }),
        clairic,
      ),
    );
    await db()
      .update(job)
      .set({ status: "retired", retireReason: "missing_from_feed" })
      .where(eq(job.externalId, "https://acme.com/j/eb"));
    await db()
      .update(job)
      .set({ status: "retired", retireReason: "manual" })
      .where(eq(job.externalId, "https://acme.com/j/ec"));
    const calls: string[] = [];
    const runId2 = await startRun(db(), "manual", "inst-cp-e2");
    await ingestSource(
      db(),
      runId2,
      src.id,
      ctx(
        fakeBrowser(
          { "https://acme.com/hiring": listing1, "https://acme.com/j/eb": "b again" },
          calls,
        ),
        clairic,
      ),
    );
    // B was fetched and reactivated; C (manual) was re-seen only.
    expect(calls).toContain("https://acme.com/j/eb");
    expect(calls).not.toContain("https://acme.com/j/ec");
    const [jb] = await db().select().from(job).where(eq(job.externalId, "https://acme.com/j/eb"));
    expect(jb.status).not.toBe("retired");
    const [jc] = await db().select().from(job).where(eq(job.externalId, "https://acme.com/j/ec"));
    expect(jc.status).toBe("retired");
  });
});
