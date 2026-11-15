import { createMiddleware } from "hono/factory";
import { createAuth } from "../auth";
import { errorJson } from "../api/errors";

export interface Principal {
  userId: string;
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
    isAdmin: (session.user as { role?: string | null }).role === "admin",
  });
  await next();
});

/**
 * Admin gate for the ingest-dashboard routes — every jobs/companies/sources/
 * runs route requires the principal's user to carry
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
