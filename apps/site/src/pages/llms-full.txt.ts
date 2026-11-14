// llms.txt plus every active job, in the spec's exact line format — SSR.
import type { APIContext } from "astro";
import { GET as llmsTxt } from "./llms.txt";
import { siteDb } from "../lib/site-db";
import { listActiveJobs } from "@hirejuniors/db/queries";
import { levelLabelLower } from "../lib/levels";
import { isoDate } from "../lib/format";
import { llmsJobLine } from "../lib/aeo";
import { CACHE_OK } from "../lib/ssr";

export async function GET(context: APIContext) {
  const base = await llmsTxt(context);
  const jobs = await listActiveJobs(siteDb(), {}, { limit: 100000 });
  const section = [
    "",
    "## Open roles",
    ...jobs.map((j) =>
      llmsJobLine(`https://hirejuniors.dev`, {
        slug: j.slug,
        title: j.title,
        companyName: j.companyName,
        levelLabel: levelLabelLower(j.level),
        location: j.locationRaw,
        posted: isoDate(j.postedAt ?? j.firstSeenAt),
      }),
    ),
    "",
  ];
  const body = (await base.text()) + section.join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": CACHE_OK,
    },
  });
}
