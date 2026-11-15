import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { json, onApiError, validationHook } from "./errors";
import * as svc from "../services/sources";
import { requireAdmin, type PrincipalVars } from "../middleware/principal";
import {
  ErrorResponse,
  SourceCreate,
  SourceList,
  SourcePreview,
  SourcePreviewResult,
  SourceResult,
  SourceUpdate,
} from "./schemas";

type AppEnv = { Bindings: Env; Variables: PrincipalVars };

export const sourcesApi = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

sourcesApi.onError(onApiError);
const errors = (...codes: number[]) =>
  Object.fromEntries(
    codes.map((code) => [code, { content: json(ErrorResponse), description: "Error" }]),
  );

const idParam = z.object({ id: z.string() });

sourcesApi.openapi(
  createRoute({
    method: "get",
    path: "/sources",
    tags: ["Sources"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    responses: {
      200: { content: json(SourceList), description: "All sources" },
      ...errors(401, 403),
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    return c.json({ data: await svc.list(db) }, 200);
  },
);

sourcesApi.openapi(
  createRoute({
    method: "post",
    path: "/sources",
    tags: ["Sources"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    request: { body: { content: json(SourceCreate), required: true } },
    responses: {
      201: { content: json(SourceResult), description: "Created source" },
      ...errors(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const input = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const created = await svc.create(db, input);
    return c.json({ data: created }, 201);
  },
);

sourcesApi.openapi(
  createRoute({
    method: "post",
    path: "/sources/preview",
    tags: ["Sources"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    request: { body: { content: json(SourcePreview), required: true } },
    responses: {
      200: { content: json(SourcePreviewResult), description: "Dry-run result" },
      ...errors(400, 401, 403, 502),
    },
  }),
  async (c) => {
    const input = c.req.valid("json");
    const result = await svc.preview(input, fetch.bind(globalThis));
    return c.json({ data: result }, 200);
  },
);

sourcesApi.openapi(
  createRoute({
    method: "patch",
    path: "/sources/{id}",
    tags: ["Sources"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    request: {
      params: idParam,
      body: { content: json(SourceUpdate), required: true },
    },
    responses: {
      200: { content: json(SourceResult), description: "Updated source" },
      ...errors(400, 401, 403, 404, 409),
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const patch = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const updated = await svc.update(db, id, patch);
    return c.json({ data: updated }, 200);
  },
);
