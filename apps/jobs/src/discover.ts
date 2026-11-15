// Board discovery — spec §Discovery. Listings feeds + manual inputs →
// probe → company + source rows on `trial`, plus trial evaluation.
import { and, asc, eq, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { company, discoveryCandidate, job, source } from "@hirejuniors/db/schema";
import { chunks } from "@hirejuniors/db/queries";
import type { Db } from "./ingest";
import type { BatchItem } from "drizzle-orm/batch";
import { adapterFor, type Fetcher } from "./platforms";
import type { Browser } from "./browser";

// Spec §Discovery — verbatim patterns, first match wins, in this order.
const ATS_PATTERNS: { platform: "greenhouse" | "lever" | "ashby"; re: RegExp }[] = [
  {
    platform: "greenhouse",
    re: /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/,
  },
  { platform: "lever", re: /jobs\.lever\.co\/([A-Za-z0-9_.-]+)/ },
  { platform: "ashby", re: /jobs\.ashbyhq\.com\/([A-Za-z0-9_.-]+)/ },
];
const IGNORED_BOARDS = new Set(["embed", "api", "v1", "jobs"]);

export const DISCOVERY_STEP_SIZE = 15;
const MAX_ATTEMPTS = 3;
const RETRY_DAYS = 28;

function atsLinks(html: string): { platform: "greenhouse" | "lever" | "ashby"; board: string }[] {
  const found = [];
  for (const { platform, re } of ATS_PATTERNS) {
    const m = html.match(re);
    if (m && !IGNORED_BOARDS.has(m[1])) found.push({ platform, board: m[1] });
    if (found.length) break; // first match wins, in this order
  }
  return found;
}

/** GET a page for link scanning. null = no HTTP answer (throw/timeout);
 * a real response that isn't ok counts as an answer with no links. */
async function fetchText(fetcher: Fetcher, url: string): Promise<string | null> {
  try {
    const res = await fetcher(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return "";
    const reader = res.body?.getReader();
    if (!reader) return (await res.text()).slice(0, 512 * 1024);
    let out = "";
    const dec = new TextDecoder();
    while (out.length < 512 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
    }
    return out.slice(0, 512 * 1024);
  } catch {
    return null;
  }
}

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function uniqueCompanySlug(db: Db, name: string): Promise<string> {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  for (let n = 0; n < 100; n++) {
    const slug = n === 0 ? base : `${base}-${n + 1}`;
    const hit = await db
      .select({ id: company.id })
      .from(company)
      .where(eq(company.slug, slug))
      .limit(1);
    if (!hit.length) return slug;
  }
  return `${base}-${nanoid(6)}`;
}

type FoundPlatform = "greenhouse" | "lever" | "ashby";

async function createFound(
  db: Db,
  cand: typeof discoveryCandidate.$inferSelect,
  platform: FoundPlatform,
  board: string,
  companyName: string | undefined,
  homepageUrl: string | null,
) {
  const existing = await db
    .select({ id: source.id })
    .from(source)
    .where(and(eq(source.platform, platform), eq(source.board, board)))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(discoveryCandidate)
      .set({
        status: "duplicate",
        platform,
        board,
        sourceId: existing[0].id,
        updatedAt: new Date(),
      })
      .where(eq(discoveryCandidate.id, cand.id));
    return "duplicate" as const;
  }
  const name = companyName ?? titleCase(board);
  const companyId = `cmp_${nanoid(16)}`;
  const sourceId = `src_${nanoid(16)}`;
  await db.batch([
    db.insert(company).values({
      id: companyId,
      slug: await uniqueCompanySlug(db, name),
      name,
      homepageUrl,
    }),
    db.insert(source).values({
      id: sourceId,
      companyId,
      platform,
      board,
      includeAll: false,
      enabled: true,
      origin: "discovered",
      trial: true,
    }),
    db
      .update(discoveryCandidate)
      .set({ status: "found", platform, board, sourceId, updatedAt: new Date() })
      .where(eq(discoveryCandidate.id, cand.id)),
  ]);
  return "found" as const;
}

async function tryProbe(fetcher: Fetcher, platform: FoundPlatform, board: string) {
  const adapter = adapterFor(platform);
  if (!adapter.probe) return { ok: false, networkError: false } as const;
  return adapter.probe(fetcher, board);
}

export interface DiscoverCtx {
  fetcher: Fetcher;
  browser?: Browser;
}

/** One discover step: probe up to `limit` queued candidates, manual first. */
export async function discoverStep(
  db: Db,
  ctx: DiscoverCtx,
  limit = DISCOVERY_STEP_SIZE,
): Promise<{ probed: number; found: number }> {
  const { fetcher, browser } = ctx;
  const queued = await db
    .select()
    .from(discoveryCandidate)
    .where(
      or(
        eq(discoveryCandidate.status, "queued"),
        and(eq(discoveryCandidate.status, "failed"), lt(discoveryCandidate.attempts, MAX_ATTEMPTS)),
      ),
    )
    .orderBy(
      // manual before listings, oldest first
      sql`case when ${discoveryCandidate.origin} = 'manual' then 0 else 1 end`,
      asc(discoveryCandidate.createdAt),
    )
    .limit(limit);

  let found = 0;
  for (const cand of queued) {
    await db
      .update(discoveryCandidate)
      .set({ attempts: cand.attempts + 1, updatedAt: new Date() })
      .where(eq(discoveryCandidate.id, cand.id));

    if (cand.origin === "listings" || cand.input.includes(":")) {
      // '<platform>:<board>' — straight to probe.
      const [platform, board] = cand.input.split(":") as [FoundPlatform, string];
      const res = await tryProbe(fetcher, platform, board);
      if (res.ok) {
        if ((await createFound(db, cand, platform, board, res.companyName, null)) === "found")
          found++;
      } else {
        await db
          .update(discoveryCandidate)
          .set({
            status: res.networkError ? "failed" : "not_found",
            platform,
            board,
            updatedAt: new Date(),
          })
          .where(eq(discoveryCandidate.id, cand.id));
      }
      continue;
    }

    // Manual domain: try the four careers-URL candidates in order; Browser
    // Run `links` first (rendered, so script-injected boards count), fetch
    // fallback. First page that yields an ATS link wins.
    const d = cand.input;
    const urls = [
      `https://${d}/careers`,
      `https://${d}/jobs`,
      `https://careers.${d}`,
      `https://${d}`,
    ];
    let links: { platform: FoundPlatform; board: string }[] = [];
    let allFetchesFailed = true;
    for (const url of urls) {
      let text: string | null = null;
      if (browser) {
        try {
          text = (await browser.links(url)).join("\n");
        } catch {
          text = null;
        }
      }
      if (text === null) text = await fetchText(fetcher, url);
      if (text === null) continue;
      allFetchesFailed = false;
      links = atsLinks(text);
      if (links.length) break;
    }

    let resolved: { platform: FoundPlatform; board: string; name?: string } | null = null;
    // A probe that answers (even HTTP 404) proves connectivity; only probes
    // that throw/timeout count as network errors.
    let anyRealAnswer = false;
    for (const link of links) {
      const res = await tryProbe(fetcher, link.platform, link.board);
      if (res.ok) {
        resolved = { ...link, name: res.companyName };
        break;
      }
      if (!res.networkError) anyRealAnswer = true;
    }

    // No link found → guess the board slug from the domain: first DNS
    // label, plus the label minus a trailing `hq` when ≥3 chars remain.
    // Probe every guess on all three platforms; keep answers with ≥1 job,
    // and require a Greenhouse board's company name (normalised) to equal
    // the guess. Most jobs wins.
    if (!resolved && links.length === 0) {
      const label = d.split(".")[0];
      const guesses = [label];
      if (label.endsWith("hq") && label.length - 2 >= 3) guesses.push(label.slice(0, -2));
      const norm = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .replace(/(inc|ltd|careers|jobs)$/, "");
      let best: { platform: FoundPlatform; board: string; name?: string; jobCount: number } | null =
        null;
      for (const guess of guesses) {
        for (const platform of ["greenhouse", "lever", "ashby"] as FoundPlatform[]) {
          const res = await tryProbe(fetcher, platform, guess);
          if (!res.ok) {
            if (!res.networkError) anyRealAnswer = true;
            continue;
          }
          anyRealAnswer = true;
          if (res.jobCount < 1) continue;
          if (platform === "greenhouse" && norm(res.companyName ?? "") !== guess) continue;
          if (!best || res.jobCount > best.jobCount)
            best = { platform, board: guess, name: res.companyName, jobCount: res.jobCount };
        }
      }
      if (best) resolved = { platform: best.platform, board: best.board, name: best.name };
    }

    let outcome: "found" | "duplicate" | "not_found" | "failed" = "not_found";
    if (!resolved && allFetchesFailed && !anyRealAnswer) outcome = "failed";

    if (resolved) {
      outcome = await createFound(
        db,
        cand,
        resolved.platform,
        resolved.board,
        resolved.name,
        `https://${d}`,
      );
    } else {
      await db
        .update(discoveryCandidate)
        .set({
          status: outcome,
          error: outcome === "failed" ? "all attempts failed" : null,
          updatedAt: new Date(),
        })
        .where(eq(discoveryCandidate.id, cand.id));
    }
    if (outcome === "found") found++;
  }
  return { probed: queued.length, found };
}

/** Normalise a pasted input: a domain → lower-case bare host; a URL on a
 * Greenhouse/Lever/Ashby host → `<platform>:<board>` (dedupes with listings
 * rows). Anything else → null. */
export function normalizeInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Board slugs are case-sensitive (e.g. Ashby `Notion`) — keep URL case.
  if (/^https?:\/\//i.test(trimmed)) {
    const link = atsLinks(trimmed);
    return link.length ? `${link[0].platform}:${link[0].board}` : null;
  }
  const d = trimmed.toLowerCase().split("/")[0].split("?")[0];
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d)) return null;
  return d;
}

