import { describe, expect, it } from "vite-plus/test";
import { amazonJobs, ashby, greenhouse, lever } from "../src/platforms";
import type { SourceRow } from "../src/platforms";
import amazonFixture from "./fixtures/amazon-student-programs.json";
import ashbyFixture from "./fixtures/ashby-jobs.json";
import greenhouseFixture from "./fixtures/greenhouse-cloudflare-70480.json";
import leverFixture from "./fixtures/lever-postings.json";

const src = (over: Partial<SourceRow> = {}): SourceRow =>
  ({
    id: "src_test00000001",
    companyId: "cmp_test00000001",
    platform: "lever",
    board: "example",
    config: "{}",
    includeAll: false,
    enabled: true,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  }) as SourceRow;

describe("greenhouse adapter", () => {
  const source = src({ platform: "greenhouse", board: "cloudflare" });

  it("toListings maps a real dept payload", () => {
    const listings = greenhouse.toListings(greenhouseFixture, source);
    expect(listings.length).toBe(5);
    const first = listings[0];
    expect(first.externalId).toBe("8199958");
    expect(first.title).toContain("Software Engineer Intern");
    expect(first.applyUrl).toContain("boards.greenhouse.io/cloudflare");
    expect(first.locationRaw).toBe("In-Office");
    expect(first.updatedAt).toBeInstanceOf(Date);
  });

  it("fetchListings uses departmentIds from config and dedupes", async () => {
    const payload = greenhouseFixture;
    const fetcher = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
    const s = src({
      platform: "greenhouse",
      board: "cloudflare",
      config: '{"departmentIds":[70480,70480]}',
    });
    const listings = await greenhouse.fetchListings({ fetcher }, s);
    expect(listings.length).toBe(5); // same dept twice, deduped by job id
  });
});

describe("lever adapter", () => {
  it("toListings maps postings", () => {
    const listings = lever.toListings(leverFixture, src());
    expect(listings.length).toBe(2);
    const [grad, intern] = listings;
    expect(grad.title).toBe("Software Engineer, New Grad");
    expect(grad.employmentTypeHint).toBe("FULL_TIME");
    expect(grad.workplaceHint).toBe("hybrid");
    expect(grad.countryHint).toBe("US");
    expect(grad.postedAt).toBeInstanceOf(Date);
    expect(intern.employmentTypeHint).toBe("INTERN");
    expect(intern.workplaceHint).toBe("remote");
  });
});

describe("ashby adapter", () => {
  it("toListings maps jobs", () => {
    const listings = ashby.toListings(ashbyFixture, src({ platform: "ashby" }));
    expect(listings.length).toBe(2);
    const [grad, intern] = listings;
    expect(grad.title).toBe("Graduate Software Engineer");
    expect(grad.locationRaw).toBe("London, United Kingdom");
    expect(grad.workplaceHint).toBe("hybrid");
    expect(grad.countryHint).toBe("GB");
    expect(intern.employmentTypeHint).toBe("INTERN");
    expect(intern.workplaceHint).toBe("remote");
    expect(intern.locationRaw).toBe("Remote - Germany");
  });
});

describe("amazon_jobs adapter", () => {
  const source = src({
    platform: "amazon_jobs",
    board: "amazon",
    config: '{"query":"result_limit=5"}',
  });

  it("toListings maps a real search payload", () => {
    const listings = amazonJobs.toListings(amazonFixture, source);
    expect(listings.length).toBe(5);
    const first = listings[0];
    expect(first.externalId).toBe("4bc4467d-b1e3-4335-be56-4b3d02ced463");
    expect(first.applyUrl).toMatch(/^https:\/\/www\.amazon\.jobs\/en\/jobs\//);
    expect(first.countryHint).toBe("USA");
    expect(first.descriptionHtml).not.toContain("&amp;");
  });

  it("fetchListings builds the search URL from config.query", async () => {
    let url = "";
    const fetcher = (async (input: RequestInfo | URL) => {
      url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    }) as typeof fetch;
    await amazonJobs.fetchListings({ fetcher }, source);
    expect(url).toBe("https://www.amazon.jobs/en/search.json?result_limit=5");
  });
});

describe("tolerant parsing (spec §Adapters)", () => {
  const ghSource = src({ platform: "greenhouse" });
  const ashbySource = src({ platform: "ashby" });

  it("greenhouse: metadata: null parses", () => {
    const listings = greenhouse.toListings(
      {
        jobs: [
          { id: 1, title: "Grad", absolute_url: "https://x/1", metadata: null, location: null },
        ],
      },
      ghSource,
    );
    expect(listings).toHaveLength(1);
    expect(listings[0].title).toBe("Grad");
  });

  it("ashby: isRemote: null and workplaceType: null parse", () => {
    const listings = ashby.toListings(
      { jobs: [{ id: "j1", title: "Intern", isRemote: null, workplaceType: null }] },
      ashbySource,
    );
    expect(listings).toHaveLength(1);
    expect(listings[0].workplaceHint).toBeUndefined();
  });

  it("1 of 10 invalid → 9 listings kept", () => {
    const jobs = [
      ...Array.from({ length: 9 }, (_, i) => ({ id: `v${i}`, title: `Job ${i}` })),
      { title: 42 },
    ];
    expect(ashby.toListings({ jobs }, ashbySource)).toHaveLength(9);
  });

  it("3 of 10 invalid → throws with the first issue path", () => {
    const jobs = [
      ...Array.from({ length: 7 }, (_, i) => ({ id: `v${i}`, title: `Job ${i}` })),
      { title: 1 },
      { id: 2 },
      "not-an-object",
    ];
    expect(() => ashby.toListings({ jobs }, ashbySource)).toThrow(/3\/10 jobs invalid — .+/);
  });

  it("probe: valid envelope with invalid jobs → ok", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ jobs: [{ totally: "wrong" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    expect(await ashby.probe!(fetcher, "board")).toEqual({ ok: true, jobCount: 1 });
    expect(await greenhouse.probe!(fetcher, "board")).toEqual({
      ok: true,
      jobCount: 1,
      companyName: undefined,
    });
    // Lever's envelope is a bare array — invalid jobs still mean ok.
    const leverFetcher = (async () =>
      new Response(JSON.stringify([{ totally: "wrong" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    expect(await lever.probe!(leverFetcher, "board")).toEqual({ ok: true, jobCount: 1 });
  });
});
