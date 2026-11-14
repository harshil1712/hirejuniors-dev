import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { SPA_CSP } from "./security-headers";
import { requestIdMiddleware } from "./middleware/request-id";
import { authRateLimit } from "./middleware/rate-limit";
import { createAuth } from "./auth";
import { publicConfigRoutes } from "./routes/public-config";
import { meRoutes } from "./routes/me";
import { PRODUCT } from "../src/config";
import { sessionPrincipal, requireApiKey } from "./middleware/principal";
import { apiKeyRateLimit } from "./middleware/rate-limit";
import { mcpHandler } from "./mcp";
import { errorJson } from "./api/errors";
import { projectsApi } from "./api/projects";
import { apiKeysApi } from "./api/api-keys";
import { createV1Api } from "./api/v1";
import { discoveryRoutes } from "./routes/discovery";

const app = new Hono<{ Bindings: Env }>();

// Request id first — the error handler and every route can read it.
app.use("*", requestIdMiddleware);

// Security headers on every response.
app.use(
  "*",
  secureHeaders({
    xFrameOptions: "DENY",
    referrerPolicy: "strict-origin-when-cross-origin",
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    permissionsPolicy: { camera: false, microphone: false, geolocation: false },
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  }),
);

// CSP as a raw header — secureHeaders' option shape doesn't take a full
// policy string, and SPA_CSP stays a single testable constant.
app.use("*", async (c, next) => {
  await next();
  c.header("Content-Security-Policy", SPA_CSP);
});

app.onError((err, c) => {
  // Log the real failure for operators — never echo internals to clients.
  console.error(
    JSON.stringify({
      level: "error",
      requestId: c.get("requestId"),
      path: c.req.path,
      method: c.req.method,
      message: err.message,
    }),
  );
  return c.json({ error: "Something went wrong. Please try again." }, 500);
});

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.route("/", publicConfigRoutes);
app.route("/", meRoutes);

// Session-authenticated Projects API for the web app — same router that
// /api/v1 mounts with API-key auth in a later checkpoint.
app.use("/api/projects", sessionPrincipal);
app.use("/api/projects/*", sessionPrincipal);
app.route("/api", projectsApi);

// Key management (Settings → API keys) — session-only router.
app.use("/api/api-keys", sessionPrincipal);
app.use("/api/api-keys/*", sessionPrincipal);
app.route("/api", apiKeysApi);

// Versioned agent API — API-key auth only (middleware inside the factory);
// cookies are never consulted.
app.route("/", createV1Api(PRODUCT.api));

// Unknown /api/v1 paths get the envelope 404 — Hono's sub-app notFound
// doesn't fire when the router is mounted.
app.all("/api/v1/*", (c) => errorJson(c, 404, "not_found", "No such endpoint"));

// RFC 9727 api-catalog — only served when PRODUCT.api.publicSpec.
app.route("/", discoveryRoutes(PRODUCT.api));

// MCP server (spec §6) — bearer-only, so open CORS is safe: no cookies ever.
app.use(
  "/mcp",
  cors({
    origin: "*",
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "Mcp-Protocol-Version",
      "Mcp-Session-Id",
      "Last-Event-ID",
    ],
    exposeHeaders: [
      "Mcp-Session-Id",
      "WWW-Authenticate",
      "RateLimit-Limit",
      "RateLimit-Policy",
      "Retry-After",
    ],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  }),
);
app.use("/mcp", requireApiKey);
app.use("/mcp", apiKeyRateLimit);
app.all("/mcp", (c) => {
  const principal = c.get("principal");
  return mcpHandler.fetch(c.req.raw, {
    authInfo: {
      token: c.req.header("authorization")!.slice("Bearer ".length),
      clientId: principal.keyId ?? "",
      scopes: principal.scopes,
      extra: { userId: principal.userId },
    },
  });
});

// Better Auth handler — catches all /api/auth/* requests (sign-in, sign-up,
// email verification, reset, admin plugin endpoints, OAuth callbacks).
// Mutations are IP-rate-limited (brute-force surface).
app.use("/api/auth/*", async (c, next) => {
  if (c.req.method === "POST") return authRateLimit(c, next);
  await next();
});
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const res = await createAuth(c.env).handler(c.req.raw);
  // Copy before mutation — the handler's response headers are immutable.
  return new Response(res.body, res);
});

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

export default app;
