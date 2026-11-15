// Per-source ingest: fetch → shrink guard → pre-filter → upsert → feed diff.
// Spec: docs/specs/ingest.md §Feed diff and §Change detection.
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { nanoid } from "nanoid";
import { ingestRun, job, source, sourceRun } from "@hirejuniors/db/schema";
import { chunks, markSourceResult, sourceWithCompany, type Db } from "@hirejuniors/db/queries";
import { isExcluded } from "./classify";
import { htmlToText } from "./html";
import { parseLocation } from "./location";
import { adapterFor, type Fetcher, type RawListing } from "./platforms";
import { jobSlug } from "./slug";

export type { Db } from "@hirejuniors/db/queries";

export interface SourceCounts {
  fetched: number;
  kept: number;
  inserted: number;
  updated: number;
  reactivated: number;
  retired: number;
}

const emptyCounts = (): SourceCounts => ({
  fetched: 0,
  kept: 0,
  inserted: 0,
  updated: 0,
  reactivated: 0,
  retired: 0,
});

export async function startRun(db: Db, trigger: "schedule" | "manual", instanceId: string) {
  const id = `run_${nanoid(16)}`;
  await db
    .insert(ingestRun)
    .values({ id, trigger, workflowInstanceId: instanceId, startedAt: new Date() });
  return id;
}

