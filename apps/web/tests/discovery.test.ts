/// <reference types="@cloudflare/vitest-plugin/types" />
import { SELF } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vite-plus/test";
import { discoveryRoutes } from "../worker/routes/discovery";
import { migrate } from "./helpers";

describe("/.well-known/api-catalog", () => {
  beforeAll(migrate);

  it("default app (publicSpec: false) → plain 404", async () => {
    const r = await SELF.fetch("https://x/.well-known/api-catalog");
    expect(r.status).toBe(404);
  });

  it("publicSpec: true → linkset body + content-type; HEAD has Link", async () => {
    const app = discoveryRoutes({ publicSpec: true });
    const r = await app.request("https://x/.well-known/api-catalog");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/linkset+json");
    const body = (await r.json()) as {
      linkset: {
        anchor: string;
        "service-desc": { href: string; type: string }[];
      }[];
    };
    expect(body.linkset[0].anchor).toBe("https://x/api/v1");
    expect(body.linkset[0]["service-desc"][0].href).toBe("https://x/api/v1/openapi.json");
    expect(body.linkset[0]["service-desc"][0].type).toContain("openapi");

    const head = await app.request("https://x/.well-known/api-catalog", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("link")).toBe('<https://x/.well-known/api-catalog>; rel="api-catalog"');
  });
});
