import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { onApiError } from "./errors";
import * as svc from "../services/runs";
import type { OwnerVars } from "../middleware/owner";

type AppEnv = { Bindings: Env; Variables: OwnerVars };

/**
 * Dashboard summary — the counts and last-run tile the /dashboard page
 * renders.
 */
export const dashboardApi = new Hono<AppEnv>().onError(onApiError).get("/dashboard", async (c) => {
  const db = drizzle(c.env.DB);
  return c.json({ data: await svc.summary(db) }, 200);
});
