import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { json, onApiError, validationHook } from "./errors";
import * as svc from "../services/projects";
import { requireScope, type PrincipalVars } from "../middleware/principal";
import {
  ErrorResponse,
  ProjectResult,
  ProjectCreate,
  ProjectList,
  ProjectListQuery,
  ProjectUpdate,
} from "./schemas";

type AppEnv = { Bindings: Env; Variables: PrincipalVars };

/**
 * The Projects resource — same router for the session-authenticated
 * `/api/projects/*` web-app routes and, later, the key-authenticated `/api/v1`.
 * Authentication is intentionally NOT declared here: the mount point supplies
 * the `principal`.
 */
export const projectsApi = new OpenAPIHono<AppEnv>({
  defaultHook: validationHook,
});

projectsApi.onError(onApiError);
const errors = (...codes: number[]) =>
  Object.fromEntries(
    codes.map((code) => [code, { content: json(ErrorResponse), description: "Error" }]),
  );

const idParam = z.object({ id: z.string() });

projectsApi.openapi(
  createRoute({
    method: "get",
    path: "/projects",
    tags: ["Projects"],
    security: [{ bearerAuth: [] }],
    middleware: requireScope("projects", "read"),
    request: { query: ProjectListQuery },
    responses: {
      200: { content: json(ProjectList), description: "Page of projects" },
      ...errors(400, 401, 403),
    },
  }),
  async (c) => {
    const query = c.req.valid("query");
    const db = drizzle(c.env.DB);
    const { items, nextCursor } = await svc.list(db, c.get("principal").userId, query);
    return c.json({ data: items, nextCursor }, 200);
  },
);

projectsApi.openapi(
  createRoute({
    method: "post",
    path: "/projects",
    tags: ["Projects"],
    security: [{ bearerAuth: [] }],
    middleware: requireScope("projects", "write"),
    request: { body: { content: json(ProjectCreate), required: true } },
    responses: {
      201: { content: json(ProjectResult), description: "Created project" },
      ...errors(400, 401, 403),
    },
  }),
  async (c) => {
    const input = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const created = await svc.create(db, c.get("principal").userId, input);
    return c.json({ data: created }, 201);
  },
);

projectsApi.openapi(
  createRoute({
    method: "get",
    path: "/projects/{id}",
    tags: ["Projects"],
    security: [{ bearerAuth: [] }],
    middleware: requireScope("projects", "read"),
    request: { params: idParam },
    responses: {
      200: { content: json(ProjectResult), description: "The project" },
      ...errors(401, 403, 404),
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const found = await svc.get(db, c.get("principal").userId, id);
    return c.json({ data: found }, 200);
  },
);

projectsApi.openapi(
  createRoute({
    method: "patch",
    path: "/projects/{id}",
    tags: ["Projects"],
    security: [{ bearerAuth: [] }],
    middleware: requireScope("projects", "write"),
    request: {
      params: idParam,
      body: { content: json(ProjectUpdate), required: true },
    },
    responses: {
      200: { content: json(ProjectResult), description: "Updated project" },
      ...errors(400, 401, 403, 404),
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const patch = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const updated = await svc.update(db, c.get("principal").userId, id, patch);
    return c.json({ data: updated }, 200);
  },
);

projectsApi.openapi(
  createRoute({
    method: "delete",
    path: "/projects/{id}",
    tags: ["Projects"],
    security: [{ bearerAuth: [] }],
    middleware: requireScope("projects", "write"),
    request: { params: idParam },
    responses: {
      204: { description: "Deleted" },
      ...errors(401, 403, 404),
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    await svc.remove(db, c.get("principal").userId, id);
    return c.body(null, 204);
  },
);
