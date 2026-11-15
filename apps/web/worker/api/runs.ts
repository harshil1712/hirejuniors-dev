import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { onApiError, validationHook } from "./errors";
import * as svc from "../services/runs";
import type { OwnerVars } from "../middleware/owner";
import { RunListQuery } from "./schemas";

type AppEnv = { Bindings: Env; Variables: OwnerVars };

const idParam = z.object({ id: z.string() });

export const runsApi = new Hono<AppEnv>()
  .onError(onApiError)
  .get("/runs", zValidator("query", RunListQuery, validationHook), async (c) => {
    const query = c.req.valid("query");
    const db = drizzle(c.env.DB);
    const { items, nextCursor } = await svc.list(db, query);
    return c.json({ data: items, nextCursor }, 200);
  })
  .post("/runs", async (c) => {
    const { instanceId } = await svc.trigger(c.env);
    return c.json({ data: { instanceId } }, 202);
  })
  .get("/runs/:id", zValidator("param", idParam, validationHook), async (c) => {
    const { id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const found = await svc.get(db, id);
    return c.json({ data: found }, 200);
  });
