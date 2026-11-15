// GET + POST /api/discovery — candidate list and manual domain adds.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import type { OwnerVars } from "../middleware/owner";
import { onApiError, validationHook } from "./errors";
import * as svc from "../services/discovery";
import { DiscoveryAdd, DiscoveryListQuery } from "./schemas";
import { addManualCandidates } from "@hirejuniors/jobs/discover";

type AppEnv = { Bindings: Env; Variables: OwnerVars };

export const discoveryApi = new Hono<AppEnv>()
  .onError(onApiError)
  .get("/discovery", zValidator("query", DiscoveryListQuery, validationHook), async (c) => {
    const { status, cursor } = c.req.valid("query");
    const db = drizzle(c.env.DB);
    return c.json(await svc.list(db, { status, cursor }), 200);
  })
  .post("/discovery", zValidator("json", DiscoveryAdd, validationHook), async (c) => {
    const { domains } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    return c.json({ data: { added: await addManualCandidates(db, domains) } }, 200);
  });
