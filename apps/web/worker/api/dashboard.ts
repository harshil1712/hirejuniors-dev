import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { json, onApiError, validationHook } from "./errors";
import * as svc from "../services/runs";
import { requireAdmin, type PrincipalVars } from "../middleware/principal";
import { DashboardSummary, ErrorResponse } from "./schemas";

type AppEnv = { Bindings: Env; Variables: PrincipalVars };

/**
 * Dashboard summary — the counts and last-run tile the /dashboard page
 * renders.
 */
export const dashboardApi = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

dashboardApi.onError(onApiError);

dashboardApi.openapi(
  createRoute({
    method: "get",
    path: "/dashboard",
    tags: ["Dashboard"],
    middleware: [requireAdmin],
    responses: {
      200: { content: json(DashboardSummary), description: "Dashboard tile counts" },
      401: { content: json(ErrorResponse), description: "Error" },
      403: { content: json(ErrorResponse), description: "Error" },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    return c.json({ data: await svc.summary(db) }, 200);
  },
);
