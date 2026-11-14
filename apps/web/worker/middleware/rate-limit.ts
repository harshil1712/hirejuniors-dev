import { createMiddleware } from "hono/factory";
import { PRODUCT } from "../../src/config";
import { errorJson } from "../api/errors";
import type { PrincipalVars } from "./principal";

/**
 * Per-IP throttle on auth mutations — Better Auth credential endpoints are
 * the brute-force surface. Keyed by cf-connecting-ip; "unknown" bucket for
 * local/test requests without the header.
 */
export const authRateLimit = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const key = c.req.header("cf-connecting-ip") ?? "unknown";
  const { success } = await c.env.RATE_LIMITER.limit({ key });
  if (!success) return c.json({ error: "too many requests" }, 429);
  await next();
});

/**
 * Per-key throttle for /api/v1 and /mcp (spec §4.4). The CF RateLimit binding
 * only returns { success }, so we advertise the policy — never counters.
 * No-op without a key principal (public openapi.json, session-only contexts).
 */
export const apiKeyRateLimit = createMiddleware<{
  Bindings: Env;
  Variables: PrincipalVars;
}>(async (c, next) => {
  const keyId = c.get("principal")?.keyId;
  if (!keyId) {
    await next();
    return;
  }
  const { success } = await c.env.API_RATE_LIMITER.limit({ key: keyId });
  c.header("RateLimit-Limit", String(PRODUCT.api.rateLimitPerMinute));
  c.header("RateLimit-Policy", `${PRODUCT.api.rateLimitPerMinute};w=60`);
  if (!success) {
    c.header("Retry-After", "60");
    return errorJson(c, 429, "rate_limited", "Rate limit exceeded — slow down and retry shortly.");
  }
  await next();
});
