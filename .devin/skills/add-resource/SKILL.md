---
name: add-resource
description: Add a new resource end to end — Drizzle schema and migration, zod schemas, service, session /api routes, UI, tests. Use Sources as the worked reference.
---

# Add a resource end to end

One service layer backs the session-authenticated `/api/<name>` routers. The dashboard is admin-only: every resource route requires `principal.isAdmin`. Sources (`src_…`) is the reference implementation; mirror its files.

## Steps, in order

1. **Schema** — `packages/db/src/schema.ts`: `sqliteTable` with `<prefix>_`-prefixed `nanoid(16)` id, timestamp_ms `$defaultFn`s, the unique indexes the resource needs. Re-export via `apps/web/schema/db.ts`.
2. **Migration** — hand-write `packages/db/migrations/000N_<name>.sql` to match exactly (drizzle-kit generate is broken — see `migrations/README.md`). Tests apply real migrations via `applyD1Migrations`, so a mismatch fails there.
3. **Zod schemas** — `worker/api/schemas.ts`: request schemas only — `…Create`, `…Update` (field object + `.refine` non-empty), `…ListQuery`. Response types are inferred from the service.
4. **Service** — `worker/services/<name>.ts`: pure Drizzle, `ServiceError` (`not_found` | `conflict` | `validation_failed` | `upstream_failed` | `unavailable`), keyset pagination (`limit+1`, base64url `${ms}:${id}` cursor).
5. **Router** — `worker/api/<name>.ts`: one plain `Hono` router with **chained** routes (types flow to `hono/client`), per-route `requireAdmin` + `zValidator(…, validationHook)`, `onApiError`, **no auth inside**. Add it to `worker/api/index.ts` (`ApiRoutes`) and mount `sessionPrincipal` for `/api/<name>` + `/api/<name>/*` in index.ts.
6. **UI** — `src/routes/_authed/<name>.tsx` + nav item in `src/components/nav.ts`: `kumo-ui` (Kumo components only, Phosphor icons, no `dark:` classes), loader + `router.invalidate()`, calls in `src/lib/admin-api.ts` via the typed `hc<ApiRoutes>` client (`request()` throws the envelope message).
7. **Tests** — mirror `tests/jobs.test.ts` (401/403, CRUD, envelopes, cursor).

## Gotchas (we hit these)

- **Middleware bleed**: `.use("*")` inside a sub-app merged at `/api` runs on ALL of `/api/*`. Use mount-level `app.use("/api/<x>", sessionPrincipal)`.
- **Admin gate**: `requireAdmin` is a route-level middleware. Non-admin → `forbidden`.
- **Verify**: `vp check` → `vp run -r test` → `vp run -r build`; UI work also needs `verify-ui` screenshots. Ship via `ship-pr`.
