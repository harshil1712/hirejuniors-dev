import { createMiddleware } from "hono/factory";
import { errorJson } from "../api/errors";

export interface OwnerVars {
  ownerEmail: string;
}

declare module "hono" {
  interface ContextVariableMap {
    ownerEmail: string;
  }
}

/** The shape workerd exposes on `ctx.access` for requests Cloudflare Access
 * admitted — typed locally; @cloudflare/workers-types doesn't declare it. */
interface RawAccessContext {
  aud: string;
  getIdentity(): Promise<{ email?: string } | undefined>;
}

/** Under `alchemy dev` there is no edge, so the Worker's `dev.access` config
 * is lowered into this env binding instead of `ctx.access`. */
const DEV_ACCESS_ENV_KEY = "ALCHEMY_DEV_ACCESS";

async function accessEmail(
  executionCtx: { access?: RawAccessContext },
  env: Env,
): Promise<string | undefined> {
  const email = (await executionCtx.access?.getIdentity())?.email;
  if (email) return email;
  return env[DEV_ACCESS_ENV_KEY]?.identity?.email;
}

/**
 * Owner gate: Cloudflare Access sits in front of the whole app (set in
 * alchemy.run.ts), so a request reaching the worker with no `ctx.access`
 * bypassed Access → 401. The admitted identity's email must match
 * OWNER_ADMIN_EMAIL (case-insensitive) → otherwise 403.
 */
export const requireOwner = createMiddleware<{ Bindings: Env; Variables: OwnerVars }>(
  async (c, next) => {
    const email = await accessEmail(c.executionCtx as { access?: RawAccessContext }, c.env);
    if (!email) {
      return errorJson(c, 401, "unauthorized", "Authentication required");
    }
    if (email.toLowerCase() !== c.env.OWNER_ADMIN_EMAIL.toLowerCase()) {
      return errorJson(c, 403, "forbidden", "This account is not the dashboard owner");
    }
    c.set("ownerEmail", email);
    await next();
  },
);
