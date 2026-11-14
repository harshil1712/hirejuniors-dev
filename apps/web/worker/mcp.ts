import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { env } from "cloudflare:workers";
import { user } from "../schema/db";
import { PRODUCT } from "../src/config";
import { hasScope, type Principal, type Scope } from "./middleware/principal";
import * as svc from "./services/projects";
import { ServiceError } from "./services/projects";
import {
  Project,
  ProjectCreate,
  ProjectListQuery,
  ProjectPatchFields,
  Scope as ScopeSchema,
} from "./api/schemas";

const text = (t: string) => [{ type: "text" as const, text: t }];

type Db = DrizzleD1Database;

function fail(code: string, message: string) {
  return {
    isError: true,
    content: text(`${code}: ${message}`),
    structuredContent: { error: { code, message } },
  };
}

const PROJECT_ID = z.string().describe("Project id, prj_…");

type ToolResult = {
  isError?: boolean;
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
};

/** Scope check → fn → ServiceError / unexpected (logged) error envelopes.
 * `A` is whatever the tool's inputSchema parses args into. */
function guarded<A>(
  principal: Principal,
  tool: string,
  action: "read" | "write",
  fn: (args: A) => Promise<ToolResult>,
) {
  return async (args: A): Promise<ToolResult> => {
    const denied = needScope(principal, action);
    if (denied) return denied;
    try {
      return await fn(args);
    } catch (e) {
      if (e instanceof ServiceError) return fail(e.code, e.message);
      console.error(
        JSON.stringify({
          level: "error",
          tool,
          message: e instanceof Error ? e.message : String(e),
        }),
      );
      return fail("internal", "Unexpected error");
    }
  };
}

function needScope(principal: Principal, action: "read" | "write") {
  return hasScope(principal.scopes, "projects", action)
    ? null
    : fail("insufficient_scope", `This API key lacks the projects:${action} scope`);
}

/** MCP server exposing the Projects resource (spec §6.2). One instance per
 * request — tools always act as the key's owner via `principal`. */
export function createServer(principal: Principal, db: Db) {
  const server = new McpServer(
    { name: PRODUCT.name, version: "1.0.0" },
    {
      instructions: `${PRODUCT.name} API for agents and scripts. Manage projects — project ids look like "prj_…" and always come back in list/create responses, never invent them.`,
    },
  );

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Returns the identity this API key belongs to: user id, email, name and granted scopes. Use to verify connectivity and what the key can do.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        userId: z.string(),
        email: z.string(),
        name: z.string(),
        scopes: z.array(ScopeSchema),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    async () => {
      const owner = await db
        .select({ email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, principal.userId))
        .get();
      const data = {
        userId: principal.userId,
        email: owner?.email ?? "",
        name: owner?.name ?? "",
        scopes: principal.scopes,
      };
      return {
        content: text(`${data.email} (scopes: ${data.scopes.join(", ") || "none"})`),
        structuredContent: data,
      };
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "Lists the caller's projects, newest first. Use to find a project id (prj_…) before get/update/delete. Pass nextCursor from a previous response to page further.",
      inputSchema: ProjectListQuery,
      outputSchema: z.object({
        projects: z.array(Project),
        nextCursor: z.string().nullable(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    guarded(principal, "list_projects", "read", async (args) => {
      const { items, nextCursor } = await svc.list(
        db,
        principal.userId,
        args as Parameters<typeof svc.list>[2],
      );
      return {
        content: text(`${items.length} project(s)${nextCursor ? ", more pages" : ""}`),
        structuredContent: { projects: items, nextCursor },
      };
    }),
  );

  server.registerTool(
    "get_project",
    {
      title: "Get a project",
      description: "Gets one project by its id (prj_…). Use when you already know the id.",
      inputSchema: z.object({ id: PROJECT_ID }),
      outputSchema: z.object({ project: Project }),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    guarded(principal, "get_project", "read", async ({ id }) => {
      const project = await svc.get(db, principal.userId, id as string);
      return {
        content: text(`${project.name} (${project.status})`),
        structuredContent: { project },
      };
    }),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create a project",
      description:
        "Creates a project for the caller. status defaults to active; name is required (1–80 chars). Returns the new project including its prj_… id.",
      inputSchema: ProjectCreate,
      outputSchema: z.object({ project: Project }),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false },
    },
    guarded(principal, "create_project", "write", async (input) => {
      const project = await svc.create(
        db,
        principal.userId,
        input as Parameters<typeof svc.create>[2],
      );
      return {
        content: text(`Created ${project.name} (${project.id})`),
        structuredContent: { project },
      };
    }),
  );

  server.registerTool(
    "update_project",
    {
      title: "Update a project",
      description:
        "Updates name, status or notes of the project with the given id (prj_…). Fields not passed stay unchanged.",
      inputSchema: ProjectPatchFields.extend({ id: PROJECT_ID }),
      outputSchema: z.object({ project: Project }),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
    },
    guarded(principal, "update_project", "write", async ({ id, ...patch }) => {
      const project = await svc.update(
        db,
        principal.userId,
        id as string,
        patch as Parameters<typeof svc.update>[3],
      );
      return { content: text(`Updated ${project.name}`), structuredContent: { project } };
    }),
  );

  server.registerTool(
    "delete_project",
    {
      title: "Delete a project",
      description:
        "Permanently deletes the project with the given id (prj_…). Only call when the user asked for deletion.",
      inputSchema: z.object({ id: PROJECT_ID }),
      outputSchema: z.object({ deleted: z.literal(true), id: z.string() }),
      annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true },
    },
    guarded(principal, "delete_project", "write", async ({ id }) => {
      await svc.remove(db, principal.userId, id as string);
      return {
        content: text(`Deleted ${id as string}`),
        structuredContent: { deleted: true as const, id: id as string },
      };
    }),
  );

  return server;
}

interface AuthInfoLike {
  token?: string;
  clientId?: string | null;
  scopes?: string[];
  extra?: { userId?: string };
}

export function principalFromAuthInfo(authInfo: AuthInfoLike | undefined): Principal {
  return {
    userId: authInfo?.extra?.userId ?? "",
    keyId: authInfo?.clientId ?? null,
    scopes: (authInfo?.scopes ?? []) as Scope[],
  };
}

/** Stateless Streamable-HTTP handler — a fresh server per request, so tools
 * always act as the key's owner. */
export const mcpHandler = createMcpHandler((ctx) =>
  createServer(
    principalFromAuthInfo(ctx.authInfo as AuthInfoLike | undefined),
    drizzle((env as Env).DB),
  ),
);
