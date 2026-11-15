import { and, desc, eq, lt, like, or, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { company, job } from "../../schema/db";
import type { Job, JobListQuery } from "../api/schemas";
import { ServiceError } from "./errors";

type Db = DrizzleD1Database;

const jobCompany = {
  id: company.id,
  name: company.name,
  slug: company.slug,
};

type CompanyBrief = { id: string; name: string; slug: string };

function toApi(row: { job: typeof job.$inferSelect; company: CompanyBrief }): Job {
  const j = row.job;
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: j.id,
    slug: j.slug,
    title: j.title,
    level: j.level,
    employmentType: j.employmentType,
    workplace: j.workplace,
    locationRaw: j.locationRaw,
    city: j.city,
    region: j.region,
    countryCode: j.countryCode,
    descriptionHtml: j.descriptionHtml,
    descriptionText: j.descriptionText,
    applyUrl: j.applyUrl,
    postedAt: iso(j.postedAt),
    sourceUpdatedAt: iso(j.sourceUpdatedAt),
    validThrough: iso(j.validThrough),
    firstSeenAt: j.firstSeenAt.toISOString(),
    lastSeenAt: j.lastSeenAt.toISOString(),
    status: j.status,
    retiredAt: iso(j.retiredAt),
    retireReason: j.retireReason,
    classifiedAt: iso(j.classifiedAt),
    classifiedBy: j.classifiedBy,
    classifierConfidence: j.classifierConfidence,
    rejectReason: j.rejectReason,
    reviewReason: j.reviewReason,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
    salaryCurrency: j.salaryCurrency,
    salaryPeriod: j.salaryPeriod,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
    companyId: j.companyId,
    sourceId: j.sourceId,
    company: row.company,
  };
}

function decodeCursor(cursor: string) {
  let decoded = "";
  try {
    decoded = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {}
  const match = /^(\d+):(job_[\w-]+)$/.exec(decoded);
  if (!match) throw new ServiceError("validation_failed", "Malformed pagination cursor");
  return { firstSeenAt: Number(match[1]), id: match[2] };
}

function encodeCursor(firstSeenAt: Date, id: string): string {
  return btoa(`${firstSeenAt.getTime()}:${id}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function list(
  db: Db,
  query: JobListQuery,
): Promise<{ items: Job[]; nextCursor: string | null }> {
  const conditions: SQL[] = [eq(job.status, query.status)];
  if (query.level !== undefined) conditions.push(eq(job.level, query.level));
  if (query.country !== undefined)
    conditions.push(eq(job.countryCode, query.country.toUpperCase()));
  if (query.companyId !== undefined) conditions.push(eq(job.companyId, query.companyId));
  if (query.sourceId !== undefined) conditions.push(eq(job.sourceId, query.sourceId));
  if (query.q !== undefined) {
    // SQLite LIKE is case-insensitive for ASCII — a title contains-match.
    conditions.push(like(job.title, `%${query.q}%`));
  }
  if (query.cursor !== undefined) {
    const { firstSeenAt, id } = decodeCursor(query.cursor);
    // Keyset pagination, newest first: strictly after (firstSeenAt, id) in
    // (first_seen_at DESC, id DESC) order.
    conditions.push(
      or(
        lt(job.firstSeenAt, new Date(firstSeenAt)),
        and(eq(job.firstSeenAt, new Date(firstSeenAt)), lt(job.id, id)),
      )!,
    );
  }
  const rows = await db
    .select({ job, company: jobCompany })
    .from(job)
    .innerJoin(company, eq(job.companyId, company.id))
    .where(and(...conditions))
    .orderBy(desc(job.firstSeenAt), desc(job.id))
    .limit(query.limit + 1);

  const items = rows.length > query.limit ? rows.slice(0, query.limit) : rows;
  let nextCursor: string | null = null;
  if (rows.length > query.limit) {
    const last = items[items.length - 1];
    nextCursor = encodeCursor(last.job.firstSeenAt, last.job.id);
  }
  return { items: items.map(toApi), nextCursor };
}

export async function get(db: Db, id: string): Promise<Job> {
  const row = await db
    .select({ job, company: jobCompany })
    .from(job)
    .innerJoin(company, eq(job.companyId, company.id))
    .where(eq(job.id, id))
    .get();
  if (!row) throw new ServiceError("not_found", `No such job: ${id}`);
  return toApi(row);
}

/** Approve a review/rejected job → active with an admin-picked level.
 * `classified_by = 'admin'` makes the decision sticky across content changes. */
export async function approve(db: Db, id: string, level: Job["level"]): Promise<Job> {
  const now = new Date();
  await get(db, id); // not_found
  await db
    .update(job)
    .set({
      status: "active",
      level,
      classifiedBy: "admin",
      classifiedAt: now,
      rejectReason: null,
      reviewReason: null,
      updatedAt: now,
    })
    .where(eq(job.id, id));
  return get(db, id);
}

/** Reject → status rejected, reason admin (sticky like approve). */
export async function reject(db: Db, id: string): Promise<Job> {
  const now = new Date();
  await get(db, id); // not_found
  await db
    .update(job)
    .set({
      status: "rejected",
      rejectReason: "admin",
      classifiedBy: "admin",
      classifiedAt: now,
      updatedAt: now,
    })
    .where(eq(job.id, id));
  return get(db, id);
}

/** Manual retire/restore. Manual retirement is sticky — the ingest diff
 * never reactivates a `manual` retiree (see apps/jobs). */
export async function setStatus(db: Db, id: string, status: "active" | "retired"): Promise<Job> {
  const now = new Date();
  const patch =
    status === "retired"
      ? {
          status: "retired" as const,
          retireReason: "manual" as const,
          retiredAt: now,
          updatedAt: now,
        }
      : {
          status: "active" as const,
          retireReason: null,
          retiredAt: null,
          updatedAt: now,
        };
  await get(db, id); // not_found
  await db.update(job).set(patch).where(eq(job.id, id));
  return get(db, id);
}
