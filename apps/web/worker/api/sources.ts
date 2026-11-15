import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { onApiError, validationHook } from "./errors";
import * as svc from "../services/sources";
import type { OwnerVars } from "../middleware/owner";
import { SourceCreate, SourcePreview, SourceUpdate } from "./schemas";

type AppEnv = { Bindings: Env; Variables: OwnerVars };

const idParam = z.object({ id: z.string() });

export const sourcesApi = new Hono<AppEnv>()
  .onError(onApiError)
  .get("/sources", async (c) => {
    const db = drizzle(c.env.DB);
    return c.json({ data: await svc.list(db) }, 200);
  })
  .post("/sources", zValidator("json", SourceCreate, validationHook), async (c) => {
    const input = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const created = await svc.create(db, input);
    return c.json({ data: created }, 201);
  })
  .post("/sources/preview", zValidator("json", SourcePreview, validationHook), async (c) => {
    const input = c.req.valid("json");
    const result = await svc.preview(input, fetch.bind(globalThis));
    return c.json({ data: result }, 200);
  })
  .patch(
    "/sources/:id",
    zValidator("param", idParam, validationHook),
    zValidator("json", SourceUpdate, validationHook),
    async (c) => {
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      const db = drizzle(c.env.DB);
      const updated = await svc.update(db, id, patch);
      return c.json({ data: updated }, 200);
    },
  );
