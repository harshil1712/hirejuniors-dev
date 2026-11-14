/// <reference types="@cloudflare/vitest-plugin/types" />
import { SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { migrate, verifiedSessionCookie } from "./helpers";

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
  project?: { id: string; name: string; status: string };
  projects?: { id: string }[];
  error?: { code: string; message: string };
}

async function makeKey(email: string, scopes: string[]) {
  const cookie = await verifiedSessionCookie(email);
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

  it("SDK client (2026 protocol): tools/list → 6 tools + annotations; whoami", async () => {
    const key = await makeKey(`mcp1-${crypto.randomUUID()}@t.dev`, [
      "projects:read",
      "projects:write",
    ]);
    const { client, transport } = await connect(key);
    {
      expect(transport.protocolVersion).toBe("2026-07-28");

      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(
        [
          "create_project",
          "delete_project",
          "get_project",
          "list_projects",
          "update_project",
          "whoami",
        ].sort(),
      );
      const ann = (n: string) =>
        (tools.find((t) => t.name === n)!.annotations ?? {}) as ToolAnnotations;
      expect(ann("list_projects")).toMatchObject({ readOnlyHint: true, idempotentHint: true });
      expect(ann("get_project")).toMatchObject({ readOnlyHint: true, idempotentHint: true });
      expect(ann("whoami")).toMatchObject({ readOnlyHint: true, idempotentHint: true });
      expect(ann("create_project")).toMatchObject({ destructiveHint: false });
      expect(ann("update_project")).toMatchObject({ idempotentHint: true, destructiveHint: false });
      expect(ann("delete_project")).toMatchObject({ destructiveHint: true });
      for (const t of tools) expect(t.outputSchema).toBeTruthy();

      const me = await client.callTool({ name: "whoami", arguments: {} });
      const sc = me.structuredContent as CallContent;
      expect(sc.userId).toBeTruthy();
      expect(sc.email).toContain("@t.dev");
      expect(sc.scopes).toEqual(["projects:read", "projects:write"]);
    }
  });

  it("SDK client: project round-trip; read-only key gets insufficient_scope", async () => {
    const key = await makeKey(`mcp2-${crypto.randomUUID()}@t.dev`, [
      "projects:read",
      "projects:write",
    ]);
    const { client } = await connect(key);
    {
      const created = await client.callTool({
        name: "create_project",
        arguments: { name: "Via MCP" },
      });
      const project = (created.structuredContent as CallContent).project!;
      expect(project.id).toMatch(/^prj_/);

      const got = await client.callTool({ name: "get_project", arguments: { id: project.id } });
      expect((got.structuredContent as CallContent).project!.name).toBe("Via MCP");

      const patched = await client.callTool({
        name: "update_project",
        arguments: { id: project.id, status: "paused" },
      });
      expect((patched.structuredContent as CallContent).project!.status).toBe("paused");

      const listed = await client.callTool({ name: "list_projects", arguments: { limit: 10 } });
      expect((listed.structuredContent as CallContent).projects!.map((p) => p.id)).toContain(
        project.id,
      );

      await client.callTool({ name: "delete_project", arguments: { id: project.id } });
      const gone = await client.callTool({ name: "get_project", arguments: { id: project.id } });
      expect(gone.isError).toBe(true);
      expect((gone.structuredContent as CallContent).error!.code).toBe("not_found");
    }

    const { client: ro } = await connect(
      await makeKey(`mcp3-${crypto.randomUUID()}@t.dev`, ["projects:read"]),
    );
    {
      const denied = await ro.callTool({ name: "create_project", arguments: { name: "nope" } });
      expect(denied.isError).toBe(true);
      expect((denied.structuredContent as CallContent).error!.code).toBe("insufficient_scope");
      const ok = await ro.callTool({ name: "list_projects", arguments: { limit: 5 } });
      expect(ok.isError).toBeUndefined();
    }
  });

  it("2025-era raw initialize (legacy clients) + RateLimit header on keyed calls", async () => {
    const key = await makeKey(`mcp4-${crypto.randomUUID()}@t.dev`, ["projects:read"]);
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
