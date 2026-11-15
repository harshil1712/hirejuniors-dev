import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { onApiError, validationHook } from "./errors";
import * as svc from "../services/companies";
import { requireAdmin, type PrincipalVars } from "../middleware/principal";
import { CompanyCreate, CompanyUpdate } from "./schemas";

type AppEnv = { Bindings: Env; Variables: PrincipalVars };

const idParam = z.object({ id: z.string() });

export const companiesApi = new Hono<AppEnv>()
  .onError(onApiError)
  .get("/companies", requireAdmin, async (c) => {
    const db = drizzle(c.env.DB);
    return c.json({ data: await svc.list(db) }, 200);
  })
  .post(
    "/companies",
    requireAdmin,
    zValidator("json", CompanyCreate, validationHook),
    async (c) => {
      const input = c.req.valid("json");
      const db = drizzle(c.env.DB);
      const created = await svc.create(db, input);
      return c.json({ data: created }, 201);
    },
  )
  .patch(
    "/companies/:id",
    requireAdmin,
    zValidator("param", idParam, validationHook),
    zValidator("json", CompanyUpdate, validationHook),
    async (c) => {
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      const db = drizzle(c.env.DB);
      const updated = await svc.update(db, id, patch);
      return c.json({ data: updated }, 200);
    },
  );
