// AEO summary — live counts, SSR.
import type { APIContext } from "astro";
import { getPublishedPosts } from "../lib/posts";
import { siteDb } from "../lib/site-db";
import {
  countActiveJobs,
  levelCounts,
  countryCounts,
  companiesWithActiveJobs,
} from "@hirejuniors/db/queries";
import { levelSlug, levelLabelLower } from "../lib/levels";
import { countrySlug, countryName } from "../lib/countries";
import { CACHE_OK } from "../lib/ssr";
import { PROJECT } from "#project";

export async function GET(_context: APIContext) {
  const db = siteDb();
  const origin = `https://${PROJECT.domain}`;
  const [total, levels, countries, companies, posts] = await Promise.all([
    countActiveJobs(db),
    levelCounts(db),
    countryCounts(db),
    companiesWithActiveJobs(db),
    getPublishedPosts(),
  ]);
  const summary =
    `${PROJECT.productName} is a public job board for people starting their careers. ` +
    `It lists junior jobs, internships, apprenticeships and graduate roles collected ` +
    `weekly from company job boards (Greenhouse, Lever, Ashby, Amazon Jobs). ` +
    `${total} roles are open right now. Listings are public — no account is needed; ` +
    `each job links out to the company's own application page.`;

  const lines = [
    `# ${PROJECT.productName}`,
    "",
    `> ${summary}`,
    "",
    "## Pages",
    `- [Home](${origin}/): latest roles, hub links, FAQ.`,
    `- [All jobs](${origin}/jobs/): every open role, newest first.`,
    `- [Companies](${origin}/companies/): companies with open junior roles.`,
    `- [Privacy](${origin}/privacy): what the site stores (no public accounts).`,
    `- [Blog](${origin}/blog/): notes from the ${PROJECT.productName} team.`,
    `- [Jobs RSS](${origin}/jobs/rss.xml): latest 50 roles.`,
    `- [Job sitemap](${origin}/sitemap-jobs.xml): every active job URL.`,
    "",
    "## Hubs",
    ...levels.map(
      (l) =>
        `- [${l.level}](${origin}/jobs/${levelSlug(l.level)}/): ${l.n} open ${levelLabelLower(l.level)}.`,
    ),
    ...countries
      .filter((c) => c.countryCode)
      .map(
        (c) =>
          `- [${countryName(c.countryCode as string)}](${origin}/jobs/in/${countrySlug(c.countryCode as string)}/): ${c.n} open roles.`,
      ),
    "",
    "## Companies",
    ...companies.map(
      (c) =>
        `- [${c.company.name}](${origin}/companies/${c.company.slug}/): ${c.activeCount} open roles.`,
    ),
    "",
    "## Blog",
    ...posts.map((p) => `- [${p.data.title}](${origin}/blog/${p.id}/): ${p.data.description}`),
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": CACHE_OK,
    },
  });
}
