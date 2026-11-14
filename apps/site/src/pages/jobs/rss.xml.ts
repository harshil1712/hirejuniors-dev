// Latest 50 active jobs as RSS — SSR.
import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { siteDb } from "../../lib/site-db";
import { listActiveJobs } from "@hirejuniors/db/queries";
import { levelLabelLower } from "../../lib/levels";
import { CACHE_OK } from "../../lib/ssr";
import { PROJECT } from "#project";

export async function GET(context: APIContext) {
  const jobs = await listActiveJobs(siteDb(), {}, { limit: 50 });
  const res = await rss({
    title: `${PROJECT.productName} — latest junior roles`,
    description: "The newest junior jobs, internships, apprenticeships and graduate roles.",
    site: context.site ?? `https://${PROJECT.domain}`,
    items: jobs.map((j) => ({
      title: `${j.title} at ${j.companyName}`,
      link: `/job/${j.slug}/`,
      pubDate: j.postedAt ?? j.firstSeenAt,
      description: `${levelLabelLower(j.level)} · ${j.locationRaw}`,
    })),
  });
  res.headers.set("cache-control", CACHE_OK);
  return res;
}