export async function addManualCandidates(db: Db, inputs: string[]): Promise<number> {
  const unique = [
    ...new Set(
      inputs.flatMap((d) => {
        const n = normalizeInput(d);
        return n ? [n] : [];
      }),
    ),
  ];
  for (const input of unique) {
    await db
      .insert(discoveryCandidate)
      .values({ id: `dsc_${nanoid(16)}`, origin: "manual", input })
      .onConflictDoNothing();
  }
  return unique.length;
}

/** SimplifyJobs early-career listing feeds (spec §Discovery → Listings). */
export const LISTING_FEEDS = [
  "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json",
  "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
] as const;

/**
 * Best-effort listings step — never throws: a failing or malformed feed is
 * skipped, the rest still insert. Returns the number of distinct
 * `<platform>:<board>` inputs found across feeds.
 */
export async function listingsCandidates(
  db: Db,
  fetcher: Fetcher,
  feeds: readonly string[] = LISTING_FEEDS,
): Promise<number> {
  const rowSchema = z.object({ url: z.string(), active: z.boolean().optional() });
  const inputs = new Set<string>();
  for (const feed of feeds) {
    try {
      const res = await fetcher(feed, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      const rows = z.array(z.unknown()).safeParse(await res.json());
      if (!rows.success) continue;
      for (const row of rows.data) {
        const parsed = rowSchema.safeParse(row);
        if (!parsed.success || parsed.data.active === false) continue;
        for (const { platform, board } of atsLinks(parsed.data.url)) {
          inputs.add(`${platform}:${board}`);
        }
      }
    } catch {
      // record nothing for this list and move on
    }
  }
  try {
    // unique index on input → repeat runs are no-ops
    const statements: BatchItem<"sqlite">[] = [...inputs].map((input) =>
      db
        .insert(discoveryCandidate)
        .values({ id: `dsc_${nanoid(16)}`, origin: "listings", input })
        .onConflictDoNothing(),
    );
    for (const chunk of chunks(statements, 100)) {
      await db.batch(chunk as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    }
  } catch {
    return 0;
  }
  return inputs.size;
}

/** Trial evaluation for sources that ingested successfully this run. */
export async function trialEval(db: Db, sourceIds: string[]): Promise<void> {
  for (const sourceId of sourceIds) {
    const [src] = await db.select().from(source).where(eq(source.id, sourceId)).limit(1);
    if (!src || !src.trial) continue;
    const jobs = await db
      .select({ status: job.status })
      .from(job)
      .where(eq(job.sourceId, sourceId));
    if (jobs.some((j) => j.status === "active" || j.status === "review")) {
      await db
        .update(source)
        .set({ trial: false, updatedAt: new Date() })
        .where(eq(source.id, sourceId));
    } else if (jobs.some((j) => j.status === "pending")) {
      continue; // classify cap reached — stay in trial for the next run
    } else {
      await db
        .update(source)
        .set({
          enabled: false,
          trial: false,
          disabledReason: "no_junior_roles",
          updatedAt: new Date(),
        })
        .where(eq(source.id, sourceId));
    }
  }
}

export { RETRY_DAYS };
