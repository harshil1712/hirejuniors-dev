// Query helpers shared by the ingest pipeline (apps/jobs). Kept here so the
// read paths later reused by apps/web + apps/site stay next to the schema.
import { and, asc, count, desc, eq, like, lt, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { company, ingestRun, job, source } from "./schema";

export type Db = DrizzleD1Database;

/** D1 allows ~100 bound parameters per statement — chunk writes under it. */
export function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export function sourceWithCompany(db: Db, sourceId: string) {
  return db
    .select({ source, company })
    .from(source)
    .innerJoin(company, eq(source.companyId, company.id))
    .where(eq(source.id, sourceId))
    .then((r) => r[0]);
}

/** Active jobs whose explicit deadline (valid_through) has passed. */
export function expirableJobs(db: Db, now: Date) {
  return db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.status, "active"), lt(job.validThrough, now)));
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

export function markSourceResult(
  db: Db,
  sourceId: string,
  ok: boolean,
  error?: string,
  lastFetched?: number,
) {
  const set: Partial<typeof source.$inferInsert> = {
    lastRunAt: new Date(),
    lastStatus: ok ? "succeeded" : "failed",
    lastError: ok ? null : (error ?? "unknown error"),
    updatedAt: new Date(),
  };
  if (lastFetched !== undefined) set.lastFetched = lastFetched;
  return db.update(source).set(set).where(eq(source.id, sourceId));
}

/** Sources a run ingests: enabled, plus no_junior_roles-disabled sources due
 * for their 28-day retry (manual disables are never retried). Retry-due rows
 * are re-enabled as trial in the same step — the spec treats them "as
 * enabled, trial = true" so trialEval decides their fate again. */
export async function ingestibleSources(db: Db, now = new Date()) {
  const retryBefore = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  await db
    .update(source)
    .set({ enabled: true, trial: true, disabledReason: null, updatedAt: now })
    .where(and(eq(source.disabledReason, "no_junior_roles"), lt(source.lastRunAt, retryBefore)));
  return db.select({ id: source.id }).from(source).where(eq(source.enabled, true));
}

// ---- public job-board reads (apps/site) ----
// Every listing helper below is status='active' scoped. The only function
// that may return a non-active row is jobBySlug (the detail page needs the
// retired row to render its 410 state).

export interface JobFilters {
  level?: (typeof job.level.enumValues)[number];
  countryCode?: string;
  companyId?: string;
  q?: string;
}

function activeWhere(f: JobFilters) {
  const conds = [eq(job.status, "active")];
  if (f.level) conds.push(eq(job.level, f.level));
  if (f.countryCode) conds.push(eq(job.countryCode, f.countryCode));
  if (f.companyId) conds.push(eq(job.companyId, f.companyId));
  if (f.q) conds.push(like(job.title, `%${f.q}%`));
  return and(...conds);
}

const jobCard = {
  id: job.id,
  slug: job.slug,
  title: job.title,
  level: job.level,
  workplace: job.workplace,
  locationRaw: job.locationRaw,
  city: job.city,
  region: job.region,
  countryCode: job.countryCode,
  postedAt: job.postedAt,
  applyUrl: job.applyUrl,
  firstSeenAt: job.firstSeenAt,
  companyId: job.companyId,
  companyName: company.name,
  companySlug: company.slug,
};

const NEWEST = sql`coalesce(${job.postedAt}, ${job.firstSeenAt}) desc`;

export function listActiveJobs(db: Db, f: JobFilters, opts: { offset?: number; limit: number }) {
  return db
    .select(jobCard)
    .from(job)
    .innerJoin(company, eq(job.companyId, company.id))
    .where(activeWhere(f))
    .orderBy(NEWEST, desc(job.id))
    .limit(opts.limit)
    .offset(opts.offset ?? 0);
}

export function countActiveJobs(db: Db, f: JobFilters = {}) {
  return db
    .select({ n: count() })
    .from(job)
    .where(activeWhere(f))
    .then((r) => r[0]?.n ?? 0);
}

/** One row per level with its active count (hubs, llms.txt, sitemap). */
export async function levelCounts(db: Db) {
  const rows = await db
    .select({ level: job.level, n: count() })
    .from(job)
    .where(eq(job.status, "active"))
    .groupBy(job.level);
  return rows as { level: NonNullable<(typeof job.$inferSelect)["level"]>; n: number }[];
}

/** One row per country_code with its active count; null codes last. */
export function countryCounts(db: Db) {
  return db
    .select({ countryCode: job.countryCode, n: count() })
    .from(job)
    .where(eq(job.status, "active"))
    .groupBy(job.countryCode)
    .orderBy(desc(count()));
}

/** Level x country matrix for the combination hubs / sitemap. */
export async function levelCountryCounts(db: Db) {
  const rows = await db
    .select({ level: job.level, countryCode: job.countryCode, n: count() })
    .from(job)
    .where(eq(job.status, "active"))
    .groupBy(job.level, job.countryCode);
  return rows as {
    level: NonNullable<(typeof job.$inferSelect)["level"]>;
    countryCode: string | null;
    n: number;
  }[];
}

/** Job detail — any status (410 page needs the retired row) + company. */
export function jobBySlug(db: Db, slug: string) {
  return db
    .select({ job, company })
    .from(job)
    .innerJoin(company, eq(job.companyId, company.id))
    .where(eq(job.slug, slug))
    .then((r) => r[0] ?? null);
}

/** Retired-detail alternatives: active jobs from the same company or level. */
export function relatedActiveJobs(
  db: Db,
  opts: {
    companyId: string;
    level: (typeof job.level.enumValues)[number];
    excludeId: string;
    limit: number;
  },
) {
  return db
    .select(jobCard)
    .from(job)
    .innerJoin(company, eq(job.companyId, company.id))
    .where(
      and(
        eq(job.status, "active"),
        or(eq(job.companyId, opts.companyId), eq(job.level, opts.level)),
        sql`${job.id} != ${opts.excludeId}`,
      ),
    )
    .orderBy(NEWEST, desc(job.id))
    .limit(opts.limit);
}

/** Companies that have >= 1 active job, alphabetical. */
export function companiesWithActiveJobs(db: Db) {
  return db
    .select({ company, activeCount: count() })
    .from(company)
    .innerJoin(job, and(eq(job.companyId, company.id), eq(job.status, "active")))
    .groupBy(company.id)
    .orderBy(asc(company.name));
}

export function companyBySlug(db: Db, slug: string) {
  return db
    .select({ company, activeCount: count() })
    .from(company)
    .leftJoin(job, and(eq(job.companyId, company.id), eq(job.status, "active")))
    .where(eq(company.slug, slug))
    .groupBy(company.id)
    .then((r) => r[0] ?? null);
}

/** Slug + lastmod source for sitemap-jobs.xml (active only). */
export function sitemapJobRows(db: Db) {
  return db
    .select({ slug: job.slug, updatedAt: job.updatedAt })
    .from(job)
    .where(eq(job.status, "active"));
}
