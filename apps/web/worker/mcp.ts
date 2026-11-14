import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { env } from "cloudflare:workers";
import { user } from "../schema/db";
import { PRODUCT } from "../src/config";
import { hasScope, type Principal, type Scope } from "./middleware/principal";
import * as jobsSvc from "./services/jobs";
import * as companiesSvc from "./services/companies";
import * as sourcesSvc from "./services/sources";
import * as runsSvc from "./services/runs";
import { ServiceError } from "./services/errors";
import {
  Company,
  CompanyCreate,
  IngestRun,
  Job,
  JobListQuery,
  Source,
  SourcePatchFields,
  SourcePlatform,
  SourceRun,
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

const ID = (prefix: string) => z.string().describe(`id, ${prefix}…`);

type ToolResult = {
  isError?: boolean;
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
};

/** Admin → scope check → fn → ServiceError / unexpected (logged) error
 * envelopes. `A` is whatever the tool's inputSchema parses args into. */
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
  if (!principal.isAdmin) return fail("forbidden", "Admin access required");
  return hasScope(principal.scopes, "jobs", action)
    ? null
    : fail("insufficient_scope", `This API key lacks the jobs:${action} scope`);
}

/** MCP server exposing the ingest dashboard (admin-only). One instance per
 * request — tools always act as the key's owner via `principal`. */
