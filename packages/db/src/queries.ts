// Query helpers shared by the ingest pipeline (apps/jobs). Kept here so the
// read paths later reused by apps/web + apps/site stay next to the schema.
import { and, asc, eq, lt, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { company, ingestRun, job, source } from "./schema";

export type Db = DrizzleD1Database;

/** D1 allows ~100 bound parameters per statement — chunk writes under it. */
export function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export function enabledSources(db: Db) {
  return db.select({ id: source.id }).from(source).where(eq(source.enabled, true));
}

export function sourceWithCompany(db: Db, sourceId: string) {
  return db
    .select({ source, company })
    .from(source)
    .innerJoin(company, eq(source.companyId, company.id))
    .where(eq(source.id, sourceId))
    .then((r) => r[0]);
}

/** Active jobs that lapsed: explicit deadline passed or > 90 days old. */
export function expirableJobs(db: Db, now: Date) {
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  return db
    .select({ id: job.id })
    .from(job)
    .where(
      and(
        eq(job.status, "active"),
        or(
          lt(job.validThrough, now),
          lt(sql`coalesce(${job.postedAt}, ${job.firstSeenAt})`, cutoff.getTime()),
        ),
      ),
    );
}

/**
 * Ids of active jobs due for a link check — never-checked first, then oldest
 * `last_checked_at`. Selected once per run (workflow `linkcheck:select` step)
 * and fanned out into 40-id slices; stamping rows mid-run can't skip or
 * re-pick them.
 */
export function jobsForLinkCheck(db: Db, limit: number) {
  return db
    .select({ id: job.id })
    .from(job)
    .where(eq(job.status, "active"))
    .orderBy(sql`${job.lastCheckedAt} IS NULL DESC`, asc(job.lastCheckedAt))
    .limit(limit);
}

export function finishIngestRun(
  db: Db,
  runId: string,
  status: "succeeded" | "partial" | "failed",
  totals: {
    fetched: number;
    inserted: number;
    updated: number;
    reactivated: number;
    retired: number;
  },
  error?: string,
) {
  return db
    .update(ingestRun)
    .set({ status, finishedAt: new Date(), error: error ?? null, ...totals })
    .where(eq(ingestRun.id, runId));
}

export function markSourceResult(db: Db, sourceId: string, ok: boolean, error?: string) {
  return db
    .update(source)
    .set({
      lastRunAt: new Date(),
      lastStatus: ok ? "succeeded" : "failed",
      lastError: ok ? null : (error ?? "unknown error"),
      updatedAt: new Date(),
    })
    .where(eq(source.id, sourceId));
}
