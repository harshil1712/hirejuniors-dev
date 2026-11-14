import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createMiddleware } from "hono/factory";
import { user } from "../../schema/db";
import { createAuth } from "../auth";
import { errorJson } from "../api/errors";

export type Scope = "jobs:read" | "jobs:write";

/**
 * Whoever is calling: a session user, or an API key. The shared
 * service/API layers only see this type.
 */
export interface Principal {
  userId: string;
  /** Non-null when authenticated via API key. */
  keyId: string | null;
  scopes: Scope[];
  /** Better Auth admin-plugin role — the jobs dashboard is admin-only. */
  isAdmin: boolean;
}

declare module "hono" {
  interface ContextVariableMap {
    principal: Principal;
  }
}

export interface PrincipalVars {
  principal: Principal;
}

/**
 * Web-app authentication: Better Auth session cookie → full-scope principal.
 */
export const sessionPrincipal = createMiddleware<{
  Bindings: Env;
  Variables: PrincipalVars;
}>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return errorJson(c, 401, "unauthorized", "Authentication required");
  }
  c.set("principal", {
    userId: session.user.id,
    keyId: null,
    scopes: ["jobs:read", "jobs:write"],
    isAdmin: (session.user as { role?: string | null }).role === "admin",
  });
  await next();
});

/**
 * Admin gate for the ingest-dashboard routes — every jobs/companies/sources/
 * runs route (session, /api/v1, MCP) requires the principal's user to carry
 * the Better Auth admin-plugin `admin` role.
 */
export const requireAdmin = createMiddleware<{
  Bindings: Env;
  Variables: PrincipalVars;
}>(async (c, next) => {
  if (!c.get("principal")?.isAdmin) {
    return errorJson(c, 403, "forbidden", "Admin access required");
  }
  await next();
});

/** Write implies read. */
export function hasScope(scopes: Scope[], resource: "jobs", action: "read" | "write") {
  return scopes.includes(`${resource}:${action}`) || scopes.includes(`${resource}:write`);
}

export function requireScope(resource: "jobs", action: "read" | "write") {
  const need: Scope = `${resource}:${action}`;
  return createMiddleware<{ Bindings: Env; Variables: PrincipalVars }>(async (c, next) => {
    if (!hasScope(c.get("principal")?.scopes ?? [], resource, action)) {
      return errorJson(c, 403, "insufficient_scope", `This credential lacks the ${need} scope`);
    }
    await next();
  });
}

const KNOWN_SCOPES: Scope[] = ["jobs:read", "jobs:write"];

/** `{ jobs: ["read","write"] }` → `["jobs:read","jobs:write"]`,
 * filtered to the scopes this deployment knows. */
export function scopesFromPermissions(permissions: Record<string, string[]> | null): Scope[] {
  const scopes = new Set<Scope>();
  for (const [resource, actions] of Object.entries(permissions ?? {})) {
    for (const action of actions) {
      const scope = `${resource}:${action}` as Scope;
      if (KNOWN_SCOPES.includes(scope)) scopes.add(scope);
    }
  }
  return [...scopes];
}

/**
 * Agent authentication: `Authorization: Bearer <key>` only — never cookies or
 * query strings. Missing/invalid/expired/revoked → 401 with
 * `WWW-Authenticate: Bearer`.
 */
export const requireApiKey = createMiddleware<{
  Bindings: Env;
  Variables: PrincipalVars;
}>(async (c, next) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const result = token ? await createAuth(c.env).api.verifyApiKey({ body: { key: token } }) : null;
  const key = result?.valid ? result.key : null;
  // The plugin's verify path never checks the owning user (and apikey has no
  // FK) — a deleted or banned user's keys must not authenticate.
  const owner = key
    ? await drizzle(c.env.DB)
        .select({ banned: user.banned, banExpires: user.banExpires, role: user.role })
        .from(user)
        .where(eq(user.id, key.referenceId))
        .get()
    : null;
  const banned =
    owner?.banned === true &&
    (owner.banExpires === null ||
      owner.banExpires === undefined ||
      owner.banExpires.getTime() > Date.now());
  if (!key || !owner || banned) {
    c.header("WWW-Authenticate", "Bearer");
    return errorJson(c, 401, "unauthorized", "A valid API key is required");
  }
  c.set("principal", {
    userId: key.referenceId,
    keyId: key.id,
    scopes: scopesFromPermissions(key.permissions ?? null),
    isAdmin: owner.role === "admin",
  });
  await next();
});
