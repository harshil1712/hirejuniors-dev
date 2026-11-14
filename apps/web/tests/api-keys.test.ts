/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, it, expect, beforeAll } from "vite-plus/test";
import { apikey, user } from "../schema/db";
import { migrate, verifiedSessionCookie, PASSWORD } from "./helpers";

interface Envelope {
  error: { code: string; message: string; requestId: string };
}
interface CreatedKey {
  id: string;
  key: string;
  name: string | null;
  start: string | null;
  expiresAt: string | null;
  scopes: string[];
}
interface MeBody {
  data: { userId: string; email: string; name: string; keyId: string | null; scopes: string[] };
}

/** The POST /api/api-keys body (intentionally loose — tests also send invalid values). */
interface CreateKeyBody {
  name?: string;
  scopes?: string[];
  expiresInDays?: number | null;
}

const ORIGIN = { origin: "http://localhost:8787" };

function createKeyRequest(cookie: string, body: CreateKeyBody) {
  return SELF.fetch("https://x/api/api-keys", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

function me(key?: string, cookie?: string) {
  const headers = new Headers();
  if (key !== undefined) headers.set("authorization", `Bearer ${key}`);
  if (cookie !== undefined) headers.set("cookie", cookie);
  return SELF.fetch("https://x/api/v1/me", { headers });
}

describe("api keys", () => {
  beforeAll(migrate);

  it("create via session → 201 + hj_ key; list shows start, never the full key", async () => {
    const email = `k1-${crypto.randomUUID()}@t.dev`;
    const cookie = await verifiedSessionCookie(email);

    const r = await createKeyRequest(cookie, {
      name: "My key",
      scopes: ["projects:read"],
      expiresInDays: 90,
    });
    expect(r.status).toBe(201);
    const created = (await r.json<{ data: CreatedKey }>()).data;
    expect(created.key.startsWith("hj_")).toBe(true);
    expect(created.id).toBeTruthy();
    expect(Date.parse(created.expiresAt!)).toBeGreaterThan(Date.now());

    const listed = await SELF.fetch("https://x/api/auth/api-key/list", {
      headers: { cookie },
    });
    expect(listed.status).toBe(200);
    const list = await listed.json<{
      apiKeys: { id: string; start: string; key?: string; permissions?: unknown }[];
    }>();
    const mine = list.apiKeys.find((k: { id: string }) => k.id === created.id);
    expect(mine).toBeTruthy();
    expect(mine!.start).toBe(created.start);
    expect(mine!.key).toBeUndefined();
    // The list endpoint returns permissions already parsed (object), which is
    // what the Settings UI renders as scope badges.
    expect(mine!.permissions).toEqual({ projects: ["read"] });
  });

  it("/api/v1/me: 401 without header (+WWW-Authenticate), 401 garbage, 401 session cookie, 200 with key", async () => {
    const email = `k2-${crypto.randomUUID()}@t.dev`;
    const cookie = await verifiedSessionCookie(email);
    const created = (
      await (
        await createKeyRequest(cookie, {
          name: "agent",
          scopes: ["projects:read"],
          expiresInDays: 30,
        })
      ).json<{ data: CreatedKey }>()
    ).data;

    const none = await me();
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe("Bearer");
    expect((await none.json<Envelope>()).error.code).toBe("unauthorized");

    const garbage = await me("hj_garbage");
    expect(garbage.status).toBe(401);
    expect(garbage.headers.get("www-authenticate")).toBe("Bearer");

    // Session cookies are never consulted on /api/v1.
    const byCookie = await me(undefined, cookie);
    expect(byCookie.status).toBe(401);

    const ok = await me(created.key);
    expect(ok.status).toBe(200);
    const body = await ok.json<MeBody>();
    const user = await env.DB.prepare("SELECT id FROM user WHERE email = ?")
      .bind(email)
      .first<{ id: string }>();
    expect(body.data.userId).toBe(user!.id);
    expect(body.data.email).toBe(email);
    expect(body.data.keyId).toBe(created.id);
    expect(body.data.scopes).toEqual(["projects:read"]);
  });

  it("revoked and expired keys get 401; another user can't revoke my key", async () => {
    const email = `k3-${crypto.randomUUID()}@t.dev`;
    const cookie = await verifiedSessionCookie(email);
    const created = (
      await (
        await createKeyRequest(cookie, {
          name: "victim",
          scopes: ["projects:read"],
          expiresInDays: 30,
        })
      ).json<{ data: CreatedKey }>()
    ).data;
    expect((await me(created.key)).status).toBe(200);

    // Another user's delete call can't reach my key.
    const other = await verifiedSessionCookie(`k4-${crypto.randomUUID()}@t.dev`);
    const foreign = await SELF.fetch("https://x/api/auth/api-key/delete", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: other, ...ORIGIN },
      body: JSON.stringify({ keyId: created.id }),
    });
    expect(foreign.status).toBeGreaterThanOrEqual(400);
    expect((await me(created.key)).status).toBe(200);

    // Expired.
    const expired = (
      await (
        await createKeyRequest(cookie, {
          name: "old",
          scopes: ["projects:read"],
          expiresInDays: 30,
        })
      ).json<{ data: CreatedKey }>()
    ).data;
    await drizzle(env.DB)
      .update(apikey)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(apikey.id, expired.id));
    expect((await me(expired.key)).status).toBe(401);

    // Revoked by the owner.
    const del = await SELF.fetch("https://x/api/auth/api-key/delete", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, ...ORIGIN },
      body: JSON.stringify({ keyId: created.id }),
    });
    expect(del.status).toBe(200);
    expect((await me(created.key)).status).toBe(401);
  });

  it("POST /api/api-keys validation: no scopes → 400, expiresInDays 7 → 400, no session → 401", async () => {
    const cookie = await verifiedSessionCookie(`k5-${crypto.randomUUID()}@t.dev`);

    const noScopes = await createKeyRequest(cookie, { name: "x", scopes: [], expiresInDays: 30 });
    expect(noScopes.status).toBe(400);
    expect((await noScopes.json<Envelope>()).error.code).toBe("validation_failed");

    const badExpiry = await createKeyRequest(cookie, {
      name: "x",
      scopes: ["projects:read"],
      expiresInDays: 7,
    });
    expect(badExpiry.status).toBe(400);

    const anon = await createKeyRequest("", {
      name: "x",
      scopes: ["projects:read"],
      expiresInDays: 30,
    });
    expect(anon.status).toBe(401);
  });

  it("a banned user's key → 401; banExpires in the past lifts the ban", async () => {
    const email = `k7-${crypto.randomUUID()}@t.dev`;
    const cookie = await verifiedSessionCookie(email);
    const created = (
      await (
        await createKeyRequest(cookie, {
          name: "banned",
          scopes: ["projects:read"],
          expiresInDays: 30,
        })
      ).json<{ data: CreatedKey }>()
    ).data;
    const me200 = await me(created.key);
    expect(me200.status).toBe(200);
    const owner = (await me200.json<MeBody>()).data;

    const db = drizzle(env.DB);
    await db
      .update(user)
      .set({ banned: true, banExpires: new Date(Date.now() + 3_600_000) })
      .where(eq(user.id, owner.userId));
    expect((await me(created.key)).status).toBe(401);

    // A lapsed ban expiry means the user isn't banned.
    await db
      .update(user)
      .set({ banExpires: new Date(Date.now() - 60_000) })
      .where(eq(user.id, owner.userId));
    expect((await me(created.key)).status).toBe(200);
  });

  it("deleting the user removes their apikey rows and the key → 401", async () => {
    const email = `k8-${crypto.randomUUID()}@t.dev`;
    const cookie = await verifiedSessionCookie(email);
    const created = (
      await (
        await createKeyRequest(cookie, {
          name: "doomed",
          scopes: ["projects:read"],
          expiresInDays: 30,
        })
      ).json<{ data: CreatedKey }>()
    ).data;
    const meBody = (await (await me(created.key)).json<MeBody>()).data;

    const del = await SELF.fetch("https://x/api/auth/delete-user", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, ...ORIGIN },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(del.status).toBe(200);

    expect((await me(created.key)).status).toBe(401);
    const rows = await drizzle(env.DB)
      .select({ id: apikey.id })
      .from(apikey)
      .where(eq(apikey.referenceId, meBody.userId));
    expect(rows).toHaveLength(0);
  });

  it("a write-only selection stores read + write", async () => {
    const cookie = await verifiedSessionCookie(`k6-${crypto.randomUUID()}@t.dev`);
    const created = (
      await (
        await createKeyRequest(cookie, {
          name: "writer",
          scopes: ["projects:write"],
          expiresInDays: null,
        })
      ).json<{ data: CreatedKey }>()
    ).data;

    const ok = await me(created.key);
    expect(ok.status).toBe(200);
    const body = await ok.json<MeBody>();
    expect(body.data.scopes.sort()).toEqual(["projects:read", "projects:write"]);
  });
});
