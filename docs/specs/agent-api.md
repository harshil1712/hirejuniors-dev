# Spec: API keys, OpenAPI and MCP server

Status: draft for review · Owner: lead · Branch: `revamp/v2`

## 1. Goal

A product built from Hire Juniors can be used by AI agents and scripts on day one:

- **API keys** a user creates in Settings and revokes at any time.
- **A versioned HTTP API** described by an **OpenAPI 3.1** document, with a docs page.
- **A remote MCP server** at `/mcp` exposing the same operations as tools, authenticated with the same API keys.

Both surfaces run in the existing `apps/web` Worker and call one shared service layer, so they cannot drift.

## 2. Non-goals (this phase)

- OAuth / "Sign in with Hire Juniors" for agents (no `oauthProvider`, `@better-auth/mcp`, CIMD/DCR, device flow). Consequence: ChatGPT connectors and most Claude.ai web connectors can't connect yet (they require OAuth). Claude Code, Cursor, VS Code, Codex CLI, Windsurf, MCP Inspector and scripts work. The design keeps OAuth addable later without changing tools.
- Organizations/teams. Ownership is per user; the code takes an `ownerId` string so orgs can replace it later.
- Webhooks, idempotency keys, usage metering/billing, MCP registry publishing.
- An AI chat feature.

## 3. Demo resource: Projects

The template needs one real resource for the API, the tools and the UI to act on. It is deliberately generic so buyers rename it to their own domain.

| Field       | Type            | Notes                                                |
| ----------- | --------------- | ---------------------------------------------------- |
| `id`        | string          | `prj_` + nanoid(16), server-generated                |
| `name`      | string          | 1–80 chars, required                                 |
| `status`    | enum            | `active` \| `paused` \| `archived`, default `active` |
| `notes`     | string          | 0–2000 chars, default `""`                           |
| `createdAt` | ISO 8601 string | server-set                                           |
| `updatedAt` | ISO 8601 string | server-set                                           |

Storage: D1 table `project` (`id` PK, `owner_id` → `user.id` ON DELETE CASCADE, `name`, `status`, `notes`, `created_at`, `updated_at`; index on `(owner_id, updated_at DESC, id)`). Drizzle schema in `apps/web/schema/projects.ts`; hand-written migration `0002_projects.sql` (drizzle-kit generate is broken with the pinned versions, see `apps/web/migrations/README.md`).

## 4. Authentication and authorization

### 4.1 API keys

- Library: `@better-auth/api-key@1.7.12` (matches `better-auth@1.7.12`; ≥7 days old). Client: `apiKeyClient()`.
- Keys are shown **once** at creation; only a hash and a display prefix are stored. Prefix `hj_` (rewritten by `scripts/init.ts`).
- Transport: `Authorization: Bearer <key>` on both the HTTP API and MCP. No query-string keys.
- A key belongs to the user who created it (`referenceId` = user id). Users can list (name, prefix, created, last used, expiry, scopes) and revoke their own keys. Admins can't see other users' keys in this phase.
- Expiry choices at creation: 30 days, 90 days, 1 year, never.
- Schema: regenerate `src/auth-schema.ts` with `npm run auth:generate` after adding the plugin, then hand-write `0003_apikey.sql` to match the generated table exactly.

### 4.2 Scopes

| Scope            | Allows                                |
| ---------------- | ------------------------------------- |
| `projects:read`  | list, get                             |
| `projects:write` | create, update, delete (implies read) |

Stored in the key's `permissions` as `{ "projects": ["read", "write"] }`. Checked per route/tool in one helper (`requireScope("projects", "write")`). A request without the needed scope gets `403 insufficient_scope`.

### 4.3 Request flow

```
Authorization: Bearer hj_…
  → middleware requireApiKey: auth.api.verifyApiKey({ key })   (exact API verified at implementation)
  → 401 if missing/invalid/expired/revoked
  → c.set("principal", { userId, keyId, scopes })
  → route / MCP tool → requireScope → services/projects.*(db, principal.userId, …)
```

Session cookies are **not** accepted on `/api/v1/*` or `/mcp`; the web app keeps using its own session routes. This keeps the public surface single-auth and CSRF-free.

### 4.4 Rate limiting

