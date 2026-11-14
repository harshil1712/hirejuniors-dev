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
    const listings = await greenhouse.fetchListings(fetcher, s);
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
    await amazonJobs.fetchListings(fetcher, source);
    expect(url).toBe("https://www.amazon.jobs/en/search.json?result_limit=5");
  });
});
