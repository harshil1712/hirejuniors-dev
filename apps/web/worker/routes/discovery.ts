import { Hono } from "hono";

/**
 * RFC 9727 api-catalog — advertises the public OpenAPI document so tooling
 * can find it without being told. Served only when `publicSpec` is on: a
 * private spec is never advertised, so the catalog is a plain 404.
 */
export function discoveryRoutes({ publicSpec }: { publicSpec: boolean }) {
  const app = new Hono();

  app.on(["GET", "HEAD"], "/.well-known/api-catalog", (c) => {
    if (!publicSpec) return c.notFound();
    const origin = new URL(c.req.url).origin;
    if (c.req.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { link: `<${origin}/.well-known/api-catalog>; rel="api-catalog"` },
      });
    }
    return c.json(
      {
        linkset: [
          {
            anchor: `${origin}/api/v1`,
            "service-desc": [
              {
                href: `${origin}/api/v1/openapi.json`,
                type: "application/vnd.oai.openapi+json;version=3.1",
              },
            ],
          },
        ],
      },
      200,
      { "content-type": "application/linkset+json" },
    );
  });

  return app;
}
