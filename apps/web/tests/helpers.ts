import { env, applyD1Migrations } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { company, ingestRun, job, source, sourceRun } from "../schema/db";
import app from "../worker/index";

// The hand-maintained migrations (drizzle-kit generate is/was broken — see
// migrations/README.md) are applied exactly as alchemy applies them, proving
// they work unmodified.
let migrated = false;
export async function migrate() {
  if (migrated) return;
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS!);
  migrated = true;
}

/** OWNER_ADMIN_EMAIL in vitest.wrangler.jsonc. */
export const OWNER = "owner@example.com";

/**
 * Call the real Hono app through its `fetch` with a fake ExecutionContext
 * carrying a simulated `ctx.access` — the seam `requireOwner` reads
 * (`null` identity = a request that bypassed Access entirely).
 */
export function accessFetch(path: string, init: RequestInit = {}, email: string | null = OWNER) {
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
    access: email ? { aud: "test", getIdentity: async () => ({ email }) } : undefined,
  };
  return app.fetch(new Request(`https://x${path}`, init), env as never, ctx as never);
}

/** A request that bypassed Cloudflare Access — no ctx.access at all. */
export const anonFetch = (path: string, init?: RequestInit) => accessFetch(path, init, null);

// ---------------------------------------------------------------------------
// Seed helpers for the ingest-dashboard tables (real D1, no fixtures).
// ---------------------------------------------------------------------------

function db() {
  return drizzle(env.DB);
}

export async function seedCompany(input: Partial<typeof company.$inferInsert> = {}) {
  const now = new Date();
  const id = `cmp_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db()
    .insert(company)
    .values({
      id,
      name: input.name ?? "Acme",
      slug: input.slug ?? id,
      homepageUrl: input.homepageUrl ?? null,
      logoUrl: input.logoUrl ?? null,
      createdAt: now,
      updatedAt: now,
    });
  return { id, name: input.name ?? "Acme" };
}

export async function seedSource(
  companyId: string,
  input: Partial<typeof source.$inferInsert> = {},
) {
  const now = new Date();
  const id = `src_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db()
    .insert(source)
    .values({
      id,
      companyId,
      platform: input.platform ?? "greenhouse",
      board: input.board ?? `board-${id.slice(-6)}`,
      config: input.config ?? "{}",
      includeAll: input.includeAll ?? false,
      enabled: input.enabled ?? true,
      lastRunAt: input.lastRunAt ?? null,
      lastStatus: input.lastStatus ?? null,
      lastError: input.lastError ?? null,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

export async function seedJob(
  sourceId: string,
  companyId: string,
  input: Partial<typeof job.$inferInsert> = {},
) {
  const now = new Date();
  const id = `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db()
    .insert(job)
    .values({
      id,
      sourceId,
      companyId,
      externalId: input.externalId ?? id,
      slug: input.slug ?? id,
      title: input.title ?? "Software Engineer Intern",
      contentHash: input.contentHash ?? `hash_${id}`,
      level: input.level ?? "internship",
      employmentType: input.employmentType ?? null,
      workplace: input.workplace ?? null,
      locationRaw: input.locationRaw ?? "Austin, TX, United States",
      city: input.city ?? null,
      region: input.region ?? null,
      countryCode: input.countryCode ?? null,
      descriptionHtml: input.descriptionHtml ?? null,
      descriptionText: input.descriptionText ?? "desc",
      applyUrl: input.applyUrl ?? "https://example.com/apply",
      postedAt: input.postedAt ?? null,
      sourceUpdatedAt: input.sourceUpdatedAt ?? null,
      validThrough: input.validThrough ?? null,
      status: input.status ?? "active",
      retiredAt: input.retiredAt ?? null,
      retireReason: input.retireReason ?? null,
      firstSeenAt: input.firstSeenAt ?? now,
      lastSeenAt: input.lastSeenAt ?? now,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

export async function seedRun(input: Partial<typeof ingestRun.$inferInsert> = {}) {
  const id = `run_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db()
    .insert(ingestRun)
    .values({
      id,
      trigger: input.trigger ?? "schedule",
      workflowInstanceId: input.workflowInstanceId ?? id,
      status: input.status ?? "succeeded",
      startedAt: input.startedAt ?? new Date(),
      finishedAt: input.finishedAt ?? new Date(),
      fetched: input.fetched ?? 0,
      inserted: input.inserted ?? 0,
      updated: input.updated ?? 0,
      reactivated: input.reactivated ?? 0,
      retired: input.retired ?? 0,
      error: input.error ?? null,
    });
  return id;
}

export async function seedSourceRun(
  runId: string,
  sourceId: string,
  input: Partial<typeof sourceRun.$inferInsert> = {},
) {
  const now = new Date();
  await db()
    .insert(sourceRun)
    .values({
      runId,
      sourceId,
      status: input.status ?? "succeeded",
      fetched: input.fetched ?? 0,
      kept: input.kept ?? 0,
      inserted: input.inserted ?? 0,
      updated: input.updated ?? 0,
      reactivated: input.reactivated ?? 0,
      retired: input.retired ?? 0,
      error: input.error ?? null,
      startedAt: input.startedAt ?? now,
      finishedAt: input.finishedAt ?? now,
    });
}
