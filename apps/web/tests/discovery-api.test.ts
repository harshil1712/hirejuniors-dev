/// <reference types="@cloudflare/vitest-plugin/types" />
import { SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vite-plus/test";
import {
  migrate,
  verifiedSessionCookie,
  adminSessionCookie,
  seedCompany,
  seedSource,
  seedJob,
} from "./helpers";

interface ReqBody {
  domains?: string[];
  level?: string;
}
function req(cookie: string, method: string, path: string, body?: ReqBody) {
  const headers = new Headers({ cookie });
  if (body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`https://x${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

let admin: string;
let member: string;
beforeAll(async () => {
  await migrate();
  admin = await adminSessionCookie(`dscadmin-${crypto.randomUUID()}@t.dev`);
  member = await verifiedSessionCookie(`dscmember-${crypto.randomUUID()}@t.dev`);
});

describe("discovery api", () => {
  it("admin-only: member session gets 403 on both routes", async () => {
    expect((await req(member, "GET", "/api/discovery")).status).toBe(403);
    expect((await req(member, "POST", "/api/discovery", { domains: ["a.com"] })).status).toBe(403);
  });

  it("POST validates hostnames and caps at 500", async () => {
    expect(
      (await req(admin, "POST", "/api/discovery", { domains: ["not a domain!"] })).status,
    ).toBe(400);
    expect(
      (
        await req(admin, "POST", "/api/discovery", {
          domains: Array.from({ length: 501 }, (_, i) => `d${i}.com`),
        })
      ).status,
    ).toBe(400);
  });

  it("POST queues normalized unique domains; GET lists them", async () => {
    const r = await req(admin, "POST", "/api/discovery", {
      domains: ["Stripe.com", "FIGMA.com"],
    });
    expect(r.status).toBe(200);
    const { data } = (await r.json()) as { data: { added: number } };
    expect(data.added).toBe(2);
    const list = (await (await req(admin, "GET", "/api/discovery")).json()) as {
      data: { input: string; origin: string; status: string }[];
    };
    const inputs = list.data.map((c) => c.input);
    expect(inputs).toContain("stripe.com");
    expect(inputs).toContain("figma.com");
    expect(list.data[0].origin).toBe("manual");
    expect(list.data[0].status).toBe("queued");
  });

  it("POST accepts board URLs — ashby URL → ashby:Notion, domain → bare host", async () => {
    const r = await req(admin, "POST", "/api/discovery", {
      domains: ["https://jobs.ashbyhq.com/Notion/abc", "stripe.com"],
    });
    expect(r.status).toBe(200);
    const list = (await (await req(admin, "GET", "/api/discovery")).json()) as {
      data: { input: string }[];
    };
    const inputs = list.data.map((c) => c.input);
    expect(inputs).toContain("ashby:Notion");
    expect(inputs).toContain("stripe.com");
  });
});

describe("jobs approve/reject", () => {
  it("approve review → active with chosen level, classified_by=admin", async () => {
    const c = await seedCompany({ name: "ApprCo" });
    const s = await seedSource(c.id, { board: "apprco" });
    const id = await seedJob(s, c.id, { status: "review", level: null });
    const r = await req(admin, "POST", `/api/jobs/${id}/approve`, { level: "junior" });
    expect(r.status).toBe(200);
    const { data } = (await r.json()) as {
      data: { status: string; level: string; classifiedBy: string };
    };
    expect(data.status).toBe("active");
    expect(data.level).toBe("junior");
    expect(data.classifiedBy).toBe("admin");
  });

  it("reject → rejected/admin (sticky)", async () => {
    const c = await seedCompany({ name: "RejCo" });
    const s = await seedSource(c.id, { board: "rejco" });
    const id = await seedJob(s, c.id, { status: "pending" });
    const r = await req(admin, "POST", `/api/jobs/${id}/reject`);
    expect(r.status).toBe(200);
    const { data } = (await r.json()) as { data: { status: string; rejectReason: string } };
    expect(data.status).toBe("rejected");
    expect(data.rejectReason).toBe("admin");
  });

  it("approve requires a valid level", async () => {
    const c = await seedCompany({ name: "LvlCo" });
    const s = await seedSource(c.id, { board: "lvlco" });
    const id = await seedJob(s, c.id, { status: "review", level: null });
    expect((await req(admin, "POST", `/api/jobs/${id}/approve`, { level: "senior" })).status).toBe(
      400,
    );
  });
});
