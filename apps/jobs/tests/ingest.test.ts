import { describe, expect, it, beforeAll } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { job } from "@hirejuniors/db/schema";
import { ingestSource, upsertListings } from "../src/ingest";
import { trialEval } from "../src/discover";
import { db, listing, migrate, seedCompany, seedSource } from "./helpers";

beforeAll(migrate);

async function jobsFor(sourceId: string) {
  return db().select().from(job).where(eq(job.sourceId, sourceId));
}
function fakeFetcher(listings: object[]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(listings ?? []), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("upsertListings", () => {
  it("inserts new listings as pending", async () => {
    await seedCompany({ id: "cmp_ing01", slug: "ingco", name: "Ing Co" });
    const src = await seedSource({ id: "src_ing01", companyId: "cmp_ing01", board: "ingco" });
    const counts = await upsertListings(db(), src, "ingco", [listing()]);
    expect(counts.inserted).toBe(1);
    const [j] = await jobsFor("src_ing01");
    expect(j.status).toBe("pending");
    expect(j.contentHash).toBeTruthy();
  });

  it("title gate: non-include_all drops signal-less titles; include_all keeps both", async () => {
    const src = await seedSource({ id: "src_gate01", companyId: "cmp_ing01", board: "gate1" });
    const counts = await upsertListings(db(), src, "ingco", [
      listing({ externalId: "plain", title: "Software Engineer" }),
      listing({ externalId: "early", title: "Software Engineer Intern" }),
    ]);
    expect(counts.inserted).toBe(1);
    const rows = await jobsFor("src_gate01");
    expect(rows.map((r) => r.title)).toEqual(["Software Engineer Intern"]);

    const allSrc = await seedSource({
      id: "src_gate02",
      companyId: "cmp_ing01",
      board: "gate2",
      includeAll: true,
    });
    const c2 = await upsertListings(db(), allSrc, "ingco", [
      listing({ externalId: "plain2", title: "Software Engineer" }),
      listing({ externalId: "early2", title: "Software Engineer Intern" }),
    ]);
    expect(c2.inserted).toBe(2);
  });

  it("drops excluded titles; intern exception survives", async () => {
    const src = await seedSource({ id: "src_ing02", companyId: "cmp_ing01", board: "ingco2" });
    const counts = await upsertListings(db(), src, "ingco", [
      listing({ externalId: "a", title: "Senior Staff Engineer" }),
      listing({ externalId: "b", title: "Sales Lead Intern" }),
    ]);
    expect(counts.inserted).toBe(1);
    const rows = await jobsFor("src_ing02");
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Sales Lead Intern");
  });

  it("same hash → classification columns untouched", async () => {
    const src = await seedSource({ id: "src_ing03", companyId: "cmp_ing01", board: "ingco3" });
    const l = listing({ externalId: "same" });
    await upsertListings(db(), src, "ingco", [l]);
    await db()
      .update(job)
      .set({ status: "active", level: "junior", classifiedBy: "clef", classifiedAt: new Date() })
      .where(eq(job.sourceId, "src_ing03"));
    await upsertListings(db(), src, "ingco", [l]);
    const [j] = await jobsFor("src_ing03");
    expect(j.status).toBe("active");
    expect(j.classifiedBy).toBe("clef");
  });

  it("changed hash: pending/review/rejected → pending", async () => {
    const src = await seedSource({ id: "src_ing04", companyId: "cmp_ing01", board: "ingco4" });
    const l = listing({ externalId: "chg" });
    await upsertListings(db(), src, "ingco", [l]);
    await db()
      .update(job)
      .set({ status: "rejected", rejectReason: "not_tech", classifiedBy: "clef" })
      .where(eq(job.sourceId, "src_ing04"));
    await upsertListings(db(), src, "ingco", [
      { ...l, descriptionHtml: "<p>totally different description</p>" },
    ]);
    const [j] = await jobsFor("src_ing04");
    expect(j.status).toBe("pending");
    expect(j.classifiedAt).toBeNull();
  });

  it("changed hash on active stays active with classified_at null", async () => {
    const src = await seedSource({ id: "src_ing05", companyId: "cmp_ing01", board: "ingco5" });
    const l = listing({ externalId: "act" });
    await upsertListings(db(), src, "ingco", [l]);
    await db()
      .update(job)
      .set({ status: "active", level: "junior", classifiedBy: "clef", classifiedAt: new Date() })
      .where(eq(job.sourceId, "src_ing05"));
    await upsertListings(db(), src, "ingco", [{ ...l, descriptionHtml: "<p>changed</p>" }]);
    const [j] = await jobsFor("src_ing05");
    expect(j.status).toBe("active");
    expect(j.classifiedAt).toBeNull();
  });

  it("admin-decided rows are sticky", async () => {
    const src = await seedSource({ id: "src_ing06", companyId: "cmp_ing01", board: "ingco6" });
    const l = listing({ externalId: "adm" });
    await upsertListings(db(), src, "ingco", [l]);
    await db()
      .update(job)
      .set({ status: "active", classifiedBy: "admin", classifiedAt: new Date(), level: "junior" })
      .where(eq(job.sourceId, "src_ing06"));
    await upsertListings(db(), src, "ingco", [{ ...l, descriptionHtml: "<p>changed</p>" }]);
    const [j] = await jobsFor("src_ing06");
    expect(j.status).toBe("active");
    expect(j.classifiedAt).not.toBeNull();
    expect(j.classifiedBy).toBe("admin");
  });

  it("manual retirement is sticky — reappearing listing stays retired", async () => {
    const src = await seedSource({ id: "src_ing07", companyId: "cmp_ing01", board: "ingco7" });
    const l = listing({ externalId: "man" });
    await upsertListings(db(), src, "ingco", [l]);
    await db()
      .update(job)
      .set({ status: "retired", retireReason: "manual", retiredAt: new Date() })
      .where(eq(job.sourceId, "src_ing07"));
    await upsertListings(db(), src, "ingco", [l]);
    const [j] = await jobsFor("src_ing07");
    expect(j.status).toBe("retired");
    expect(j.retireReason).toBe("manual");
  });
});

describe("feed diff", () => {
  it("missing active/review retires after 1 miss; pending/rejected too", async () => {
    const src = await seedSource({ id: "src_diff01", companyId: "cmp_ing01", board: "diff1" });
    await upsertListings(db(), src, "ingco", [
      listing({ externalId: "keep" }),
      listing({ externalId: "gone-active" }),
      listing({ externalId: "gone-pending" }),
    ]);
    await db().update(job).set({ status: "active" }).where(eq(job.externalId, "gone-active"));
    const counts = await upsertListings(db(), src, "ingco", [listing({ externalId: "keep" })]);
    expect(counts.retired).toBe(2);
    const rows = await jobsFor("src_diff01");
    const gone = rows.filter((r) => r.externalId !== "keep");
    expect(
      gone.every((r) => r.status === "retired" && r.retireReason === "missing_from_feed"),
    ).toBe(true);
  });
});

describe("shrink guard (ingestSource)", () => {
  it("<20% of last_fetched≥10 → failure, no diff", async () => {
    const src = await seedSource({
      id: "src_shrink01",
      companyId: "cmp_ing01",
      board: "shrink1",
      lastFetched: 20,
    });
    // lever adapter fetchListings hits jobs.lever.co/{board}?mode=json
    const fetcher = fakeFetcher([
      { id: "l1", text: "Graduate Eng", hostedUrl: "https://x", categories: {} },
    ]);
    await expect(ingestSource(db(), "run_x", src.id, { fetcher })).rejects.toThrow(/shrank/);
  });

  it("0 fetched with active jobs → failure", async () => {
    const src = await seedSource({ id: "src_shrink02", companyId: "cmp_ing01", board: "shrink2" });
    await upsertListings(db(), src, "ingco", [listing({ externalId: "s2" })]);
    await db().update(job).set({ status: "active" }).where(eq(job.sourceId, "src_shrink02"));
    const fetcher = fakeFetcher([]);
    await expect(ingestSource(db(), "run_x", src.id, { fetcher })).rejects.toThrow(/shrank/);
  });
});

describe("trialEval", () => {
  async function trialSource(id: string) {
    return seedSource({ id, companyId: "cmp_ing01", board: id, trial: true });
  }

  it("active/review job → kept (trial false)", async () => {
    const src = await trialSource("src_tr1");
    await upsertListings(db(), src, "ingco", [listing({ externalId: "t1" })]);
    await db().update(job).set({ status: "review" }).where(eq(job.sourceId, "src_tr1"));
    await trialEval(db(), ["src_tr1"]);
    const { source: srcTable } = await import("@hirejuniors/db/schema");
    const [s] = await db().select().from(srcTable).where(eq(srcTable.id, "src_tr1"));
    expect(s.trial).toBe(false);
    expect(s.enabled).toBe(true);
  });

  it("no junior rows → disabled no_junior_roles", async () => {
    const src = await trialSource("src_tr2");
    await upsertListings(db(), src, "ingco", [listing({ externalId: "t2" })]);
    await db()
      .update(job)
      .set({ status: "rejected", rejectReason: "not_early_career" })
      .where(eq(job.sourceId, "src_tr2"));
    await trialEval(db(), ["src_tr2"]);
    const { source: srcTable } = await import("@hirejuniors/db/schema");
    const [s] = await db().select().from(srcTable).where(eq(srcTable.id, "src_tr2"));
    expect(s.enabled).toBe(false);
    expect(s.trial).toBe(false);
    expect(s.disabledReason).toBe("no_junior_roles");
  });

  it("pending jobs (classification cap) → stays in trial", async () => {
    const src = await trialSource("src_tr3");
    await upsertListings(db(), src, "ingco", [listing({ externalId: "t3" })]);
    await trialEval(db(), ["src_tr3"]);
    const { source: srcTable } = await import("@hirejuniors/db/schema");
    const [s] = await db().select().from(srcTable).where(eq(srcTable.id, "src_tr3"));
    expect(s.trial).toBe(true);
    expect(s.enabled).toBe(true);
  });
});

describe("no_junior_roles retry (ingestibleSources)", () => {
  async function loadIds() {
    const { ingestibleSources } = await import("@hirejuniors/db/queries");
    return (await ingestibleSources(db())).map((r) => r.id);
  }
  const DAYS = 24 * 60 * 60 * 1000;

  it("disabled 29d ago → loaded and re-enabled as trial", async () => {
    await seedSource({
      id: "src_retry29",
      companyId: "cmp_ing01",
      board: "retry29",
      enabled: false,
      disabledReason: "no_junior_roles",
      lastRunAt: new Date(Date.now() - 29 * DAYS),
    });
    const ids = await loadIds();
    expect(ids).toContain("src_retry29");
    const { source: srcTable } = await import("@hirejuniors/db/schema");
    const [s] = await db().select().from(srcTable).where(eq(srcTable.id, "src_retry29"));
    expect(s.enabled).toBe(true);
    expect(s.trial).toBe(true);
    expect(s.disabledReason).toBeNull();
  });

  it("disabled 10d ago → not loaded", async () => {
    await seedSource({
      id: "src_retry10",
      companyId: "cmp_ing01",
      board: "retry10",
      enabled: false,
      disabledReason: "no_junior_roles",
      lastRunAt: new Date(Date.now() - 10 * DAYS),
    });
    expect(await loadIds()).not.toContain("src_retry10");
  });

  it("manual disable is never loaded", async () => {
    await seedSource({
      id: "src_retryman",
      companyId: "cmp_ing01",
      board: "retryman",
      enabled: false,
      disabledReason: "manual",
      lastRunAt: new Date(Date.now() - 90 * DAYS),
    });
    expect(await loadIds()).not.toContain("src_retryman");
  });

  it("re-enabled source that yields nothing is disabled again by trialEval", async () => {
    const { source: srcTable } = await import("@hirejuniors/db/schema");
    // src_retry29 is now enabled+trial from the test above; ingest an all-rejected feed
    const src = (await db().select().from(srcTable).where(eq(srcTable.id, "src_retry29")))[0];
    await upsertListings(db(), src, "ingco", [listing({ externalId: "r29" })]);
    await db()
      .update(job)
      .set({ status: "rejected", rejectReason: "not_tech" })
      .where(eq(job.sourceId, "src_retry29"));
    await trialEval(db(), ["src_retry29"]);
    const [s] = await db().select().from(srcTable).where(eq(srcTable.id, "src_retry29"));
    expect(s.enabled).toBe(false);
    expect(s.disabledReason).toBe("no_junior_roles");
  });
});

describe("expired reactivation gate (spec §Expiry)", () => {
  it("expired + past valid_through reappears → stays retired", async () => {
    const src = await seedSource({ id: "src_exp01", companyId: "cmp_ing01", board: "exp1" });
    const l = listing({ externalId: "exp-gone" });
    await upsertListings(db(), src, "ingco", [l]);
    await db()
      .update(job)
      .set({
        status: "retired",
        retireReason: "expired",
        retiredAt: new Date(),
        validThrough: new Date(Date.now() - 24 * 3600 * 1000),
      })
      .where(eq(job.externalId, "exp-gone"));
    const counts = await upsertListings(db(), src, "ingco", [l]);
    expect(counts.reactivated).toBe(0);
    const [j] = await jobsFor("src_exp01");
    expect(j.status).toBe("retired");
    expect(j.retireReason).toBe("expired");
  });

  it("expired + future valid_through reappears → reactivated", async () => {
    const src = await seedSource({ id: "src_exp02", companyId: "cmp_ing01", board: "exp2" });
    const l = listing({ externalId: "exp-back" });
    await upsertListings(db(), src, "ingco", [l]);
    await db()
      .update(job)
      .set({
        status: "retired",
        retireReason: "expired",
        retiredAt: new Date(),
        validThrough: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      })
      .where(eq(job.externalId, "exp-back"));
    const counts = await upsertListings(db(), src, "ingco", [l]);
    expect(counts.reactivated).toBe(1);
    const [j] = await jobsFor("src_exp02");
    expect(j.status).toBe("pending");
  });

  it("expired + null valid_through reappears → reactivated", async () => {
    const src = await seedSource({ id: "src_exp03", companyId: "cmp_ing01", board: "exp3" });
    const l = listing({ externalId: "exp-null" });
    await upsertListings(db(), src, "ingco", [l]);
    await db()
      .update(job)
      .set({
        status: "retired",
        retireReason: "expired",
        retiredAt: new Date(),
        validThrough: null,
      })
      .where(eq(job.externalId, "exp-null"));
    const counts = await upsertListings(db(), src, "ingco", [l]);
    expect(counts.reactivated).toBe(1);
  });
});

describe("content hash — full text, no cap", () => {
  it("hash changes when only text past char 500 changes", async () => {
    const { contentHash } = await import("../src/ingest");
    const head = "<p>same intro</p>";
    const tail = "<p>" + "x".repeat(700) + "TAIL-A</p>";
    const a = await contentHash({ title: "t", locationRaw: "l", descriptionHtml: head + tail });
    const b = await contentHash({
      title: "t",
      locationRaw: "l",
      descriptionHtml: head + tail.replace("TAIL-A", "TAIL-B"),
    });
    expect(a).not.toBe(b);
  });
});
