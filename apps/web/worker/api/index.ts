// The session API routers composed as one typed app — `ApiRoutes` is the
// `hc` client type source for the SPA's admin-api lib.
import { Hono } from "hono";
import type { OwnerVars } from "../middleware/owner";
import { jobsApi } from "./jobs";
import { companiesApi } from "./companies";
import { sourcesApi } from "./sources";
import { runsApi } from "./runs";
import { discoveryApi } from "./discovery";
import { dashboardApi } from "./dashboard";

type AppEnv = { Bindings: Env; Variables: OwnerVars };

export const api = new Hono<AppEnv>()
  // Who the Access-admitted caller is — the SPA's only "session" lookup.
  .get("/me", (c) => c.json({ email: c.get("ownerEmail") }, 200))
  .route("/", jobsApi)
  .route("/", companiesApi)
  .route("/", sourcesApi)
  .route("/", runsApi)
  .route("/", discoveryApi)
  .route("/", dashboardApi);

export type ApiRoutes = typeof api;
