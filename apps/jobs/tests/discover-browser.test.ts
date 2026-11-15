// Discovery + Browser Run (spec §Discovery steps 1 & 5).
import { describe, expect, it, beforeAll } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { discoveryCandidate, source } from "@hirejuniors/db/schema";
import { addManualCandidates, discoverStep } from "../src/discover";
import type { AiModels } from "../src/ai";
import type { Browser } from "../src/browser";
import { db, migrate } from "./helpers";

beforeAll(migrate);

interface PageMap {
  [url: string]: string;
}

function browser(over: Partial<Browser>): Browser {
  return {
    msUsed: 0,
    links: () => Promise.reject(new Error("no links")),
    markdown: () => Promise.reject(new Error("no markdown")),
    ...over,
  };
}

const aiNoul = (noul = 1): AiModels => ({
  decide: (_m, _s, q) =>
    Promise.resolve({
      answers: Object.fromEntries(
        Object.keys(q).map((id) => [id, { type: "noul" as const, noul }]),
      ),
      inputTokens: 1,
    }),
  extract: () => Promise.reject(new Error("no")),
});

async function seed(domain: string) {
  await addManualCandidates(db(), [domain]);
  return (
    await db().select().from(discoveryCandidate).where(eq(discoveryCandidate.input, domain))
  )[0];
}

