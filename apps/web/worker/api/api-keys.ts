import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { createAuth } from "../auth";
import { json, onApiError, validationHook } from "./errors";
import type { PrincipalVars } from "../middleware/principal";
import { ApiKeyCreate, ApiKeyResult, ErrorResponse } from "./schemas";

type AppEnv = { Bindings: Env; Variables: PrincipalVars };

/**
 * Session-authenticated key management (Settings → API keys); the mount
 * point installs `sessionPrincipal`. Creation goes through this worker
 * because `permissions` is a server-only property on Better Auth's create
 * endpoint; list/revoke go straight to the plugin's session endpoints from
 * the client.
 */
export const apiKeysApi = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

apiKeysApi.onError(onApiError);

apiKeysApi.openapi(
  createRoute({
    method: "post",
    path: "/api-keys",
    tags: ["API keys"],
    request: { body: { content: json(ApiKeyCreate), required: true } },
    responses: {
      201: { content: json(ApiKeyResult), description: "Created key, shown once" },
      400: { content: json(ErrorResponse), description: "Error" },
      401: { content: json(ErrorResponse), description: "Error" },
    },
  }),
  async (c) => {
    const input = c.req.valid("json");
    const principal = c.get("principal");
    // Write implies read — a write-only key would break list/get.
    const actions = input.scopes.includes("jobs:write") ? ["read", "write"] : ["read"];
    const storedScopes = input.scopes.includes("jobs:write")
      ? (["jobs:read", "jobs:write"] as const)
      : (["jobs:read"] as const);
    const created = await createAuth(c.env).api.createApiKey({
      body: {
        name: input.name,
        userId: principal.userId,
        expiresIn: input.expiresInDays === null ? null : input.expiresInDays * 86400,
        permissions: { jobs: actions },
      },
    });
    return c.json(
      {
        data: {
          id: created.id,
          key: created.key,
          name: created.name,
          start: created.start,
          expiresAt: created.expiresAt ? new Date(created.expiresAt).toISOString() : null,
          scopes: [...storedScopes],
        },
      },
      201,
    );
  },
);
