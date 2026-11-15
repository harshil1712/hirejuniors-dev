import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { expect } from "vite-plus/test";
import { company, ingestRun, job, source, sourceRun, user } from "../schema/db";

// The hand-maintained migrations (drizzle-kit generate is/was broken — see
// migrations/README.md) are applied exactly as alchemy applies them, proving
// they work unmodified.
let migrated = false;
export async function migrate() {
  if (migrated) return;
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS!);
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS sent_email (to_addr text, subject text, text text, html text)",
  );
  migrated = true;
}

export const PASSWORD = "test-password-123";

export async function signUp(email: string, captchaToken = "test-token") {
  return SELF.fetch("https://x/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", "x-captcha-response": captchaToken },
    body: JSON.stringify({ name: "T", email, password: PASSWORD }),
  });
}

export async function verifyLatest(email: string) {
  // Pull the verification URL out of the email the sink captured.
  const row = await env.DB.prepare(
    "SELECT text FROM sent_email WHERE to_addr = ? ORDER BY rowid DESC LIMIT 1",
  )
    .bind(email)
    .first<{ text: string }>();
  const url = row?.text.match(/https?:\/\/\S+/)?.[0];
  expect(url).toBeTruthy();
  // redirect:manual — the session cookie lives on the 302, not the target.
  return SELF.fetch(url!, { redirect: "manual" });
}

/** Sign up, verify, and return the session cookie header value. */
export async function verifiedSessionCookie(email: string) {
  await signUp(email);
  const v = await verifyLatest(email);
  return v.headers.get("set-cookie") ?? "";
}

/** A verified session whose user carries the Better Auth admin role —
 * required by every dashboard route (the dashboard is admin-only). */
export async function adminSessionCookie(email: string) {
  const cookie = await verifiedSessionCookie(email);
  await drizzle(env.DB).update(user).set({ role: "admin" }).where(eq(user.email, email));
  return cookie;
}

/** Create an API key for a verified user session; returns the plaintext key. */
export async function makeKey(cookie: string, scopes: string[], name = "t") {
  const r = await SELF.fetch("https://x/api/api-keys", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name, scopes, expiresInDays: 30 }),
  });
  expect(r.status).toBe(201);
  return (await r.json<{ data: { key: string } }>()).data.key;
}

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
      missedRuns: input.missedRuns ?? 0,
      firstSeenAt: input.firstSeenAt ?? now,
      lastSeenAt: input.lastSeenAt ?? now,
      lastCheckedAt: input.lastCheckedAt ?? null,
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
