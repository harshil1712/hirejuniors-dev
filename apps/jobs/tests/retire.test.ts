import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { job } from "@hirejuniors/db/schema";
import { jobsForLinkCheck } from "@hirejuniors/db/queries";
import { expireJobs, linkCheckSlice } from "../src/retire";
import { db, listing, migrate, seedCompany, seedSource } from "./helpers";
import { upsertListings } from "../src/ingest";

beforeAll(async () => {
  await migrate();
  await seedCompany();
});

const DAY = 24 * 60 * 60 * 1000;

describe("expireJobs", () => {
  it("retires 91-day-old posted_at and past valid_through", async () => {
    const src = await seedSource({ id: "src_expire00001" });
    const now = new Date();
    const old = new Date(now.getTime() - 91 * DAY);
    await upsertListings(db(), src, "testco", [
      listing({ externalId: "old", postedAt: old }),
      listing({ externalId: "fresh", postedAt: new Date(now.getTime() - 30 * DAY) }),
      listing({ externalId: "through" }),
    ]);
    await db()
      .update(job)
      .set({ validThrough: new Date(now.getTime() - DAY) })
      .where(eq(job.externalId, "through"));

    const n = await expireJobs(db(), now);
    expect(n).toBe(2);
    const rows = await db().select().from(job).where(eq(job.sourceId, src.id));
    const byExt = Object.fromEntries(rows.map((r) => [r.externalId, r]));
    expect(byExt.old.status).toBe("retired");
    expect(byExt.old.retireReason).toBe("expired");
    expect(byExt.through.retireReason).toBe("expired");
    expect(byExt.fresh.status).toBe("active");
  });
});

describe("linkCheckSlice", () => {
  it("404/410 retires link_dead; 200/301 stamp last_checked_at; thrown fetch untouched", async () => {
    const src = await seedSource({ id: "src_linkck00001" });
    await upsertListings(db(), src, "testco", [
      listing({ externalId: "dead", applyUrl: "https://x/dead" }),
      listing({ externalId: "gone", applyUrl: "https://x/gone" }),
      listing({ externalId: "ok", applyUrl: "https://x/ok" }),
      listing({ externalId: "moved", applyUrl: "https://x/moved" }),
      listing({ externalId: "net", applyUrl: "https://x/net" }),
    ]);
    const statuses = new Map([
      ["dead", 404],
      ["gone", 410],
      ["ok", 200],
      ["moved", 301],
    ]);
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      if (url.endsWith("/net")) throw new Error("network down");
      const status = statuses.get(url.split("/").pop()!) ?? 200;
      return new Response("", { status });
    }) as typeof fetch;

    const ids = (await jobsForLinkCheck(db(), 400)).map((j) => j.id);
    await linkCheckSlice(db(), fetcher, ids);

    const rows = await db().select().from(job).where(eq(job.sourceId, src.id));
    const byExt = Object.fromEntries(rows.map((r) => [r.externalId, r]));
    expect(byExt.dead.status).toBe("retired");
    expect(byExt.dead.retireReason).toBe("link_dead");
    expect(byExt.gone.retireReason).toBe("link_dead");
    expect(byExt.ok.status).toBe("active");
    expect(byExt.ok.lastCheckedAt).toBeInstanceOf(Date);
    expect(byExt.moved.status).toBe("active");
    expect(byExt.moved.lastCheckedAt).toBeInstanceOf(Date);
    expect(byExt.net.status).toBe("active");
    expect(byExt.net.lastCheckedAt).toBeNull();
  });

  it("pagination: slices cover distinct jobs — slice 2 doesn't skip unchecked rows", async () => {
    const src = await seedSource({ id: "src_linkpage001" });
    // Other sources' active jobs are excluded by filtering on this source's ids.
    await upsertListings(
      db(),
      src,
      "testco",
      Array.from({ length: 90 }, (_, i) =>
        listing({ externalId: `p-${i}`, applyUrl: `https://x/p-${i}` }),
      ),
    );
    const ok = (async () => new Response("", { status: 200 })) as typeof fetch;

    const allIds = (await jobsForLinkCheck(db(), 400)).map((j) => j.id);
    const rows = await db().select({ id: job.id }).from(job).where(eq(job.sourceId, src.id));
    const ourIds = allIds.filter((id) => rows.some((r) => r.id === id));
    expect(ourIds).toHaveLength(90);

    await linkCheckSlice(db(), ok, ourIds.slice(0, 40));
    await linkCheckSlice(db(), ok, ourIds.slice(40, 80));

    const after = await db().select().from(job).where(eq(job.sourceId, src.id));
    const checked = after.filter((j) => j.lastCheckedAt !== null).map((j) => j.id);
    expect(new Set(checked)).toEqual(new Set(ourIds.slice(0, 80)));
    const unchecked = after.filter((j) => j.lastCheckedAt === null).map((j) => j.id);
    expect(new Set(unchecked)).toEqual(new Set(ourIds.slice(80)));
  });
});
