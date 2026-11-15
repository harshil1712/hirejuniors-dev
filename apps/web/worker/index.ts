import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { SPA_CSP } from "./security-headers";
import { requestId } from "hono/request-id";
import { authRateLimit } from "./middleware/rate-limit";
import { createAuth } from "./auth";
import { publicConfigRoutes } from "./routes/public-config";
import { meRoutes } from "./routes/me";
import { sessionPrincipal } from "./middleware/principal";
import { api, type ApiRoutes } from "./api";

const app = new Hono<{ Bindings: Env }>();

// Request id first — the error handler and every route can read it.
app.use("*", requestId());

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

// Session-authenticated dashboard APIs for the web app.
for (const name of ["jobs", "companies", "sources", "runs", "dashboard", "discovery"]) {
  app.use(`/api/${name}`, sessionPrincipal);
  app.use(`/api/${name}/*`, sessionPrincipal);
}
app.route("/api", api);

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

export type { ApiRoutes };
export default app;
