// Board discovery — spec §Discovery. Manual domains + Common Crawl → probe →
// company + source rows on `trial`, plus trial evaluation.
import { and, asc, eq, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { company, discoveryCandidate, discoveryCursor, job, source } from "@hirejuniors/db/schema";
import type { Db } from "./ingest";
import type { BatchItem } from "drizzle-orm/batch";
import { adapterFor, type AdapterCtx, type Fetcher } from "./platforms";
import { extractMarkdownLinks, normaliseListingUrl, parseJobLinks } from "./platforms/careers-page";
import { oneHopQuestions, type AiModels } from "./ai";
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
const BOARD_RE = /^[A-Za-z0-9_.-]+$/;

const CRAWL_HOSTS: { host: string; platform: "greenhouse" | "lever" | "ashby" }[] = [
  { host: "boards.greenhouse.io", platform: "greenhouse" },
  { host: "job-boards.greenhouse.io", platform: "greenhouse" },
  { host: "jobs.lever.co", platform: "lever" },
  { host: "jobs.ashbyhq.com", platform: "ashby" },
];
const CRAWL_PAGES_PER_RUN = 2;
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

async function fetchText(fetcher: Fetcher, url: string): Promise<string | null> {
  try {
    const res = await fetcher(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
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
    if (hit.length === 0) return slug;
  }
  return `${base}-${nanoid(6)}`;
}

/** Create company + trial source for a probed candidate, or mark duplicate. */
type FoundPlatform = "greenhouse" | "lever" | "ashby" | "careers_page";

async function createFound(
  db: Db,
  cand: typeof discoveryCandidate.$inferSelect,
  platform: FoundPlatform,
  board: string,
  companyName: string | undefined,
  homepageUrl: string | null,
  config = "{}",
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
      config,
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

async function tryProbe(
  fetcher: Fetcher,
  platform: "greenhouse" | "lever" | "ashby",
  board: string,
) {
  const adapter = adapterFor(platform);
  if (!adapter.probe) return { ok: false, networkError: false } as const;
  return adapter.probe(fetcher, board);
}

export interface DiscoverCtx {
  fetcher: Fetcher;
  browser?: Browser;
  ai?: AiModels;
}

/** One discover step: probe up to `limit` queued candidates, manual first. */
export async function discoverStep(
  db: Db,
  ctx: DiscoverCtx,
  limit = DISCOVERY_STEP_SIZE,
): Promise<{ probed: number; found: number; aiInputTokens: number }> {
  const { fetcher, browser, ai } = ctx;
  const aiTokens = { n: 0 };
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
      // manual before crawl, oldest first
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

    if (cand.origin === "crawl") {
      // '<platform>:<board>' — straight to probe, steps 1–3 skipped.
      const [platform, board] = cand.input.split(":") as ["greenhouse" | "lever" | "ashby", string];
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

    // Manual: domain → careers-page scan → slug-guess probes (spec §Discovery).
    // Step 1: try the four careers-URL candidates in order; first page that
    // yields an ATS link wins.
    const d = cand.input;
    const urls = [
      `https://${d}/careers`,
      `https://${d}/jobs`,
      `https://careers.${d}`,
      `https://${d}`,
    ];
    let links: { platform: "greenhouse" | "lever" | "ashby"; board: string }[] = [];
    let allFetchesFailed = true;
    // First step-1 page that rendered (Browser Run or fetch) — step 5 input.
    let renderedUrl: string | null = null;
    for (const url of urls) {
      // Spec §Discovery step 1: Browser Run `links` (rendered, so script-
      // injected boards count); on any browser error fall back to fetch.
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
      renderedUrl ??= url;
      links = atsLinks(text);
      if (links.length) break;
    }

    let outcome: "found" | "duplicate" | "not_found" | "failed" = "not_found";
    let resolved: {
      platform: "greenhouse" | "lever" | "ashby";
      board: string;
      name?: string;
    } | null = null;
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
    if (!resolved && links.length === 0) {
      // Step 3: slug guess = first label of the domain, probed in order.
      // Runs whenever no link was found — pages may block bots while the
      // ATS APIs still answer.
      const guess = d.split(".")[0];
      if (BOARD_RE.test(guess)) {
        for (const platform of ["greenhouse", "lever", "ashby"] as const) {
          const res = await tryProbe(fetcher, platform, guess);
          if (res.ok) {
            resolved = { platform, board: guess, name: res.companyName };
            break;
          }
          if (!res.networkError) anyRealAnswer = true;
        }
      }
    }
    if (!resolved && allFetchesFailed && !anyRealAnswer) outcome = "failed";

    // Spec §Discovery step 5 — careers-page fallback. No ATS board found but
    // a step-1 page rendered: run the careers-page listing parse on it; ≥1
    // job link → found. 0 links → one-hop choice, parse the chosen page.
    if (!resolved && outcome !== "failed" && renderedUrl && browser && ai) {
      const cctx: AdapterCtx = { fetcher, browser, ai, aiTokens };
      let listingUrl = renderedUrl;
      let jobLinks: { text: string; url: string }[] = [];
      try {
        jobLinks = await parseJobLinks(cctx, listingUrl);
      } catch {
        jobLinks = [];
      }
      if (jobLinks.length === 0) {
        // One-hop: ≤40 same-site links from the rendered markdown → one
        // clef-flash choice; accept non-"none" with p ≥ 0.60.
        try {
          const md = await browser.markdown(renderedUrl);
          const sameSite = extractMarkdownLinks(md, renderedUrl, true).slice(0, 40);
          if (sameSite.length > 0) {
            const state = sameSite.map((l, i) => `${i}. ${l.text} → ${l.url}`).join("\n");
            const res = await ai.decide("clef-flash", state, oneHopQuestions(sameSite));
            aiTokens.n += res.inputTokens;
            const ans = res.answers.open_positions;
            if (ans && ans.type === "choice" && ans.choice !== "none") {
              const p = ans.probabilities[ans.choice] ?? 0;
              const idx = Number(ans.choice.slice("link_".length));
              if (p >= 0.6 && Number.isInteger(idx) && sameSite[idx]) {
                const chosen = sameSite[idx].url;
                try {
                  jobLinks = await parseJobLinks(cctx, chosen);
                  if (jobLinks.length > 0) listingUrl = chosen;
                } catch {
                  jobLinks = [];
                }
              }
            }
          }
        } catch {
          // browser/ai error on the one-hop — leave jobLinks empty
        }
      }
      if (jobLinks.length > 0) {
        const board = normaliseListingUrl(listingUrl);
        outcome = await createFound(
          db,
          cand,
          "careers_page",
          board,
          titleCase(d.split(".")[0]),
          `https://${d}`,
          JSON.stringify({ listingUrl }),
        );
        if (outcome === "found") found++;
        continue;
      }
    }

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
  return { probed: queued.length, found, aiInputTokens: aiTokens.n };
}

/** Normalise a pasted domain to lower-case bare host (shared with apps/web). */
export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  if (!d) return null;
  d = d
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split("?")[0];
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d)) return null;
  return d;
}

export async function addManualCandidates(db: Db, domains: string[]): Promise<number> {
  const unique = [
    ...new Set(
      domains.flatMap((d) => {
        const n = normalizeDomain(d);
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

/** CDX `output=json&fl=url` bodies are newline-delimited `{"url": ...}`
 * objects (pywb); tolerate the Wayback-style array-of-arrays form too. */
function cdxUrls(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.flatMap((row) =>
        Array.isArray(row) && row.length > 0 && row[0] !== "url" ? [String(row[0])] : [],
      );
    }
  } catch {
    // not a single JSON document — fall through to NDJSON
  }
  const out: string[] = [];
  const lineSchema = z.object({ url: z.string() });
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try {
      const parsed = lineSchema.safeParse(JSON.parse(l));
      if (parsed.success) out.push(parsed.data.url);
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

/**
 * Best-effort crawl step for one host — never throws: on any error, log,
 * record nothing, don't advance the cursor.
 */
export async function crawlHost(
  db: Db,
  fetcher: Fetcher,
  crawlId: string,
  cdxApi: string,
  host: string,
  platform: "greenhouse" | "lever" | "ashby",
): Promise<number> {
  try {
    const cursorId = `${crawlId}:${host}`;
    let [cursor] = await db
      .select()
      .from(discoveryCursor)
      .where(eq(discoveryCursor.id, cursorId))
      .limit(1);
    if (cursor?.done) return 0;

    let nextPage = cursor?.nextPage ?? 0;
    let numPages = cursor?.numPages ?? null;
    const inserted: string[] = [];

    for (let p = 0; p < CRAWL_PAGES_PER_RUN; p++) {
      const url = `${cdxApi}?url=${host}/*&output=json&fl=url&page=${nextPage}`;
      const res = await fetcher(numPages === null ? `${url}&showNumPages=true` : url, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return 0; // e.g. 504 — don't advance, don't throw
      const body = numPages === null ? await res.json() : null;
      if (numPages === null) {
        const parsed = z.object({ pages: z.number().optional() }).safeParse(body);
        numPages = parsed.success ? (parsed.data.pages ?? 0) : 0;
        continue; // first call only fetched num_pages
      }
      for (const pageUrl of cdxUrls(await res.text())) {
        const seg = new URL(pageUrl.startsWith("http") ? pageUrl : `https://${pageUrl}`).pathname
          .split("/")
          .filter(Boolean)[0];
        if (!seg || IGNORED_BOARDS.has(seg) || !BOARD_RE.test(seg)) continue;
        inserted.push(`${platform}:${seg}`);
      }
      nextPage++;
    }

    const now = new Date();
    const statements: BatchItem<"sqlite">[] = [
      ...[...new Set(inserted)].map((input) =>
        db
          .insert(discoveryCandidate)
          .values({ id: `dsc_${nanoid(16)}`, origin: "crawl", input })
          .onConflictDoNothing(),
      ),
      db
        .insert(discoveryCursor)
        .values({
          id: cursorId,
          nextPage,
          numPages,
          done: numPages !== null && nextPage >= numPages,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: discoveryCursor.id,
          set: {
            nextPage,
            numPages,
            done: numPages !== null && nextPage >= numPages,
            updatedAt: now,
          },
        }),
    ];
    await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    return new Set(inserted).size;
  } catch {
    return 0; // log + move on — caller logs
  }
}

/** Newest Common Crawl collection → { crawlId, cdxApi } or null on error. */
export async function newestCrawl(fetcher: Fetcher) {
  try {
    const res = await fetcher("https://index.commoncrawl.org/collinfo.json", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const list = (await res.json()) as { id: string; "cdx-api": string }[];
    return list[0] ? { crawlId: list[0].id, cdxApi: list[0]["cdx-api"] } : null;
  } catch {
    return null;
  }
}

export { CRAWL_HOSTS };

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
