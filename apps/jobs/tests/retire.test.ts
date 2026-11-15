import { describe, expect, it, beforeAll } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { job } from "@hirejuniors/db/schema";
import { expireJobs } from "../src/retire";
import { db, migrate, seedCompany, seedSource } from "./helpers";

beforeAll(migrate);

async function insertJob(over: Partial<typeof job.$inferInsert> = {}) {
  const now = new Date();
  const id = `job_${Math.random().toString(36).slice(2, 14)}`;
  await db()
    .insert(job)
    .values({
      id,
      slug: id,
      externalId: `ext-${id}`,
      sourceId: "src_retire01",
      companyId: "cmp_retire01",
      title: "Junior Engineer",
      locationRaw: "Austin, TX",
      descriptionText: "text",
      applyUrl: `https://example.com/${id}`,
      contentHash: `h-${id}`,
      status: "active",
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
      ...over,
    });
  return id;
}
async function getJob(id: string) {
  return (await db().select().from(job).where(eq(job.id, id)))[0];
}

describe("expireJobs", () => {
  it("retires active jobs past validThrough", async () => {
    await seedCompany({ id: "cmp_retire01", slug: "retco", name: "Ret Co" });
    await seedSource({ id: "src_retire01", companyId: "cmp_retire01", board: "retco" });
    const expired = await insertJob({ validThrough: new Date(Date.now() - 86400000) });
    const fresh = await insertJob({ validThrough: new Date(Date.now() + 86400000) });
    const n = await expireJobs(db());
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await getJob(expired)).status).toBe("retired");
    expect((await getJob(expired)).retireReason).toBe("expired");
    expect((await getJob(fresh)).status).toBe("active");
  });
});

describe("expireJobs — no age rule (spec §Expiry)", () => {
  it("old posted_at alone does NOT expire", async () => {
    const old = await insertJob({
      postedAt: new Date(Date.now() - 200 * 86400000),
      firstSeenAt: new Date(Date.now() - 200 * 86400000),
      validThrough: null,
    });
    await expireJobs(db());
    expect((await getJob(old)).status).toBe("active");
  });
});
