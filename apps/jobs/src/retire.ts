// Retirement passes — spec §Feed diff: expiry + link/page check with the
// 25% closed-page circuit breaker.
import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { job } from "@hirejuniors/db/schema";
import { chunks, expirableJobs } from "@hirejuniors/db/queries";
import type { Db } from "./ingest";
import type { Fetcher } from "./platforms";
import { PAGE_OPEN_QUESTION, type AiModels } from "./ai";
import type { Browser } from "./browser";
import { htmlToText } from "./html";

/** Retire `expired`: valid_through passed, or posted/first-seen > 90 days. */
export async function expireJobs(db: Db, now = new Date()): Promise<number> {
  const rows = await expirableJobs(db, now);
  if (rows.length === 0) return 0;
  for (const chunk of chunks(
    rows.map((r) => r.id),
    80,
  )) {
    await db
      .update(job)
      .set({ status: "retired", retiredAt: now, retireReason: "expired", updatedAt: now })
      .where(inArray(job.id, chunk));
  }
  return rows.length;
}

export interface SliceResult {
  checked: number;
  linkDead: number;
  closedPage: number;
  breakerTripped: boolean;
}

async function followRedirects(fetcher: Fetcher, url: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    const res = await fetcher(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 300 && res.status < 400 && hop < 3) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).href;
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

/**
 * One link-check slice (≤40 ids, selected up front by linkcheck:select).
 * 404/410 at any hop → link_dead. Final 2xx text/html → page check: under
 * 200 chars of text just stamps; otherwise clef-flash `open` ≤ 0.15 →
 * closed_page. If >25% of the slice would retire closed_page, none of that
 * slice's closed_page retirements apply (link_dead still applies).
 */
export async function linkCheckSlice(
  db: Db,
  fetcher: Fetcher,
  ai: AiModels,
  ids: string[],
  browser?: Browser,
): Promise<SliceResult> {
  const result: SliceResult = { checked: 0, linkDead: 0, closedPage: 0, breakerTripped: false };
  if (ids.length === 0) return result;
  const rows = await db
    .select({ id: job.id, applyUrl: job.applyUrl, title: job.title })
    .from(job)
    .where(and(inArray(job.id, ids), eq(job.status, "active")));
  if (rows.length === 0) return result;
  result.checked = rows.length;
  const now = new Date();

  const verdicts: { id: string; retire?: "link_dead" | "closed_page" }[] = [];
  for (const row of rows) {
    try {
      const res = await followRedirects(fetcher, row.applyUrl);
      if (res.status === 404 || res.status === 410) {
        verdicts.push({ id: row.id, retire: "link_dead" });
        result.linkDead++;
        continue;
      }
      const type = res.headers.get("content-type") ?? "";
      if (res.status >= 200 && res.status < 300 && type.includes("text/html")) {
        const html = await res.text();
        // Page check reads Browser Run `markdown`; on any browser error fall
        // back to the fetched HTML (spec §Browser Run / page check).
        let text: string;
        if (browser) {
          try {
            text = (await browser.markdown(row.applyUrl)).slice(0, 6000);
          } catch {
            text = htmlToText(html).slice(0, 6000);
          }
        } else {
          text = htmlToText(html).slice(0, 6000);
        }
        if (text.length < 200) {
          verdicts.push({ id: row.id }); // JS-rendered page — just stamp
          continue;
        }
        try {
          const ans = await ai.decide("clef-flash", text, PAGE_OPEN_QUESTION);
          const open = ans.answers.open;
          if (open && open.type === "noul" && open.noul <= 0.15) {
            verdicts.push({ id: row.id, retire: "closed_page" });
            result.closedPage++;
          } else {
            verdicts.push({ id: row.id });
          }
        } catch {
          // Model error → untouched (not even a stamp).
        }
        continue;
      }
      verdicts.push({ id: row.id }); // any other status → stamp
    } catch {
      // Network error / timeout — leave the job untouched.
    }
  }

  const breaker = result.closedPage > rows.length * 0.25;
  if (breaker) {
    result.breakerTripped = true;
    result.closedPage = 0;
  }

  const statements: BatchItem<"sqlite">[] = [];
  for (const v of verdicts) {
    if (v.retire === "closed_page" && breaker) {
      statements.push(db.update(job).set({ lastCheckedAt: now }).where(eq(job.id, v.id)));
    } else if (v.retire) {
      statements.push(
        db
          .update(job)
          .set({
            status: "retired",
            retiredAt: now,
            retireReason: v.retire,
            lastCheckedAt: now,
            updatedAt: now,
          })
          .where(eq(job.id, v.id)),
      );
    } else {
      statements.push(db.update(job).set({ lastCheckedAt: now }).where(eq(job.id, v.id)));
    }
  }
  for (const chunk of chunks(statements, 40)) {
    await db.batch(chunk as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
  return result;
}