- Existing per-IP `RATE_LIMITER` binding stays as the outer limit.
- Add a per-key limit on `/api/v1/*` and `/mcp` (Cloudflare RateLimit binding keyed by `keyId`, default 120 requests/minute, configurable in `project.config.ts`).
- Responses include `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; a limited request gets `429` with `Retry-After`.

## 5. HTTP API (`/api/v1`)

### 5.1 Endpoints

| Method | Path                                      | Scope                                              | Result                                             |
| ------ | ----------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| GET    | `/api/v1/me`                              | any valid key                                      | `{ data: { userId, email, name, keyId, scopes } }` |
| GET    | `/api/v1/projects?limit=&cursor=&status=` | `projects:read`                                    | `{ data: Project[], nextCursor: string \| null }`  |
| POST   | `/api/v1/projects`                        | `projects:write`                                   | `201 { data: Project }`                            |
| GET    | `/api/v1/projects/{id}`                   | `projects:read`                                    | `{ data: Project }`                                |
| PATCH  | `/api/v1/projects/{id}`                   | `projects:write`                                   | `{ data: Project }` (partial: name, status, notes) |
| DELETE | `/api/v1/projects/{id}`                   | `projects:write`                                   | `204`                                              |
| GET    | `/api/v1/openapi.json`                    | any valid key (public if `PROJECT.api.publicSpec`) | OpenAPI 3.1 document                               |

### 5.2 Conventions

- JSON only; `Content-Type: application/json` required on writes (`415` otherwise).
- Pagination: cursor-based, opaque base64 cursor of `(updatedAt, id)`; `limit` 1–100, default 20; newest first.
- Not found and not-yours both return `404 not_found` (no existence leaks).
- Error envelope, every non-2xx:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "name must be 1–80 characters",
    "requestId": "…",
    "details": [{ "path": "name", "message": "…" }]
  }
}
```

Codes: `unauthorized` (401), `insufficient_scope` (403), `not_found` (404), `validation_failed` (400), `unsupported_media_type` (415), `rate_limited` (429), `internal` (500). `requestId` comes from the existing request-id middleware.

### 5.3 OpenAPI generation

- `@hono/zod-openapi@1.6.3` (`OpenAPIHono`, `createRoute`); zod 4 is already in the repo.
- Schemas live once in `worker/api/schemas.ts` (`Project`, `ProjectCreate`, `ProjectUpdate`, `ProjectList`, `Error`) and are reused by the MCP tools.
- `app.doc31("/api/v1/openapi.json", …)` with `info` from `project.config.ts`, `servers: [{ url: https://app.<domain> }]`, a `bearerAuth` security scheme (`type: http, scheme: bearer`), tags, and examples on every schema.
- No docs UI is shipped; anyone with access can load the document into Scalar, Swagger UI or Postman. Better Auth's endpoints and the app's internal session routes are **never** in this document.
- Visibility: by default the document requires a valid API key (no scope). `project.config.ts` `api: { publicSpec: boolean }` (default `false`) makes it public. Discovery entries (§9) are only published when `publicSpec` is true, so a private spec is never advertised.

## 6. MCP server (`/mcp`)

### 6.1 Transport and packages

- `createMcpHandler` from `@modelcontextprotocol/server@2.3.1` (pinned exactly), Streamable HTTP, **stateless** (no Durable Object), mounted as a Hono route. It serves the newest protocol revision (`2026-07-28`) and 2025-era clients (`legacy: "stateless"`). Chosen over `agents`' `createMcpHandler` (a thin Host/Origin + CORS wrapper around the same SDK handler that adds esbuild/babel deps and a required v1-SDK peer; CORS comes from `hono/cors`), and over `@hono/mcp` (v1 SDK, latest `2025-11-25`, needs `hono-rate-limiter`).
- A fresh `McpServer` per request, built by `createServer(principal, env)`, so tools always act as the key's owner.
- Mounted in `worker/index.ts` before the `/api/*` catch-all, behind `requireApiKey`; unauthenticated requests get `401` with `WWW-Authenticate: Bearer`.

### 6.2 Tools

All tools return `structuredContent` matching `outputSchema` plus a short text summary in `content`. Inputs reuse the zod schemas from §5.3. Errors return `isError: true` with the same `code`/`message` as the HTTP API.

| Tool             | Scope | Input                                 | Output                                | Annotations                   |
| ---------------- | ----- | ------------------------------------- | ------------------------------------- | ----------------------------- |
| `whoami`         | any   | –                                     | `{ userId, email, name, scopes }`     | readOnly, idempotent          |
| `list_projects`  | read  | `{ status?, limit? (≤100), cursor? }` | `{ projects: Project[], nextCursor }` | readOnly, idempotent          |
| `get_project`    | read  | `{ id }`                              | `{ project }`                         | readOnly, idempotent          |
| `create_project` | write | `{ name, status?, notes? }`           | `{ project }`                         | not readOnly, not destructive |
| `update_project` | write | `{ id, name?, status?, notes? }`      | `{ project }`                         | idempotent, not destructive   |
| `delete_project` | write | `{ id }`                              | `{ deleted: true, id }`               | destructive, idempotent       |

Tool descriptions are written for agents: what it does, when to use it, what the id format is. Tools a key lacks the scope for are still listed (simpler, cacheable) but return `insufficient_scope`.

### 6.3 Client setup (shown in Settings → API keys)

