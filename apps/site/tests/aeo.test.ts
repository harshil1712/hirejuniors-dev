import { describe, it, expect } from "vite-plus/test";
import { buildJobsSitemap, llmsJobLine, jobUrl } from "../src/lib/aeo";

describe("sitemap-jobs.xml builder", () => {
  it("emits urlset with loc + lastmod", () => {
    const xml = buildJobsSitemap([
      {
        loc: jobUrl("https://hirejuniors.dev", "a-b-c"),
        lastmod: new Date("2026-11-10T12:00:00Z"),
      },
      { loc: "https://hirejuniors.dev/jobs/" },
    ]);
    expect(xml).toContain("<urlset xmlns=");
    expect(xml).toContain("<loc>https://hirejuniors.dev/job/a-b-c/</loc>");
    expect(xml).toContain("<lastmod>2026-11-10T12:00:00.000Z</lastmod>");
    expect(xml).toContain("<loc>https://hirejuniors.dev/jobs/</loc>");
  });
  it("xml-escapes locs", () => {
    const xml = buildJobsSitemap([{ loc: "https://x.dev/?a=1&b=2" }]);
    expect(xml).toContain("a=1&amp;b=2");
  });
});

describe("llms-full line", () => {
  it("matches the spec's exact format", () => {
    expect(
      llmsJobLine("https://hirejuniors.dev", {
        slug: "s1",
        title: "Graduate Engineer",
        companyName: "Acme",
        levelLabel: "graduate roles",
        location: "Berlin",
        posted: "2026-11-01",
      }),
    ).toBe(
      "- [Graduate Engineer — Acme](https://hirejuniors.dev/job/s1/): graduate roles · Berlin · posted 2026-11-01",
    );
  });
});
