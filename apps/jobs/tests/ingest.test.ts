import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { job, source, sourceRun } from "@hirejuniors/db/schema";
import { ingestSource, recordSourceFailure, startRun, upsertListings } from "../src/ingest";
import { db, listing, migrate, seedCompany, seedSource } from "./helpers";

beforeAll(async () => {
  await migrate();
  await seedCompany();
});

const jobsOf = (sourceId: string) => db().select().from(job).where(eq(job.sourceId, sourceId));

describe("upsertListings", () => {
  it("inserts with slug + first_seen_at", async () => {
    const src = await seedSource({ id: "src_insert00001" });
    const counts = await upsertListings(db(), src, "testco", [listing()]);
    expect(counts).toMatchObject({ fetched: 1, kept: 1, inserted: 1 });
    const [j] = await jobsOf(src.id);
    expect(j.slug).toMatch(/^graduate-engineer-\d+-testco-[a-z0-9]{6}$/);
    expect(j.firstSeenAt).toBeInstanceOf(Date);
    expect(j.status).toBe("active");
    expect(j.level).toBe("graduate");
  });

  it("re-ingest with a changed title keeps the slug", async () => {
    const src = await seedSource({ id: "src_reslug00001" });
    await upsertListings(db(), src, "testco", [listing({ externalId: "e1" })]);
    const [before] = await jobsOf(src.id);
    await upsertListings(db(), src, "testco", [
      listing({ externalId: "e1", title: "Renamed Graduate Engineer" }),
    ]);
    const [after] = await jobsOf(src.id);
    expect(after.slug).toBe(before.slug);
    expect(after.title).toBe("Renamed Graduate Engineer");
  });

  it("feed diff: missing once → missed_runs 1; twice → retired", async () => {
    const src = await seedSource({ id: "src_diff0000001" });
    await upsertListings(db(), src, "testco", [listing({ externalId: "gone" })]);
    await upsertListings(db(), src, "testco", []);
    let [j] = await jobsOf(src.id);
    expect(j.missedRuns).toBe(1);
    expect(j.status).toBe("active");
    await upsertListings(db(), src, "testco", []);
    [j] = await jobsOf(src.id);
    expect(j.missedRuns).toBe(2);
    expect(j.status).toBe("retired");
    expect(j.retireReason).toBe("missing_from_feed");
  });

  it("reappearing job is reactivated with missed_runs 0", async () => {
    const src = await seedSource({ id: "src_react0000001" });
    await upsertListings(db(), src, "testco", [listing({ externalId: "boomerang" })]);
    await upsertListings(db(), src, "testco", []);
    await upsertListings(db(), src, "testco", [listing({ externalId: "boomerang" })]);
    const [j] = await jobsOf(src.id);
    expect(j.status).toBe("active");
    expect(j.missedRuns).toBe(0);
    expect(j.retireReason).toBeNull();
  });

  it("manual retiree is not reactivated", async () => {
    const src = await seedSource({ id: "src_manual000001" });
    await upsertListings(db(), src, "testco", [listing({ externalId: "m1" })]);
    await db()
      .update(job)
      .set({ status: "retired", retireReason: "manual", retiredAt: new Date() })
      .where(eq(job.sourceId, src.id));
    const counts = await upsertListings(db(), src, "testco", [listing({ externalId: "m1" })]);
    expect(counts.reactivated).toBe(0);
    const [j] = await jobsOf(src.id);
    expect(j.status).toBe("retired");
    expect(j.retireReason).toBe("manual");
  });

  it("non-junior titles are dropped unless include_all; exclusions always drop", async () => {
    const strict = await seedSource({ id: "src_strict00001" });
    await upsertListings(db(), strict, "testco", [
      listing({ externalId: "s1", title: "Software Engineer" }),
    ]);
    expect(await jobsOf(strict.id)).toHaveLength(0);

    const all = await seedSource({ id: "src_inclall00001", includeAll: true });
    const counts = await upsertListings(db(), all, "testco", [
      listing({ externalId: "a1", title: "Software Engineer" }),
      listing({ externalId: "a2", title: "Senior Software Engineer" }),
    ]);
    expect(counts.kept).toBe(1);
    const [j] = await jobsOf(all.id);
    expect(j.title).toBe("Software Engineer");
    expect(j.level).toBe("graduate");
  });

  it("duplicate externalId in one feed: first wins, one row", async () => {
    const src = await seedSource({ id: "src_dedupe00001" });
    const counts = await upsertListings(db(), src, "testco", [
      listing({ externalId: "dup", title: "Intern A" }),
      listing({ externalId: "dup", title: "Intern B" }),
    ]);
    expect(counts.kept).toBe(1);
    expect(counts.inserted).toBe(1);
    const rows = await jobsOf(src.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Intern A");
  });

  it("employmentType INTERN keeps an unmatched title as internship", async () => {
    const src = await seedSource({ id: "src_intern00001" });
    await upsertListings(db(), src, "testco", [
      listing({ externalId: "i1", title: "Software Engineer", employmentTypeHint: "INTERN" }),
    ]);
    const [j] = await jobsOf(src.id);
    expect(j.level).toBe("internship");
  });

  it("batches 120 listings for one source under the param limit", async () => {
    const src = await seedSource({ id: "src_batch000001" });
    const listings = Array.from({ length: 120 }, (_, i) =>
      listing({ externalId: `bulk-${i}`, title: `Intern ${i}` }),
    );
    const counts = await upsertListings(db(), src, "testco", listings);
    expect(counts.inserted).toBe(120);
    expect(await jobsOf(src.id)).toHaveLength(120);
  });
});

describe("ingestSource failure handling", () => {
  it("failed fetch leaves jobs untouched, records source_run + last_error", async () => {
    await seedCompany({ id: "cmp_fail0000001", slug: "failco" });
    const src = await seedSource({
      id: "src_fail0000001",
      companyId: "cmp_fail0000001",
      platform: "lever",
      board: "failco",
    });
    await upsertListings(db(), src, "failco", [listing({ externalId: "keep" })]);
    const [before] = await jobsOf(src.id);

    const runId = await startRun(db(), "schedule", "wf-test-1");
    const failing = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    await expect(ingestSource(db(), runId, src.id, failing)).rejects.toThrow();
    await recordSourceFailure(db(), runId, src.id, new Error("lever 500"));

    const [after] = await jobsOf(src.id);
    expect(after.status).toBe("active");
    expect(after.missedRuns).toBe(before.missedRuns);

    const runs = await db().select().from(sourceRun).where(eq(sourceRun.sourceId, src.id));
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error).toBe("lever 500");

    const [s] = await db().select().from(source).where(eq(source.id, src.id));
    expect(s.lastStatus).toBe("failed");
    expect(s.lastError).toBe("lever 500");
  });
});
