import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { onApiError, validationHook } from "./errors";
import * as svc from "../services/jobs";
import { requireAdmin, type PrincipalVars } from "../middleware/principal";
import { JobApprove, JobListQuery, JobUpdate } from "./schemas";

type AppEnv = { Bindings: Env; Variables: PrincipalVars };

const idParam = z.object({ id: z.string() });

/**
 * Job listings — session-authenticated `/api/jobs/*` dashboard routes;
 * every route also requires the admin role.
 */
export const jobsApi = new Hono<AppEnv>()
  .onError(onApiError)
  .get("/jobs", requireAdmin, zValidator("query", JobListQuery, validationHook), async (c) => {
    const query = c.req.valid("query");
    const db = drizzle(c.env.DB);
    const { items, nextCursor } = await svc.list(db, query);
    return c.json({ data: items, nextCursor }, 200);
  })
  .get("/jobs/:id", requireAdmin, zValidator("param", idParam, validationHook), async (c) => {
    const { id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const found = await svc.get(db, id);
    return c.json({ data: found }, 200);
  })
  .patch(
    "/jobs/:id",
    requireAdmin,
    zValidator("param", idParam, validationHook),
    zValidator("json", JobUpdate, validationHook),
    async (c) => {
      const { id } = c.req.valid("param");
      const { status } = c.req.valid("json");
      const db = drizzle(c.env.DB);
      const updated = await svc.setStatus(db, id, status);
      return c.json({ data: updated }, 200);
    },
  )
  .post(
    "/jobs/:id/approve",
    requireAdmin,
    zValidator("param", idParam, validationHook),
    zValidator("json", JobApprove, validationHook),
    async (c) => {
      const { id } = c.req.valid("param");
      const { level } = c.req.valid("json");
      const db = drizzle(c.env.DB);
      return c.json({ data: await svc.approve(db, id, level) }, 200);
    },
  )
  .post(
    "/jobs/:id/reject",
    requireAdmin,
    zValidator("param", idParam, validationHook),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = drizzle(c.env.DB);
      return c.json({ data: await svc.reject(db, id) }, 200);
    },
  );
