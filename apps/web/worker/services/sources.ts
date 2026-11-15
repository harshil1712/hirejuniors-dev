import { and, asc, eq, ne, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { adapterFor, type SourceRow } from "@hirejuniors/jobs/platforms";
import { classifyLevel, isExcluded } from "@hirejuniors/jobs/classify";
import { parseLocation } from "@hirejuniors/jobs/location";
import { company, job, source } from "../../schema/db";
import type {
  Source,
  SourceCreate,
  SourcePlatform,
  SourcePreview,
  SourcePreviewResult,
  SourceUpdate,
} from "../api/schemas";
import { ServiceError } from "./errors";

type Db = DrizzleD1Database;

const sourceCompany = {
  id: company.id,
  name: company.name,
  slug: company.slug,
};

type SourceJoinRow = {
  source: typeof source.$inferSelect;
  company: { id: string; name: string; slug: string };
  activeJobs: number;
};

function toApi(row: SourceJoinRow): Source {
  const s = row.source;
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: s.id,
    company: row.company,
    platform: s.platform,
    board: s.board,
    config: s.config,
    includeAll: s.includeAll,
    enabled: s.enabled,
    origin: s.origin,
    trial: s.trial,
    disabledReason: s.disabledReason,
    lastFetched: s.lastFetched,
    lastRunAt: iso(s.lastRunAt),
    lastStatus: s.lastStatus,
    lastError: s.lastError,
    activeJobs: row.activeJobs,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function list(db: Db): Promise<Source[]> {
  return db
    .select({
      source,
      company: sourceCompany,
      activeJobs: sql<number>`(select count(*) from ${job} where ${job.sourceId} = ${source.id} and ${job.status} = 'active')`,
    })
    .from(source)
    .innerJoin(company, eq(source.companyId, company.id))
    .orderBy(asc(company.name), asc(source.platform), asc(source.board))
    .then((rows) => rows.map(toApi));
}

/** Validate `config` JSON against the platform adapter — bad config is a
 * 400, not a row that fails on the next ingest run. */
function validateConfig(platform: SourcePlatform, configJson: string) {
  try {
    adapterFor(platform).parseConfig(configJson);
  } catch (e) {
    const message = e instanceof Error ? e.message : "invalid config";
    throw new ServiceError("validation_failed", `Invalid ${platform} config: ${message}`, [
      { path: "config", message },
    ]);
  }
}

async function ensureBoardFree(
  db: Db,
  platform: SourcePlatform,
  board: string,
  excludeId?: string,
) {
  const conditions = [eq(source.platform, platform), eq(source.board, board)];
  if (excludeId !== undefined) conditions.push(ne(source.id, excludeId));
  const dupe = await db
    .select({ id: source.id })
    .from(source)
    .where(and(...conditions))
    .get();
  if (dupe) {
    throw new ServiceError("conflict", `A ${platform} source for board ${board} already exists`);
  }
}

export async function create(db: Db, input: SourceCreate): Promise<Source> {
  const parent = await db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.id, input.companyId))
    .get();
  if (!parent) throw new ServiceError("not_found", `No such company: ${input.companyId}`);
  validateConfig(input.platform, input.config);
  await ensureBoardFree(db, input.platform, input.board);
  const now = new Date();
  await db.insert(source).values({
    companyId: input.companyId,
    platform: input.platform,
    board: input.board,
    config: input.config,
    includeAll: input.includeAll,
    origin: "manual",
    trial: false,
    disabledReason: null,
    lastFetched: null,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now,
  });
  const rows = await listWhere(
    db,
    and(eq(source.platform, input.platform), eq(source.board, input.board)),
  );
  return toApi(rows[0]);
}

async function listWhere(db: Db, where: SQL | undefined) {
  return db
    .select({
      source,
      company: sourceCompany,
      activeJobs: sql<number>`(select count(*) from ${job} where ${job.sourceId} = ${source.id} and ${job.status} = 'active')`,
    })
    .from(source)
    .innerJoin(company, eq(source.companyId, company.id))
    .where(where);
}

export async function update(db: Db, id: string, patch: SourceUpdate): Promise<Source> {
  const rows = await listWhere(db, eq(source.id, id));
  if (rows.length === 0) throw new ServiceError("not_found", `No such source: ${id}`);
  const current = rows[0].source;
  const board = patch.board ?? current.board;
  const config = patch.config ?? current.config;
  if (patch.config !== undefined || patch.board !== undefined) {
    validateConfig(current.platform, config);
    await ensureBoardFree(db, current.platform, board, id);
  }
  await db
    .update(source)
    .set({ ...patch, board, config, updatedAt: new Date() })
    .where(eq(source.id, id));
  return toApi((await listWhere(db, eq(source.id, id)))[0]);
}

/** Pseudo source row for adapter calls that only read config/board/etc. */
function previewSourceRow(input: SourcePreview): SourceRow {
  const now = new Date();
  return {
    id: "src_preview",
    companyId: "cmp_preview",
    platform: input.platform,
    board: input.board,
    config: input.config,
    includeAll: input.includeAll,
    origin: "manual",
    trial: false,
    disabledReason: null,
    lastFetched: null,
    enabled: true,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Dry run: fetch + classify exactly like ingest, but no writes. Upstream
 * failures surface as 502 `upstream_failed`.
 */
export async function preview(
  input: SourcePreview,
  fetcher: typeof fetch,
): Promise<SourcePreviewResult["data"]> {
  validateConfig(input.platform, input.config);
  const src = previewSourceRow(input);
  let listings;
  try {
    listings = await adapterFor(input.platform).fetchListings(fetcher, src);
  } catch (e) {
    const message = e instanceof Error ? e.message : "fetch failed";
    throw new ServiceError("upstream_failed", `Upstream fetch failed: ${message}`);
  }
  const kept = listings
    .filter((l) => !isExcluded(l.title))
    .map((l) => ({
      listing: l,
      level: classifyLevel(l.title, l.employmentTypeHint) ?? (input.includeAll ? "graduate" : null),
    }))
    .filter((l) => l.level !== null);
  return {
    fetched: listings.length,
    kept: kept.length,
    sample: kept.slice(0, 10).map(({ listing, level }) => ({
      title: listing.title,
      level,
      locationRaw: listing.locationRaw,
      countryCode: parseLocation(listing.locationRaw, listing.countryHint, listing.workplaceHint)
        .countryCode,
    })),
  };
}
