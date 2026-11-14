/// <reference types="@cloudflare/vitest-plugin/types" />
import { SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  migrate,
  verifiedSessionCookie,
  adminSessionCookie,
  seedCompany,
  seedSource,
  seedJob,
} from "./helpers";

interface ToolAnnotations {
  readOnlyHint?: boolean;
  idempotentHint?: boolean;
  destructiveHint?: boolean;
}
interface CallContent {
  userId?: string;
  email?: string;
  name?: string;
  scopes?: string[];
  job?: { id: string; status: string; retireReason: string | null };
  jobs?: { id: string }[];
  error?: { code: string; message: string };
}

async function makeKey(email: string, scopes: string[], admin = true) {
  const cookie = await (admin ? adminSessionCookie(email) : verifiedSessionCookie(email));
  const r = await SELF.fetch("https://x/api/api-keys", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "mcp", scopes, expiresInDays: 30 }),
  });
  return (await r.json<{ data: { key: string } }>()).data.key;
}

/** Official SDK client against the worker via the test fetch. */
async function connect(key: string) {
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  const transport = new StreamableHTTPClientTransport(new URL("https://x/mcp"), {
    fetch: SELF.fetch.bind(SELF),
    requestInit: { headers: { authorization: `Bearer ${key}` } },
  });
  await client.connect(transport);
  return { client, transport };
}

const RAW_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

describe("/mcp", () => {
  beforeAll(migrate);

  it("401 without key (+WWW-Authenticate); OPTIONS preflight ok without key", async () => {
    const r = await SELF.fetch("https://x/mcp", {
      method: "POST",
      headers: RAW_HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe("Bearer");

    const preflight = await SELF.fetch("https://x/mcp", {
      method: "OPTIONS",
      headers: { origin: "https://agent.example", "access-control-request-method": "POST" },
    });
    expect(preflight.status).toBeLessThan(300);
    expect(preflight.headers.get("access-control-allow-origin")).toBeTruthy();
  });

  it("SDK client (2026 protocol): tools/list → 13 tools + annotations; whoami", async () => {
    const key = await makeKey(`mcp1-${crypto.randomUUID()}@t.dev`, ["jobs:read", "jobs:write"]);
    const { client, transport } = await connect(key);
    {
      expect(transport.protocolVersion).toBe("2026-07-28");

      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(
        [
          "create_company",
          "create_source",
          "get_job",
          "get_run",
          "list_companies",
          "list_jobs",
          "list_runs",
          "list_sources",
          "preview_source",
          "set_job_status",
          "trigger_run",
          "update_source",
          "whoami",
        ].sort(),
      );
      const ann = (n: string) =>
        (tools.find((t) => t.name === n)!.annotations ?? {}) as ToolAnnotations;
      for (const n of [
        "list_jobs",
        "get_job",
        "list_sources",
        "list_companies",
        "list_runs",
        "get_run",
        "whoami",
      ]) {
        expect(ann(n)).toMatchObject({ readOnlyHint: true, idempotentHint: true });
      }
      expect(ann("set_job_status")).toMatchObject({ idempotentHint: true });
      expect(ann("create_company")).toMatchObject({ destructiveHint: false });
      for (const t of tools) expect(t.outputSchema).toBeTruthy();

      const me = await client.callTool({ name: "whoami", arguments: {} });
      const sc = me.structuredContent as CallContent;
      expect(sc.userId).toBeTruthy();
      expect(sc.email).toContain("@t.dev");
      expect(sc.scopes).toEqual(["jobs:read", "jobs:write"]);
    }
  });

  it("SDK client: list_jobs + set_job_status; scope denial; non-admin forbidden", async () => {
    const key = await makeKey(`mcp2-${crypto.randomUUID()}@t.dev`, ["jobs:read", "jobs:write"]);
    const { id: cid } = await seedCompany({ name: "MCP Co" });
    const sid = await seedSource(cid);
    const jid = await seedJob(sid, cid);

    const { client } = await connect(key);
    {
      const listed = await client.callTool({
        name: "list_jobs",
        arguments: { sourceId: sid, limit: 10 },
      });
      expect((listed.structuredContent as CallContent).jobs!.map((j) => j.id)).toContain(jid);

      const set = await client.callTool({
        name: "set_job_status",
        arguments: { id: jid, status: "retired" },
      });
      const updated = (set.structuredContent as CallContent).job!;
      expect(updated.status).toBe("retired");
      expect(updated.retireReason).toBe("manual");
    }

    const { client: ro } = await connect(
      await makeKey(`mcp3-${crypto.randomUUID()}@t.dev`, ["jobs:read"]),
    );
    {
      const denied = await ro.callTool({
        name: "set_job_status",
        arguments: { id: jid, status: "active" },
      });
      expect(denied.isError).toBe(true);
      expect((denied.structuredContent as CallContent).error!.code).toBe("insufficient_scope");
      const ok = await ro.callTool({ name: "list_jobs", arguments: { limit: 5 } });
      expect(ok.isError).toBeUndefined();
    }

    // A non-admin's key is refused even with the right scopes.
    const { client: na } = await connect(
      await makeKey(`mcp4n-${crypto.randomUUID()}@t.dev`, ["jobs:read"], false),
    );
    {
      const denied = await na.callTool({ name: "list_jobs", arguments: {} });
      expect(denied.isError).toBe(true);
      expect((denied.structuredContent as CallContent).error!.code).toBe("forbidden");
    }
  });

  it("2025-era raw initialize (legacy clients) + RateLimit header on keyed calls", async () => {
    const key = await makeKey(`mcp4-${crypto.randomUUID()}@t.dev`, ["jobs:read"]);
    const headers = new Headers(RAW_HEADERS);
    headers.set("authorization", `Bearer ${key}`);
    const r = await SELF.fetch("https://x/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "legacy-test", version: "1" },
        },
      }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("ratelimit-limit")).toBe("120");
    const ct = r.headers.get("content-type") ?? "";
    const body = ct.includes("text/event-stream")
      ? JSON.parse(
          (await r.text())
            .split("\n")
            .find((l: string) => l.startsWith("data:"))!
            .slice(5),
        )
      : await r.json<{ result?: { protocolVersion: string; serverInfo: { name: string } } }>();
    const result = (body as { result: { protocolVersion: string; serverInfo: { name: string } } })
      .result;
    expect(result.protocolVersion).toBeTruthy();
    expect(result.serverInfo.name).toBe("Hire Juniors");
  });
});
