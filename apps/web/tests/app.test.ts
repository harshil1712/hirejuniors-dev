/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vite-plus/test";
import {
  migrate,
  seedVerifiedUser,
  signIn,
  signUp,
  verifiedSessionCookie,
  verifyLatest,
  PASSWORD,
} from "./helpers";

// The always-pass test secret accepts any token; "" exercises the missing-token path.
const CAPTCHA = { "x-captcha-response": "test-token" };

describe("worker", () => {
  beforeAll(migrate);

  it("GET /api/health returns 200 with security headers", async () => {
    const r = await SELF.fetch("https://x/api/health");
    expect(r.status).toBe(200);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("strict-transport-security")).toContain("max-age");
    expect(r.headers.get("content-security-policy")).toContain("challenges.cloudflare.com");
    expect(r.headers.get("x-request-id")).toBeTruthy();
  });

  it("unknown /api route is JSON 404", async () => {
    const r = await SELF.fetch("https://x/api/nope");
    expect(r.status).toBe(404);
    expect(await r.json<{ error: string }>()).toEqual({ error: "not found" });
  });

  it("/api/me is 401 without a session", async () => {
    const r = await SELF.fetch("https://x/api/me");
    expect(r.status).toBe(401);
  });

  it("/api/public-config returns the test site key", async () => {
    const r = await SELF.fetch("https://x/api/public-config");
    const j = await r.json<{ turnstileSiteKey: string }>();
    expect(j.turnstileSiteKey).toBe("1x00000000000000000000AA");
  });
});

describe("auth", () => {
  beforeAll(migrate);

  it("sign-up is owner-only: non-owner rejected, owner allowed, sign-in still works", async () => {
    const email = `u-${crypto.randomUUID()}@t.dev`;
    await seedVerifiedUser(email);

    // Stranger → rejected, no user row.
    const closedEmail = `closed-${crypto.randomUUID()}@t.dev`;
    const closed = await signUp(closedEmail);
    expect(closed.status).not.toBe(200);
    const row = await env.DB.prepare("SELECT id FROM user WHERE email = ?")
      .bind(closedEmail)
      .first();
    expect(row).toBeNull();

    // Owner (OWNER_ADMIN_EMAIL=owner@example.com) → allowed.
    const owner = await signUp("owner@example.com");
    expect(owner.status).toBe(200);

    // Existing accounts still sign in.
    const login = await SELF.fetch("https://x/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", "x-captcha-response": "test" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.status).toBe(200);
  });

  it("sign-up without a captcha token is rejected", async () => {
    const r = await signUp(`nocap-${crypto.randomUUID()}@t.dev`, "");
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("sign-up with the always-pass token sends a verification email; sign-in is refused until verified", async () => {
    // Sign-up is owner-only, so the flow is exercised with the owner email;
    // remove any owner row left by earlier tests so sign-up succeeds.
    const email = "owner@example.com";
    const existing = await env.DB.prepare("SELECT id FROM user WHERE email = ?")
      .bind(email)
      .first<{ id: string }>();
    if (existing) {
      await env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(existing.id).run();
      await env.DB.prepare("DELETE FROM account WHERE user_id = ?").bind(existing.id).run();
      await env.DB.prepare("DELETE FROM user WHERE id = ?").bind(existing.id).run();
    }
    const r = await signUp(email);
    expect(r.status).toBe(200);

    const sent = await env.DB.prepare("SELECT subject, html FROM sent_email WHERE to_addr = ?")
      .bind(email)
      .first();
    expect(sent).toBeTruthy();

    const denied = await SELF.fetch("https://x/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...CAPTCHA },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(denied.status).toBeGreaterThanOrEqual(400);

    await verifyLatest(email);
    const ok = await SELF.fetch("https://x/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...CAPTCHA },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(ok.status).toBe(200);
  });

  it("admin list-users: 403 for a normal user, 200 for the owner after verification", async () => {
    // normal user
    const email = `n-${crypto.randomUUID()}@t.dev`;
    const cookies = await verifiedSessionCookie(email);
    const r1 = await SELF.fetch("https://x/api/auth/admin/list-users", {
      headers: { cookie: cookies },
    });
    expect(r1.status).toBe(403);

    // owner (OWNER_ADMIN_EMAIL=owner@example.com) — verify first, then the
    // admin plugin sees role=admin from the bootstrap hook. The account may
    // already exist (the owner-only test above signs the owner up), so
    // don't assert on the sign-up status.
    // Owner exists already (verified in the sign-up flow test); sign in.
    const cookies2 = await signIn("owner@example.com");
    const r2 = await SELF.fetch("https://x/api/auth/admin/list-users", {
      headers: { cookie: cookies2 },
    });
    expect(r2.status).toBe(200);
  });
});