/** sha256hex(title + "\n" + location_raw + "\n" + htmlToText(description_html)). */
export async function contentHash(l: {
  title: string;
  locationRaw: string;
  descriptionHtml?: string | null;
}): Promise<string> {
  const text = `${l.title}\n${l.locationRaw}\n${htmlToText(l.descriptionHtml ?? "")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Upsert already-fetched listings for a source, then run the feed diff.
 * Every stored listing goes in (or back to) `pending` for classification —
 * except rows whose decision is sticky (`retired manual`, admin-decided
 * `active`/`rejected`) and unchanged-content rows, which keep their columns.
 */
export async function upsertListings(
  db: Db,
  src: typeof source.$inferSelect,
  companySlug: string,
  listings: RawListing[],
): Promise<SourceCounts> {
  const counts = emptyCounts();
  counts.fetched = listings.length;
  const now = new Date();

  const existing = await db
    .select({
      id: job.id,
      externalId: job.externalId,
      status: job.status,
      retireReason: job.retireReason,
      missedRuns: job.missedRuns,
      contentHash: job.contentHash,
      classifiedBy: job.classifiedBy,
    })
    .from(job)
    .where(eq(job.sourceId, src.id));
  const byExternal = new Map(existing.map((j) => [j.externalId, j]));

  const seen = new Set<string>();
  const statements: BatchItem<"sqlite">[] = [];

  for (const l of listings) {
    if (isExcluded(l.title)) continue;
    if (seen.has(l.externalId)) continue; // duplicate in one feed — first wins
    counts.kept++;
    seen.add(l.externalId);

    const loc = parseLocation(l.locationRaw, l.countryHint, l.workplaceHint);
    const hash = await contentHash(l);
    const fields = {
      title: l.title,
      employmentType: (l.employmentTypeHint ?? null) as typeof job.$inferInsert.employmentType,
      workplace: loc.workplace,
      locationRaw: l.locationRaw,
      city: loc.city,
      region: loc.region,
      countryCode: loc.countryCode,
      descriptionHtml: l.descriptionHtml ?? null,
      descriptionText: htmlToText(l.descriptionHtml ?? "") || l.title,
      applyUrl: l.applyUrl,
      postedAt: l.postedAt ?? null,
      sourceUpdatedAt: l.updatedAt ?? null,
      contentHash: hash,
      lastSeenAt: now,
      missedRuns: 0,
      updatedAt: now,
    };

    const prev = byExternal.get(l.externalId);
    if (!prev) {
      counts.inserted++;
      statements.push(
        db.insert(job).values({
          ...fields,
          status: "pending",
          sourceId: src.id,
          companyId: src.companyId,
          externalId: l.externalId,
          slug: jobSlug(l.title, companySlug, src.id, l.externalId),
          firstSeenAt: now,
        }),
      );
      continue;
    }

    const sticky =
      (prev.status === "retired" && prev.retireReason === "manual") ||
      (prev.classifiedBy === "admin" && (prev.status === "active" || prev.status === "rejected"));

    if (prev.status === "retired" && prev.retireReason === "manual") {
      counts.updated++;
      statements.push(db.update(job).set(fields).where(eq(job.id, prev.id)));
    } else if (prev.status === "retired") {
      // Reappeared in the feed → reactivated for re-classification.
      counts.reactivated++;
      statements.push(
        db
          .update(job)
          .set({
            ...fields,
            status: "pending",
            retiredAt: null,
            retireReason: null,
          })
          .where(eq(job.id, prev.id)),
      );
    } else if (prev.contentHash === hash || sticky) {
      counts.updated++;
      statements.push(db.update(job).set(fields).where(eq(job.id, prev.id)));
    } else if (prev.status === "active") {
      // Changed content on a live job: stays public, re-queued via the
      // (active AND classified_at IS NULL) queue branch.
      counts.updated++;
      statements.push(
        db
          .update(job)
          .set({ ...fields, classifiedAt: null })
          .where(eq(job.id, prev.id)),
      );
    } else {
      // pending / review / rejected with changed content → back to pending.
      counts.updated++;
      statements.push(
        db
          .update(job)
          .set({ ...fields, status: "pending", classifiedAt: null })
          .where(eq(job.id, prev.id)),
      );
    }
  }

  // Feed diff — 1 miss retires (spec: threshold now 1). Reached only when the
  // fetch + parse fully succeeded and passed the shrink guard.
  for (const prev of existing) {
    if (prev.status === "retired" || seen.has(prev.externalId)) continue;
    counts.retired++;
    statements.push(
      db
        .update(job)
        .set({
          missedRuns: prev.missedRuns + 1,
          status: "retired",
          retiredAt: now,
          retireReason: "missing_from_feed",
          updatedAt: now,
        })
        .where(eq(job.id, prev.id)),
    );
  }

  for (const chunk of chunks(statements, 25)) {
    await db.batch(chunk as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
  return counts;
}

function recordSourceRun(
  db: Db,
  runId: string,
  sourceId: string,
  status: "succeeded" | "failed",
  counts: SourceCounts,
  startedAt: Date,
  error?: string,
) {
  return db.insert(sourceRun).values({
    runId,
    sourceId,
    status,
    ...counts,
    error: error ?? null,
    startedAt,
    finishedAt: new Date(),
  });
}

/** Fetch + parse + shrink-guard + upsert one source. Throws on fetch/parse
 * failure or a tripped shrink guard — treated as a failed fetch: no diff. */
export async function ingestSource(
  db: Db,
  runId: string,
  sourceId: string,
  fetcher: Fetcher,
): Promise<SourceCounts> {
  const startedAt = new Date();
  const row = await sourceWithCompany(db, sourceId);
  if (!row) throw new Error(`source ${sourceId} not found`);
  const listings = await adapterFor(row.source.platform).fetchListings(fetcher, row.source);

  // Shrink guard — runs before upsert so a bad feed can't retire anything.
  const last = row.source.lastFetched;
  if (last !== null && last >= 10 && listings.length < last * 0.2) {
    throw new Error(`feed shrank from ${last} to ${listings.length}`);
  }
  if (listings.length === 0) {
    const hasActive = await db
      .select({ id: job.id })
      .from(job)
      .where(and(eq(job.sourceId, sourceId), eq(job.status, "active")))
      .limit(1);
    if (hasActive.length > 0) throw new Error(`feed shrank from ${last ?? 0} to 0`);
  }

  const counts = await upsertListings(db, row.source, row.company.slug, listings);
  await db.batch([
    recordSourceRun(db, runId, sourceId, "succeeded", counts, startedAt),
    markSourceResult(db, sourceId, true, undefined, listings.length),
  ]);
  return counts;
}

/** Feed-diff protection: on failure nothing was touched; just log the run. */
export async function recordSourceFailure(db: Db, runId: string, sourceId: string, error: Error) {
  const message = error.message;
  await db.batch([
    recordSourceRun(db, runId, sourceId, "failed", emptyCounts(), new Date(), message),
    markSourceResult(db, sourceId, false, message),
  ]);
}
