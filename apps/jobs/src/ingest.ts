// Per-source ingest: fetch → parse → classify → upsert → feed diff.
// Spec: docs/specs/ingest.md §3.
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { nanoid } from "nanoid";
import { ingestRun, job, source, sourceRun } from "@hirejuniors/db/schema";
import { chunks, markSourceResult, sourceWithCompany, type Db } from "@hirejuniors/db/queries";
import { classifyLevel, isExcluded } from "./classify";
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

/**
 * Upsert already-fetched listings for a source, then run the feed diff.
 * Exported separately from fetch so tests can drive it with fixtures.
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
    })
    .from(job)
    .where(eq(job.sourceId, src.id));
  const byExternal = new Map(existing.map((j) => [j.externalId, j]));

  const seen = new Set<string>();
  const statements: BatchItem<"sqlite">[] = [];

  for (const l of listings) {
    if (isExcluded(l.title)) continue;
    let level = classifyLevel(l.title, l.employmentTypeHint);
    if (!level) {
      if (!src.includeAll) continue;
      level = "graduate";
    }
    if (seen.has(l.externalId)) continue; // duplicate in one feed — first wins
    counts.kept++;
    seen.add(l.externalId);

    const loc = parseLocation(l.locationRaw, l.countryHint, l.workplaceHint);
    const fields = {
      title: l.title,
      level,
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
          sourceId: src.id,
          companyId: src.companyId,
          externalId: l.externalId,
          slug: jobSlug(l.title, companySlug, src.id, l.externalId),
          firstSeenAt: now,
        }),
      );
    } else if (prev.status === "retired" && prev.retireReason === "manual") {
      // Manual retire is sticky — refresh the row, never reactivate.
      counts.updated++;
      statements.push(db.update(job).set(fields).where(eq(job.id, prev.id)));
    } else if (prev.status === "retired") {
      counts.reactivated++;
      statements.push(
        db
          .update(job)
          .set({ ...fields, status: "active", retiredAt: null, retireReason: null })
          .where(eq(job.id, prev.id)),
      );
    } else {
      counts.updated++;
      statements.push(db.update(job).set(fields).where(eq(job.id, prev.id)));
    }
  }

  // Feed diff — only reached when fetch + parse fully succeeded.
  for (const prev of existing) {
    if (prev.status !== "active" || seen.has(prev.externalId)) continue;
    const missed = prev.missedRuns + 1;
    if (missed >= 2) {
      counts.retired++;
      statements.push(
        db
          .update(job)
          .set({
            missedRuns: missed,
            status: "retired",
            retiredAt: now,
            retireReason: "missing_from_feed",
            updatedAt: now,
          })
          .where(eq(job.id, prev.id)),
      );
    } else {
      statements.push(
        db.update(job).set({ missedRuns: missed, updatedAt: now }).where(eq(job.id, prev.id)),
      );
    }
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

/** Fetch + parse + upsert one source. Throws on fetch/parse failure — the
 * caller (workflow catch / tests) records it via recordSourceFailure. */
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
  const counts = await upsertListings(db, row.source, row.company.slug, listings);
  await db.batch([
    recordSourceRun(db, runId, sourceId, "succeeded", counts, startedAt),
    markSourceResult(db, sourceId, true),
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
