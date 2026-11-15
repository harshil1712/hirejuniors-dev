import { Hono } from "hono";

/** Unauthenticated config for the SPA — the Turnstile widget renders only
 * when the server is configured for it. */
export const publicConfigRoutes = new Hono<{ Bindings: Env }>();

publicConfigRoutes.get("/api/public-config", (c) =>
  c.json({
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? "",
  }),
);