describe("discoverStep — Browser Run step 1", () => {
  it("ATS link found via browser links when absent from raw HTML", async () => {
    await seed("brgreen.com");
    const b = browser({
      links: (url) =>
        url === "https://brgreen.com/careers"
          ? Promise.resolve(["https://boards.greenhouse.io/brgreen", "https://x.test/x"])
          : Promise.resolve([]),
    });
    const fetcher = (async (input: RequestInfo | URL) => {
      const u = String(input instanceof Request ? input.url : input);
      if (u.includes("boards.greenhouse.io/brgreen/jobs") || u.includes("/v1/boards/brgreen/jobs"))
        return new Response(JSON.stringify({ jobs: [{ id: 1, title: "t", absolute_url: "u" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return new Response("<html>no board here</html>", { status: 200 });
    }) as typeof fetch;
    const res = await discoverStep(db(), { fetcher, browser: b, ai: aiNoul() });
    expect(res.found).toBe(1);
    const [s] = await db().select().from(source).where(eq(source.board, "brgreen"));
    expect(s.platform).toBe("greenhouse");
  });

  it("browser error falls back to fetch", async () => {
    await seed("fallbackco.com");
    const b = browser({ links: () => Promise.reject(new Error("browser down")) });
    const fetcher = (async (input: RequestInfo | URL) => {
      const u = String(input instanceof Request ? input.url : input);
      if (u === "https://fallbackco.com/careers")
        return new Response('<a href="https://jobs.lever.co/fallbackco">jobs</a>', {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      if (u.includes("api.lever.co/v0/postings/fallbackco"))
        return new Response(JSON.stringify([{ id: "p1" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return new Response("nf", { status: 404 });
    }) as typeof fetch;
    const res = await discoverStep(db(), { fetcher, browser: b, ai: aiNoul() });
    expect(res.found).toBe(1);
    const [s] = await db().select().from(source).where(eq(source.board, "fallbackco"));
    expect(s.platform).toBe("lever");
  });
});

describe("discoverStep — careers-page fallback (step 5)", () => {
  it("listing with job links → careers_page source", async () => {
    await seed("plainco.com");
    const pages: PageMap = {
      "https://plainco.com/careers":
        "[Junior Dev](https://plainco.com/j/1)\n[About](https://plainco.com/about)",
    };
    const b = browser({
      links: () => Promise.resolve(["https://plainco.com/about"]),
      markdown: (u) => Promise.resolve(pages[u] ?? ""),
    });
    // No ATS links; slug probes all 404 via fetch.
    const fetcher = (async () => new Response("nf", { status: 404 })) as typeof fetch;
    const res = await discoverStep(db(), { fetcher, browser: b, ai: aiNoul(0.9) });
    expect(res.found).toBe(1);
    const [s] = await db().select().from(source).where(eq(source.platform, "careers_page"));
    expect(s.board).toBe("https://plainco.com/careers");
    expect(JSON.parse(s.config).listingUrl).toBe("https://plainco.com/careers");
  });

  it("0 job links → one-hop choice link_3 p=0.75 → selected page used", async () => {
    await seed("hopco.com");
    const listing =
      "[a](https://hopco.com/x0)\n[b](https://hopco.com/x1)\n[c](https://hopco.com/x2)\n[Jobs](https://hopco.com/openings)";
    const pages: PageMap = {
      "https://hopco.com/careers": listing,
      "https://hopco.com/openings": "[Dev](https://hopco.com/j/1)",
    };
    const b = browser({
      links: () => Promise.resolve(["https://hopco.com/x0"]),
      markdown: (u) => Promise.resolve(pages[u] ?? ""),
    });
    let choiceCalls = 0;
    const ai: AiModels = {
      decide: (_m, _s, q) => {
        if (q.open_positions) {
          choiceCalls++;
          return Promise.resolve({
            answers: {
              open_positions: {
                type: "choice" as const,
                choice: "link_3",
                probabilities: { link_3: 0.75 },
              },
            },
            inputTokens: 1,
          });
        }
        // noul: only the /j/1 link is a job posting on the second parse;
        // on the first parse nothing is a job link.
        const answers: Record<string, { type: "noul"; noul: number }> = {};
        for (const id of Object.keys(q)) {
          answers[id] = { type: "noul" as const, noul: 0 };
        }
        return Promise.resolve({ answers, inputTokens: 1 });
      },
      extract: () => Promise.reject(new Error("no")),
    };
    // First parse (all links non-job) → one-hop → second parse marks l0 a job.
    let noulCalls = 0;
    const ai2: AiModels = {
      ...ai,
      decide: (m, s, q) => {
        if (q.open_positions) return ai.decide(m, s, q);
        noulCalls++;
        const answers: Record<string, { type: "noul"; noul: number }> = {};
        for (const id of Object.keys(q))
          answers[id] = { type: "noul", noul: noulCalls > 1 ? 1 : 0 };
        return Promise.resolve({ answers, inputTokens: 1 });
      },
    };
    const fetcher = (async () => new Response("nf", { status: 404 })) as typeof fetch;
    const res = await discoverStep(db(), { fetcher, browser: b, ai: ai2 });
    expect(res.found).toBe(1);
    expect(choiceCalls).toBe(1);
    const [s] = await db().select().from(source).where(eq(source.platform, "careers_page"));
    expect(JSON.parse(s.config).listingUrl).toBe("https://hopco.com/openings");
  });

  it("one-hop p=0.5 → not_found", async () => {
    await seed("lowpco.com");
    const b = browser({
      links: () => Promise.resolve(["https://lowpco.com/x"]),
      markdown: () => Promise.resolve("[a](https://lowpco.com/x)\n[b](https://lowpco.com/y)"),
    });
    const ai: AiModels = {
      decide: (_m, _s, q) => {
        if (q.open_positions)
          return Promise.resolve({
            answers: {
              open_positions: {
                type: "choice" as const,
                choice: "link_0",
                probabilities: { link_0: 0.5 },
              },
            },
            inputTokens: 1,
          });
        return Promise.resolve({
          answers: Object.fromEntries(
            Object.keys(q).map((id) => [id, { type: "noul" as const, noul: 0 }]),
          ),
          inputTokens: 1,
        });
      },
      extract: () => Promise.reject(new Error("no")),
    };
    const fetcher = (async () => new Response("nf", { status: 404 })) as typeof fetch;
    await discoverStep(db(), { fetcher, browser: b, ai });
    const c = (
      await db().select().from(discoveryCandidate).where(eq(discoveryCandidate.input, "lowpco.com"))
    )[0];
    expect(c.status).toBe("not_found");
  });

  it("one-hop 'none' → not_found", async () => {
    await seed("noneco.com");
    const b = browser({
      links: () => Promise.resolve(["https://noneco.com/x"]),
      markdown: () => Promise.resolve("[a](https://noneco.com/x)"),
    });
    const ai: AiModels = {
      decide: (_m, _s, q) => {
        if (q.open_positions)
          return Promise.resolve({
            answers: {
              open_positions: {
                type: "choice" as const,
                choice: "none",
                probabilities: { none: 0.9 },
              },
            },
            inputTokens: 1,
          });
        return Promise.resolve({
          answers: Object.fromEntries(
            Object.keys(q).map((id) => [id, { type: "noul" as const, noul: 0 }]),
          ),
          inputTokens: 1,
        });
      },
      extract: () => Promise.reject(new Error("no")),
    };
    const fetcher = (async () => new Response("nf", { status: 404 })) as typeof fetch;
    await discoverStep(db(), { fetcher, browser: b, ai });
    const c = (
      await db().select().from(discoveryCandidate).where(eq(discoveryCandidate.input, "noneco.com"))
    )[0];
    expect(c.status).toBe("not_found");
  });
});
