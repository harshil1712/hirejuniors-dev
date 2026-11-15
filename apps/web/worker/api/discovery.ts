// GET + POST /api/discovery — candidate list and manual domain adds.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { requireAdmin, requireScope } from "../middleware/principal";
import { json } from "./errors";
import { ErrorResponse } from "./schemas";
import * as svc from "../services/discovery";
import { DiscoveryAdd, DiscoveryAddResult, DiscoveryList } from "./schemas";

const errors = (...codes: number[]) =>
  Object.fromEntries(
    codes.map((code) => [code, { content: json(ErrorResponse), description: "Error" }]),
  );

export const discoveryApi = new OpenAPIHono<{ Bindings: Env }>();

const listQuery = z.object({
  status: z.enum(["queued", "found", "not_found", "duplicate", "failed"]).optional(),
  cursor: z.string().optional(),
});

discoveryApi.openapi(
  createRoute({
    method: "get",
    path: "/discovery",
    tags: ["Discovery"],
    security: [{ bearerAuth: [] }],
    middleware: [requireScope("jobs", "read"), requireAdmin],
    request: { query: listQuery },
    responses: {
      200: { content: json(DiscoveryList), description: "Candidates" },
      ...errors(400, 401, 403),
    },
  }),
  async (c) => {
    const { status, cursor } = c.req.valid("query");
    const db = drizzle(c.env.DB);
    return c.json(await svc.list(db, { status, cursor }), 200);
  },
);

discoveryApi.openapi(
  createRoute({
    method: "post",
    path: "/discovery",
    tags: ["Discovery"],
    security: [{ bearerAuth: [] }],
    middleware: [requireScope("jobs", "write"), requireAdmin],
    request: { body: { content: json(DiscoveryAdd), required: true } },
    responses: {
      200: { content: json(DiscoveryAddResult), description: "Added count" },
      ...errors(400, 401, 403),
    },
  }),
  async (c) => {
    const { domains } = c.req.valid("json");
    const db = drizzle(c.env.DB);
    return c.json({ data: { added: await svc.addDomains(db, domains) } }, 200);
  },
);
