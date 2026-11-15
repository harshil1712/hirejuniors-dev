// Discovery + Browser Run (spec §Discovery — domain link scan).
import { describe, expect, it, beforeAll } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { discoveryCandidate, source } from "@hirejuniors/db/schema";
import { addManualCandidates, discoverStep } from "../src/discover";
import type { Browser } from "../src/browser";
import { db, migrate } from "./helpers";

beforeAll(migrate);

function browser(over: Partial<Browser>): Browser {
  return {
    msUsed: 0,
    links: () => Promise.reject(new Error("no links")),
    ...over,
  };
}

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
    const res = await discoverStep(db(), { fetcher, browser: b });
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
    const res = await discoverStep(db(), { fetcher, browser: b });
    expect(res.found).toBe(1);
    const [s] = await db().select().from(source).where(eq(source.board, "fallbackco"));
    expect(s.platform).toBe("lever");
  });
});
