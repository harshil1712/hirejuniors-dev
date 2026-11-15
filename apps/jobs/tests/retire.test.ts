import { describe, expect, it, beforeAll } from "vite-plus/test";
import { eq, inArray } from "drizzle-orm";
import { job } from "@hirejuniors/db/schema";
import { expireJobs, linkCheckSlice } from "../src/retire";
import type { AiModels } from "../src/ai";
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

const BIG_PAGE = `<html><body>${"open role content ".repeat(40)}</body></html>`;

function fetcher(routes: Record<string, Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    for (const [key, res] of Object.entries(routes)) {
      if (url.includes(key)) return res.clone();
    }
    return new Response(BIG_PAGE, { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
}
function ai(noulP: number): AiModels {
  return {
    async decide() {
      return {
        answers: { open: { type: "noul", noul: noulP } },
        inputTokens: 5,
      };
    },
    async extract() {
      return { answers: {}, inputTokens: 0 };
    },
  };
}
const noAi: AiModels = {
  decide: () => Promise.reject(new Error("ai must not be called")),
  extract: () => Promise.reject(new Error("ai must not be called")),
};

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

describe("linkCheckSlice", () => {
  it("404 after redirect → link_dead", async () => {
    const id = await insertJob({ applyUrl: "https://x.test/gone" });
    const res = await linkCheckSlice(
      db(),
      fetcher({ gone: new Response(null, { status: 404 }) }),
      noAi,
      [id],
    );
    expect(res.linkDead).toBe(1);
    const j = await getJob(id);
    expect(j.status).toBe("retired");
    expect(j.retireReason).toBe("link_dead");
  });

  it("text under 200 chars → stamped, no AI call", async () => {
    const id = await insertJob({ applyUrl: "https://x.test/short" });
    const res = await linkCheckSlice(
      db(),
      fetcher({
        short: new Response("<html><body>ok</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      }),
      noAi,
      [id],
    );
    expect(res.checked).toBe(1);
    const j = await getJob(id);
    expect(j.status).toBe("active");
    expect(j.lastCheckedAt).not.toBeNull();
  });

  it("noul ≤ 0.15 → closed_page", async () => {
    // 1 of 4 = 25%, not >25% — breaker stays off.
    const closed = await insertJob({ applyUrl: "https://x.test/closedpage" });
    const others = await Promise.all(
      [1, 2, 3].map((i) => insertJob({ applyUrl: `https://x.test/shorty${i}` })),
    );
    const res = await linkCheckSlice(
      db(),
      fetcher({
        shorty: new Response("<html><body>ok</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      }),
      ai(0.1),
      [closed, ...others],
    );
    expect(res.closedPage).toBe(1);
    expect(res.breakerTripped).toBe(false);
    const j = await getJob(closed);
    expect(j.status).toBe("retired");
    expect(j.retireReason).toBe("closed_page");
    for (const id of others) expect((await getJob(id)).status).toBe("active");
  });

  it("noul = 0.5 → stamped only", async () => {
    const id = await insertJob({ applyUrl: "https://x.test/open" });
    await linkCheckSlice(db(), fetcher({}), ai(0.5), [id]);
    const j = await getJob(id);
    expect(j.status).toBe("active");
    expect(j.lastCheckedAt).not.toBeNull();
  });

  it("breaker: >25% closed_page → none retire closed_page; link_dead still applies", async () => {
    const ids = await Promise.all(
      [1, 2, 3, 4].map((i) => insertJob({ applyUrl: `https://x.test/cb${i}` })),
    );
    const dead = await insertJob({ applyUrl: "https://x.test/dead" });
    // 5 closed_page-worthy jobs: add one more
    const ids5 = [...ids, await insertJob({ applyUrl: "https://x.test/cb5" })];
    const res = await linkCheckSlice(
      db(),
      fetcher({ dead: new Response(null, { status: 404 }) }),
      ai(0.05),
      [...ids5, dead],
    );
    expect(res.breakerTripped).toBe(true);
    for (const id of ids5) {
      const j = await getJob(id);
      expect(j.status).toBe("active");
      expect(j.lastCheckedAt).not.toBeNull();
    }
    expect((await getJob(dead)).retireReason).toBe("link_dead");
  });

  it("model error → untouched", async () => {
    const id = await insertJob({ applyUrl: "https://x.test/err" });
    const res = await linkCheckSlice(db(), fetcher({}), noAi, [id]);
    expect(res.checked).toBe(1);
    const j = await getJob(id);
    expect(j.status).toBe("active");
    expect(j.lastCheckedAt).toBeNull();
  });
});