```bash
claude mcp add --transport http hirejuniors https://app.<domain>/mcp \
  --header "Authorization: Bearer hj_…"
```

Plus copyable snippets for Cursor (`mcp.json` with `headers`) and Codex (`config.toml` `bearer_token_env_var`).

## 7. Shared service layer

`worker/services/projects.ts`, pure functions over Drizzle, no Hono/MCP types:

```ts
list(db, ownerId, { status?, limit, cursor? }): Promise<{ items: Project[]; nextCursor: string | null }>
get(db, ownerId, id): Promise<Project>          // throws ServiceError("not_found")
create(db, ownerId, input: ProjectCreate): Promise<Project>
update(db, ownerId, id, patch: ProjectUpdate): Promise<Project>
remove(db, ownerId, id): Promise<void>
```

`ServiceError { code, message, details? }` is translated to HTTP status in the API layer and to `isError` results in the MCP layer.

## 8. Web app UI

- **Projects page** (`/projects`, nav item): Kumo `Table` (name, status `StatusBadge`, notes preview, updated), "New project" `Dialog`, row `DropdownMenu` (edit, archive, delete with `ConfirmDialog`), `CrewEmpty` empty state. Uses session-authenticated internal routes (`/api/projects/*`) that call the same service layer.
- **Settings → API keys** (`SettingsSection`): list (name, `hj_…` prefix, scopes, created, last used, expires, revoke via `ConfirmDialog`); "Create key" `Dialog` (name, scopes checkboxes, expiry `Select`); show-once `Dialog` with `ClipboardText` and a warning, plus the client snippets from §6.3.
- Dashboard empty state links to Projects.
- Site: drop the "Coming soon" tags, put Projects back in the hero mock, update `llms.txt` "For agents" section.

## 9. Discovery

- Only when `PROJECT.api.publicSpec` is true: `llms.txt` (site) gains a "For agents" section linking `/api/v1/openapi.json` and `/mcp`, and the app serves `/.well-known/api-catalog` (RFC 9727 linkset) pointing at the OpenAPI document.
- `server.json` (MCP registry format) in the repo root for later publishing; not published in this phase.

## 10. Testing (vitest + `@cloudflare/vitest-plugin`, no `vi.mock`)

1. Keys: create via session → shown once; verify valid/invalid/revoked/expired; list/revoke own only.
2. Auth: `/api/v1/me` 401 without key, 401 bad key, 200 good key; session cookie alone is rejected.
3. Scopes: read-only key gets 403 on POST/PATCH/DELETE and on write tools.
4. Projects API: full create → list → get → update → delete; validation 400 envelope with `requestId`; another user's id → 404; pagination cursor round-trip.
5. OpenAPI: 401 without a key by default, 200 with any key, public when `publicSpec` is true; document is `openapi: 3.1.x`, contains every path, every operation has `bearerAuth`, validates against the OpenAPI 3.1 schema.
6. MCP (official client `@modelcontextprotocol/client@2.3.1` over HTTP): 401 without key; `tools/list` returns 6 tools with annotations; `create_project` then `list_projects` round-trip; `whoami`; scope error result.
7. Rate limit: per-key limit returns 429 with headers (test env lowers the limit).
8. UI: verify-ui gate (screenshots light/dark/mobile) for Projects and API keys; click-through of create/revoke/delete.

Manual: MCP Inspector (`npx @modelcontextprotocol/inspector`) and a real `claude mcp add` against `alchemy dev`.

## 11. Delivery plan (small, reviewed commits)

1. Projects: schema, migration, service, internal session routes, Projects page.
2. API keys: plugin, schema regen, migration, Settings UI, `requireApiKey` + `requireScope`.
3. `/api/v1` with the OpenAPI document (key-gated by default), error envelope, rate-limit headers.
4. MCP server and tools.
5. Discovery (`llms.txt`, api-catalog, `server.json`) and site copy/mock update.
6. Docs: README "Agent access" section, AGENTS.md routing, a `add-resource` skill showing how to add a second resource end to end.

## 12. Decisions

1. Key prefix: `hj_` (rewritten by `scripts/init.ts`).
2. Admins can't list or revoke other users' keys in this phase.
3. Default per-key rate limit: 120 requests/minute.
4. Demo resource: Projects.

5. No API docs UI (no Scalar); ship `openapi.json` only.
6. MCP: the MCP SDK v2's own `createMcpHandler` (newest protocol revision + 2025 fallback); `agents` not needed.
7. OpenAPI document requires an API key by default; `PROJECT.api.publicSpec` opts in to public + discovery.
8. Rate-limit headers: `RateLimit-Limit` + `RateLimit-Policy` and `Retry-After` on 429. The CF RateLimit binding exposes no remaining/reset counters, so those headers are not sent.
