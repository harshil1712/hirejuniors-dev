import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { json, onApiError, validationHook } from "./errors";
import * as svc from "../services/companies";
import { requireAdmin, type PrincipalVars } from "../middleware/principal";
import { CompanyCreate, CompanyList, CompanyResult, CompanyUpdate, ErrorResponse } from "./schemas";

type AppEnv = { Bindings: Env; Variables: PrincipalVars };

export const companiesApi = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

companiesApi.onError(onApiError);
const errors = (...codes: number[]) =>
  Object.fromEntries(
    codes.map((code) => [code, { content: json(ErrorResponse), description: "Error" }]),
  );

const idParam = z.object({ id: z.string() });

companiesApi.openapi(
  createRoute({
    method: "get",
    path: "/companies",
    tags: ["Companies"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    responses: {
      200: { content: json(CompanyList), description: "All companies" },
      ...errors(401, 403),
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    return c.json({ data: await svc.list(db) }, 200);
  },
);

companiesApi.openapi(
  createRoute({
    method: "post",
    path: "/companies",
    tags: ["Companies"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    request: { body: { content: json(CompanyCreate), required: true } },
    responses: {
      201: { content: json(CompanyResult), description: "Created company" },
      ...errors(400, 401, 403, 409),
    },
  }),
  async (c) => {
    const input = c.req.valid("json");
    const db = drizzle(c.env.DB);
    const created = await svc.create(db, input);
    return c.json({ data: created }, 201);
  },
);

companiesApi.openapi(
  createRoute({
    method: "patch",
    path: "/companies/{id}",
    tags: ["Companies"],
    security: [{ bearerAuth: [] }],
    middleware: [requireAdmin],
    request: {
      params: idParam,
      body: { content: json(CompanyUpdate), required: true },
    },
    responses: {
      200: { content: json(CompanyResult), description: "Updated company" },
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
