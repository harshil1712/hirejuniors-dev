import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createMiddleware } from "hono/factory";
import { user } from "../../schema/db";
import { PRODUCT } from "../../src/config";
import { json, onApiError, errorJson, validationHook } from "./errors";
import { requireApiKey, type PrincipalVars } from "../middleware/principal";
import { apiKeyRateLimit } from "../middleware/rate-limit";
import { jobsApi } from "./jobs";
import { companiesApi } from "./companies";
import { sourcesApi } from "./sources";
import { runsApi } from "./runs";
import { ErrorResponse, MeResult } from "./schemas";

type AppEnv = { Bindings: Env; Variables: PrincipalVars };

/**
 * The versioned agent-facing API (`/api/v1`). API-key auth only — the
 * `requireApiKey` middleware sets `principal`; session cookies are never
 * consulted. `publicSpec` (project.config.ts) publishes openapi.json without a
 * key; every other route always needs one.
 */
export function createV1Api({ publicSpec }: { publicSpec: boolean }) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook }).basePath("/api/v1");

  app.onError(onApiError);

  // 1. API-key auth — the only unauthenticated path is a public spec document.
  app.use("*", async (c, next) => {
    if (publicSpec && c.req.path === "/api/v1/openapi.json") return next();
    return requireApiKey(c, next);
  });

  // 2. Per-key rate limit (skips when there's no key principal).
  app.use("*", apiKeyRateLimit);

  // 3. Writes must be JSON (spec §5.2).
  app.use(
    "*",
    createMiddleware<AppEnv>(async (c, next) => {
      const method = c.req.method;
      if (method === "POST" || method === "PUT" || method === "PATCH") {
        const contentType = c.req.header("content-type") ?? "";
        if (!contentType.startsWith("application/json")) {
          return errorJson(
            c,
            415,
            "unsupported_media_type",
            "Request bodies must be application/json",
          );
        }
      }
      await next();
    }),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/me",
      tags: ["Account"],
      security: [{ bearerAuth: [] }],
      responses: {
        200: { content: json(MeResult), description: "The key's owner and scopes" },
        401: { content: json(ErrorResponse), description: "Error" },
      },
    }),
    async (c) => {
      const principal = c.get("principal");
      const db = drizzle(c.env.DB);
      const owner = await db
        .select({ email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, principal.userId))
        .get();
      return c.json(
        {
          data: {
            userId: principal.userId,
            email: owner?.email ?? "",
            name: owner?.name ?? "",
            keyId: principal.keyId,
            scopes: principal.scopes,
          },
        },
        200,
      );
    },
  );

  // The ingest-dashboard resources — same routers the web app uses with a
  // session. Admin role is required inside each router.
  app.route("/", jobsApi);
  app.route("/", companiesApi);
  app.route("/", sourcesApi);
  app.route("/", runsApi);

  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
  });

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: `${PRODUCT.name} API`,
      version: "1.0.0",
      description: `The ${PRODUCT.name} HTTP API for agents and scripts. Authenticate with an API key: \`Authorization: Bearer <key>\`.`,
    },
    servers: [{ url: `https://${PRODUCT.appDomain}` }],
    tags: [
      { name: "Account", description: "The calling credential's identity" },
      { name: "Jobs", description: "Browse and moderate job listings" },
      { name: "Companies", description: "Manage companies" },
      { name: "Sources", description: "Manage ingest sources" },
      { name: "Runs", description: "Inspect and trigger ingest runs" },
    ],
  });

  return app;
}
