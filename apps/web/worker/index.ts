import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { SPA_CSP } from "./security-headers";
import { requestId } from "hono/request-id";
import { requireOwner } from "./middleware/owner";
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

// Health is the only unauthenticated API route — registered before the
// owner gate below so its response wins.
app.get("/api/health", (c) => c.json({ status: "ok" }));

// Everything else under /api requires the Access-admitted owner identity
// (Cloudflare Access fronts the app — see `access` in alchemy.run.ts).
app.use("/api/*", requireOwner);
app.route("/api", api);

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

export type { ApiRoutes };
export default app;
