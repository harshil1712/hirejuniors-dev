// Retirement passes — spec §4 (expiry) and §5 (link check).
import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { job } from "@hirejuniors/db/schema";
import { chunks, expirableJobs } from "@hirejuniors/db/queries";
import type { Db } from "./ingest";
import type { Fetcher } from "./platforms";

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

/**
 * One link-check slice (called as linkcheck:<n> steps over a fixed id list
 * selected up front). 404/410 retires the job `link_dead`; any other response
 * stamps last_checked_at; a thrown fetch leaves the job untouched. Ids that
 * are no longer active are skipped.
 */
export async function linkCheckSlice(db: Db, fetcher: Fetcher, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .select({ id: job.id, applyUrl: job.applyUrl })
    .from(job)
    .where(and(inArray(job.id, ids), eq(job.status, "active")));
  if (rows.length === 0) return 0;
  const now = new Date();
  const statements: BatchItem<"sqlite">[] = [];
  for (const row of rows) {
    try {
      const res = await fetcher(row.applyUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404 || res.status === 410) {
        statements.push(
          db
            .update(job)
            .set({
              status: "retired",
              retiredAt: now,
              retireReason: "link_dead",
              lastCheckedAt: now,
              updatedAt: now,
            })
            .where(eq(job.id, row.id)),
        );
      } else {
        statements.push(db.update(job).set({ lastCheckedAt: now }).where(eq(job.id, row.id)));
      }
    } catch {
      // Network error / timeout — leave the job untouched.
    }
  }
  for (const chunk of chunks(statements, 40)) {
    await db.batch(chunk as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
  return rows.length;
}