export function createServer(principal: Principal, db: Db) {
  const server = new McpServer(
    { name: PRODUCT.name, version: "1.0.0" },
    {
      instructions: `${PRODUCT.name} API for agents and scripts. Browse and moderate job listings, manage ingest sources, and inspect/trigger ingest runs — ids look like "job_…", "src_…", "cmp_…", "run_…" and always come back in list/get responses, never invent them.`,
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

  const readOnly = { readOnlyHint: true, idempotentHint: true, destructiveHint: false };
  const writing = { readOnlyHint: false, idempotentHint: false, destructiveHint: false };

  server.registerTool(
    "list_jobs",
    {
      title: "List jobs",
      description:
        "Lists job listings, newest first. Filter by status (default active), level, country (alpha-2), companyId, sourceId, or q (title contains). Pass nextCursor to page further.",
      inputSchema: JobListQuery,
      outputSchema: z.object({ jobs: z.array(Job), nextCursor: z.string().nullable() }),
      annotations: readOnly,
    },
    guarded(principal, "list_jobs", "read", async (args) => {
      const { items, nextCursor } = await jobsSvc.list(
        db,
        args as Parameters<typeof jobsSvc.list>[1],
      );
      return {
        content: text(`${items.length} job(s)${nextCursor ? ", more pages" : ""}`),
        structuredContent: { jobs: items, nextCursor },
      };
    }),
  );

  server.registerTool(
    "get_job",
    {
      title: "Get a job",
      description: "Gets one job listing by its id (job_…).",
      inputSchema: z.object({ id: ID("job_") }),
      outputSchema: z.object({ job: Job }),
      annotations: readOnly,
    },
    guarded(principal, "get_job", "read", async ({ id }) => {
      const job = await jobsSvc.get(db, id as string);
      return {
        content: text(`${job.title} @ ${job.company.name} (${job.status})`),
        structuredContent: { job },
      };
    }),
  );

  server.registerTool(
    "set_job_status",
    {
      title: "Set job status",
      description:
        "Retires a job (reason 'manual', sticky — ingest won't reactivate it) or restores it to active (clears retired_at/reason and missed_runs).",
      inputSchema: z.object({ id: ID("job_"), status: z.enum(["active", "retired"]) }),
      outputSchema: z.object({ job: Job }),
      annotations: { ...writing, idempotentHint: true },
    },
    guarded(principal, "set_job_status", "write", async ({ id, status }) => {
      const job = await jobsSvc.setStatus(db, id as string, status as "active" | "retired");
      return {
        content: text(`${job.title} → ${job.status}`),
        structuredContent: { job },
      };
    }),
  );

  server.registerTool(
    "list_companies",
    {
      title: "List companies",
      description: "Lists all companies, name order.",
      inputSchema: z.object({}),
      outputSchema: z.object({ companies: z.array(Company) }),
      annotations: readOnly,
    },
    guarded(principal, "list_companies", "read", async () => {
      const companies = await companiesSvc.list(db);
      return {
        content: text(`${companies.length} compan(ies)`),
        structuredContent: { companies },
      };
    }),
  );

  server.registerTool(
    "create_company",
    {
      title: "Create a company",
      description:
        "Creates a company. slug is derived from name when omitted; a duplicate slug returns a conflict error. Returns the new company including its cmp_… id.",
      inputSchema: CompanyCreate,
      outputSchema: z.object({ company: Company }),
      annotations: writing,
    },
    guarded(principal, "create_company", "write", async (input) => {
      const company = await companiesSvc.create(
        db,
        input as Parameters<typeof companiesSvc.create>[1],
      );
      return {
        content: text(`Created ${company.name} (${company.id})`),
        structuredContent: { company },
      };
    }),
  );

  server.registerTool(
    "list_sources",
    {
      title: "List sources",
      description:
        "Lists all ingest sources with their company, last run result and active job count.",
      inputSchema: z.object({}),
      outputSchema: z.object({ sources: z.array(Source) }),
      annotations: readOnly,
    },
    guarded(principal, "list_sources", "read", async () => {
      const sources = await sourcesSvc.list(db);
      return {
        content: text(`${sources.length} source(s)`),
        structuredContent: { sources },
      };
    }),
  );

  const sourceFields = z.object({
    platform: SourcePlatform.describe("one of greenhouse | lever | ashby | amazon_jobs"),
    board: z.string().describe("Board token / site / board name ('amazon' for amazon_jobs)"),
    config: z
      .string()
      .default("{}")
      .describe("Platform-specific config as a JSON string, e.g. '{}'"),
    includeAll: z
      .boolean()
      .default(false)
      .describe("Keep every listing (board already early-career only)"),
  });

  server.registerTool(
    "create_source",
    {
      title: "Create a source",
      description:
        "Creates an ingest source for a company. config is validated against the platform's adapter; a duplicate (platform, board) returns a conflict error.",
      inputSchema: sourceFields.extend({
        companyId: ID("cmp_"),
        enabled: z.boolean().default(true),
      }),
      outputSchema: z.object({ source: Source }),
      annotations: writing,
    },
    guarded(principal, "create_source", "write", async (input) => {
      const created = await sourcesSvc.create(db, input as Parameters<typeof sourcesSvc.create>[1]);
      return {
        content: text(`Created ${created.platform}/${created.board} (${created.id})`),
        structuredContent: { source: created },
      };
    }),
  );

  server.registerTool(
    "update_source",
    {
      title: "Update a source",
      description:
        "Updates board, config, includeAll or enabled of the source with the given id (src_…). There is no delete — disabling is the off switch.",
      inputSchema: SourcePatchFields.extend({ id: ID("src_") }),
      outputSchema: z.object({ source: Source }),
      annotations: { ...writing, idempotentHint: true },
    },
    guarded(principal, "update_source", "write", async ({ id, ...patch }) => {
      const updated = await sourcesSvc.update(
        db,
        id as string,
        patch as Parameters<typeof sourcesSvc.update>[2],
      );
      return {
        content: text(`Updated ${updated.platform}/${updated.board}`),
        structuredContent: { source: updated },
      };
    }),
  );

  server.registerTool(
    "preview_source",
    {
      title: "Preview a source",
      description:
        "Dry run against the live platform API: fetches listings and classifies them exactly like ingest, but writes nothing. Returns fetched/kept counts and a sample.",
      inputSchema: sourceFields,
      outputSchema: z.object({
        fetched: z.number().int(),
        kept: z.number().int(),
        sample: z.array(
          z.object({
            title: z.string(),
            level: z.string().nullable(),
            locationRaw: z.string(),
            countryCode: z.string().nullable(),
          }),
        ),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
    },
    guarded(principal, "preview_source", "write", async (input) => {
      const result = await sourcesSvc.preview(
        input as Parameters<typeof sourcesSvc.preview>[0],
        fetch.bind(globalThis),
      );
      return {
        content: text(`${result.kept}/${result.fetched} listing(s) would be kept`),
        structuredContent: result,
      };
    }),
  );

  server.registerTool(
    "list_runs",
    {
      title: "List ingest runs",
      description: "Lists ingest runs, latest first. Pass nextCursor to page further.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().optional(),
      }),
      outputSchema: z.object({ runs: z.array(IngestRun), nextCursor: z.string().nullable() }),
      annotations: readOnly,
    },
    guarded(principal, "list_runs", "read", async (args) => {
      const { items, nextCursor } = await runsSvc.list(
        db,
        args as Parameters<typeof runsSvc.list>[1],
      );
      return {
        content: text(`${items.length} run(s)${nextCursor ? ", more pages" : ""}`),
        structuredContent: { runs: items, nextCursor },
      };
    }),
  );

  server.registerTool(
    "get_run",
    {
      title: "Get an ingest run",
      description: "Gets one ingest run (run_…) with its per-source rows and errors.",
      inputSchema: z.object({ id: ID("run_") }),
      outputSchema: z.object({ run: IngestRun.extend({ sourceRuns: z.array(SourceRun) }) }),
      annotations: readOnly,
    },
    guarded(principal, "get_run", "read", async ({ id }) => {
      const run = await runsSvc.get(db, id as string);
      return {
        content: text(`Run ${run.id} ${run.status}, ${run.sourceRuns.length} source(s)`),
        structuredContent: { run },
      };
    }),
  );

  server.registerTool(
    "trigger_run",
    {
      title: "Trigger an ingest run",
      description:
        "Starts a manual ingest run via the jobs workflow. Returns the workflow instance id. Fails with 'unavailable' when the binding isn't configured.",
      inputSchema: z.object({}),
      outputSchema: z.object({ instanceId: z.string() }),
      annotations: writing,
    },
    guarded(principal, "trigger_run", "write", async () => {
      const { instanceId } = await runsSvc.trigger(env as Env);
      return {
        content: text(`Started ingest run ${instanceId}`),
        structuredContent: { instanceId },
      };
    }),
  );

  return server;
}

interface AuthInfoLike {
  token?: string;
  clientId?: string | null;
  scopes?: string[];
  extra?: { userId?: string; isAdmin?: boolean };
}

export function principalFromAuthInfo(authInfo: AuthInfoLike | undefined): Principal {
  return {
    userId: authInfo?.extra?.userId ?? "",
    keyId: authInfo?.clientId ?? null,
    scopes: (authInfo?.scopes ?? []) as Scope[],
    isAdmin: authInfo?.extra?.isAdmin === true,
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
