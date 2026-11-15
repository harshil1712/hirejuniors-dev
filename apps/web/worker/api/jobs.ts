import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { json, onApiError, validationHook } from "./errors";
import * as svc from "../services/jobs";
import { requireAdmin, type PrincipalVars } from "../middleware/principal";
import { ErrorResponse, JobApprove, JobList, JobListQuery, JobResult, JobUpdate } from "./schemas";

type AppEnv = { Bindings: Env; Variables: PrincipalVars };

/**
 * Job listings — session-authenticated `/api/jobs/*` dashboard routes;
 * every route also requires the admin role.
 */
export const jobsApi = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

jobsApi.onError(onApiError);
const errors = (...codes: number[]) =>
  Object.fromEntries(
    codes.map((code) => [code, { content: json(ErrorResponse), description: "Error" }]),
  );

const idParam = z.object({ id: z.string() });

jobsApi.openapi(
  createRoute({
    method: "get",
    path: "/jobs",
    tags: ["Jobs"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    request: { query: JobListQuery },
    responses: {
      200: { content: json(JobList), description: "Page of jobs" },
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

jobsApi.openapi(
  createRoute({
    method: "get",
    path: "/jobs/{id}",
    tags: ["Jobs"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    request: { params: idParam },
    responses: {
      200: { content: json(JobResult), description: "The job" },
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

jobsApi.openapi(
  createRoute({
    method: "patch",
    path: "/jobs/{id}",
    tags: ["Jobs"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    request: {
      params: idParam,
      body: { content: json(JobUpdate), required: true },
    },
    responses: {
      200: { content: json(JobResult), description: "Updated job" },
      ...errors(400, 401, 403, 404),
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const updated = await svc.setStatus(db, id, status);
    return c.json({ data: updated }, 200);
  },
);

jobsApi.openapi(
  createRoute({
    method: "post",
    path: "/jobs/{id}/approve",
    tags: ["Jobs"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    request: {
      params: idParam,
      body: { content: json(JobApprove), required: true },
    },
    responses: {
      200: { content: json(JobResult), description: "Approved job" },
      ...errors(400, 401, 403, 404),
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const { level } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    return c.json({ data: await svc.approve(db, id, level) }, 200);
  },
);

jobsApi.openapi(
  createRoute({
    method: "post",
    path: "/jobs/{id}/reject",
    tags: ["Jobs"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    request: { params: idParam },
    responses: {
      200: { content: json(JobResult), description: "Rejected job" },
      ...errors(400, 401, 403, 404),
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    return c.json({ data: await svc.reject(db, id) }, 200);
  },
);
