import { and, count, desc, eq, gt, lt, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { company, ingestRun, job, source, sourceRun } from "../../schema/db";
import type { RunListQuery } from "../api/schemas";
import { ServiceError } from "./errors";

type Db = DrizzleD1Database;

function toApi(row: typeof ingestRun.$inferSelect) {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    fetched: row.fetched,
    inserted: row.inserted,
    updated: row.updated,
    reactivated: row.reactivated,
    retired: row.retired,
    classified: row.classified,
    rejected: row.rejected,
    review: row.review,
    discovered: row.discovered,
    aiInputTokens: row.aiInputTokens,
    aiOutputTokens: row.aiOutputTokens,
    browserMs: row.browserMs,
    error: row.error,
  };
}

function decodeCursor(cursor: string) {
  let decoded = "";
  try {
    decoded = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {}
  const match = /^(\d+):(run_[\w-]+)$/.exec(decoded);
  if (!match) throw new ServiceError("validation_failed", "Malformed pagination cursor");
  return { startedAt: Number(match[1]), id: match[2] };
}

function encodeCursor(startedAt: Date, id: string): string {
  return btoa(`${startedAt.getTime()}:${id}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function list(
  db: Db,
  query: RunListQuery,
): Promise<{ items: ReturnType<typeof toApi>[]; nextCursor: string | null }> {
  const conditions = [];
  if (query.cursor !== undefined) {
    const { startedAt, id } = decodeCursor(query.cursor);
    conditions.push(
      or(
        lt(ingestRun.startedAt, new Date(startedAt)),
        and(eq(ingestRun.startedAt, new Date(startedAt)), lt(ingestRun.id, id)),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(ingestRun)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ingestRun.startedAt), desc(ingestRun.id))
    .limit(query.limit + 1);
  const items = rows.length > query.limit ? rows.slice(0, query.limit) : rows;
  let nextCursor: string | null = null;
  if (rows.length > query.limit) {
    const last = items[items.length - 1];
    nextCursor = encodeCursor(last.startedAt, last.id);
  }
  return { items: items.map(toApi), nextCursor };
}

export async function get(db: Db, id: string) {
  const row = await db.select().from(ingestRun).where(eq(ingestRun.id, id)).get();
  if (!row) throw new ServiceError("not_found", `No such run: ${id}`);
  const rows = await db
    .select({
      sourceRun,
      platform: source.platform,
      board: source.board,
      companyName: company.name,
    })
    .from(sourceRun)
    .innerJoin(source, eq(sourceRun.sourceId, source.id))
    .innerJoin(company, eq(source.companyId, company.id))
    .where(eq(sourceRun.runId, id))
    .orderBy(sourceRun.startedAt, sourceRun.id);
  const sourceRuns = rows.map((r) => ({
    id: r.sourceRun.id,
    sourceId: r.sourceRun.sourceId,
    sourceName: `${r.platform}/${r.board}`,
    companyName: r.companyName,
    status: r.sourceRun.status,
    fetched: r.sourceRun.fetched,
    kept: r.sourceRun.kept,
    inserted: r.sourceRun.inserted,
    updated: r.sourceRun.updated,
    reactivated: r.sourceRun.reactivated,
    retired: r.sourceRun.retired,
    error: r.sourceRun.error,
    startedAt: r.sourceRun.startedAt.toISOString(),
    finishedAt: r.sourceRun.finishedAt.toISOString(),
  }));
  return { ...toApi(row), sourceRuns };
}

/** POST /runs — start a manual ingest run via the cross-script Workflow
 * binding on the jobs worker. Absent binding (previews/tests) → 503. */
export async function trigger(env: Env): Promise<{ instanceId: string }> {
  const workflow = env.INGEST_WORKFLOW;
  if (!workflow) {
    throw new ServiceError("unavailable", "Ingest workflow binding is not configured");
  }
  const instance = await workflow.create({ params: { trigger: "manual" } });
  return { instanceId: instance.id };
}

/** Dashboard tiles: job + source + last-run counters. */
export async function summary(db: Db) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [active, retiredRecent, failing, last] = await Promise.all([
    db.select({ n: count() }).from(job).where(eq(job.status, "active")).get(),
    db
      .select({ n: count() })
      .from(job)
      .where(and(eq(job.status, "retired"), gt(job.retiredAt, weekAgo)))
      .get(),
    db
      .select({ n: count() })
      .from(source)
      .where(and(eq(source.enabled, true), eq(source.lastStatus, "failed")))
      .get(),
    db.select().from(ingestRun).orderBy(desc(ingestRun.startedAt)).limit(1).get(),
  ]);
  return {
    activeJobs: active?.n ?? 0,
    retiredLast7Days: retiredRecent?.n ?? 0,
    failingSources: failing?.n ?? 0,
    lastRun: last ? toApi(last) : null,
  };
}
