// SSR job sitemap — active job URLs + hubs/companies that have live jobs.
import type { APIContext } from "astro";
import { siteDb } from "../lib/site-db";
import {
  sitemapJobRows,
  levelCounts,
  countryCounts,
  levelCountryCounts,
  companiesWithActiveJobs,
} from "@hirejuniors/db/queries";
import { levelSlug } from "../lib/levels";
import { countrySlug } from "../lib/countries";
import { buildJobsSitemap, jobUrl, type SitemapEntry } from "../lib/aeo";
import { CACHE_OK } from "../lib/ssr";
import { PROJECT } from "#project";

export async function GET(_context: APIContext) {
  const db = siteDb();
  const origin = `https://${PROJECT.domain}`;
  const [jobs, levels, countries, matrix, companies] = await Promise.all([
    sitemapJobRows(db),
    levelCounts(db),
    countryCounts(db),
    levelCountryCounts(db),
    companiesWithActiveJobs(db),
  ]);
  const entries: SitemapEntry[] = [
    { loc: `${origin}/jobs/` },
    ...levels.map((l) => ({ loc: `${origin}/jobs/${levelSlug(l.level)}/` })),
    ...countries
      .filter((c) => c.countryCode)
      .map((c) => ({ loc: `${origin}/jobs/in/${countrySlug(c.countryCode as string)}/` })),
    ...matrix
      .filter((m) => m.countryCode)
      .map((m) => ({
        loc: `${origin}/jobs/${levelSlug(m.level)}/in/${countrySlug(m.countryCode as string)}/`,
      })),
    ...companies.map((c) => ({ loc: `${origin}/companies/${c.company.slug}/` })),
    ...jobs.map((j) => ({ loc: jobUrl(origin, j.slug), lastmod: j.updatedAt })),
  ];
  return new Response(buildJobsSitemap(entries), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": CACHE_OK,
    },
  });
}
