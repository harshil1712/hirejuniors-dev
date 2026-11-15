/// <reference types="@cloudflare/vitest-plugin/types" />
import { describe, it, expect, beforeAll } from "vite-plus/test";
import { accessFetch, anonFetch, migrate, OWNER } from "./helpers";

describe("worker", () => {
  beforeAll(migrate);

  it("GET /api/health is open and carries security headers", async () => {
    const r = await anonFetch("/api/health");
    expect(r.status).toBe(200);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("strict-transport-security")).toContain("max-age");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(r.headers.get("content-security-policy")).not.toContain("challenges.cloudflare.com");
    expect(r.headers.get("x-request-id")).toBeTruthy();
  });

  it("unknown /api route is 401 without Access, JSON 404 for the owner", async () => {
    expect((await anonFetch("/api/nope")).status).toBe(401);
    const r = await accessFetch("/api/nope");
    expect(r.status).toBe(404);
    expect((await r.json()) as { error: string }).toEqual({ error: "not found" });
  });
});

describe("access gate", () => {
  beforeAll(migrate);

  it("/api/me is 401 when no Access identity reached the worker", async () => {
    const r = await anonFetch("/api/me");
    expect(r.status).toBe(401);
  });

  it("/api/me is 403 when Access admitted a non-owner", async () => {
    const r = await accessFetch("/api/me", {}, `other-${crypto.randomUUID()}@t.dev`);
    expect(r.status).toBe(403);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
  });

  it("/api/me returns the owner email (case-insensitive match)", async () => {
    const r = await accessFetch("/api/me", {}, OWNER.toUpperCase());
    expect(r.status).toBe(200);
    expect((await r.json()) as { email: string }).toEqual({ email: OWNER.toUpperCase() });
  });
});
