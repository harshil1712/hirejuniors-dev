import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { json, onApiError, validationHook } from "./errors";
import * as svc from "../services/runs";
import { requireAdmin, type PrincipalVars } from "../middleware/principal";
import { ErrorResponse, RunDetail, RunList, RunListQuery, RunTriggered } from "./schemas";

type AppEnv = { Bindings: Env; Variables: PrincipalVars };

export const runsApi = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

runsApi.onError(onApiError);
const errors = (...codes: number[]) =>
  Object.fromEntries(
    codes.map((code) => [code, { content: json(ErrorResponse), description: "Error" }]),
  );

const idParam = z.object({ id: z.string() });

runsApi.openapi(
  createRoute({
    method: "get",
    path: "/runs",
    tags: ["Runs"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    request: { query: RunListQuery },
    responses: {
      200: { content: json(RunList), description: "Page of ingest runs, latest first" },
      ...errors(400, 401, 403),
    },
  }),
  async (c) => {
    const query = c.req.valid("query");
    const db = drizzle(c.env.DB);
    const { items, nextCursor } = await svc.list(db, query);
    return c.json({ data: items, nextCursor }, 200);
  },
);

runsApi.openapi(
  createRoute({
    method: "post",
    path: "/runs",
    tags: ["Runs"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    responses: {
      202: { content: json(RunTriggered), description: "Ingest workflow started" },
      ...errors(401, 403, 503),
    },
  }),
  async (c) => {
    const { instanceId } = await svc.trigger(c.env);
    return c.json({ data: { instanceId } }, 202);
  },
);

runsApi.openapi(
  createRoute({
    method: "get",
    path: "/runs/{id}",
    tags: ["Runs"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    request: { params: idParam },
    responses: {
      200: { content: json(RunDetail), description: "The run, with per-source rows" },
      ...errors(401, 403, 404),
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const found = await svc.get(db, id);
    return c.json({ data: found }, 200);
  },
);
