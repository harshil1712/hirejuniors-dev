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

## 3. Resources: jobs, companies, sources, runs

The API and tools manage the ingest pipeline's data (schema: `docs/specs/ingest.md`, tables in `packages/db/src/schema.ts`):

- **Jobs** — ingested listings (`job_` ids). Read: list with filters (`status`, `level`, `country`, `companyId`, `sourceId`, `q`) + keyset pagination; get by id. Write: `PATCH` status (`active` ↔ `retired`; retire stamps `retire_reason: "manual"`, restore clears it).
- **Companies** — job board owners (`cmp_` ids). Create (slug derived from name; duplicate slug → `409 conflict`), list, patch.
- **Sources** — ingest sources (`src_` ids, unique `(platform, board)`). Create/patch (`enabled`, `includeAll`, `config`, `board`); `config` is validated by the platform adapter's `parseConfig` from `@hirejuniors/jobs`. `POST /sources/preview` dry-runs an adapter fetch (no writes) and returns `{fetched, kept, sample}`. No DELETE — disabling is the off switch.
- **Runs** — ingest workflow runs (`run_` ids). List latest-first, get by id with per-source rows. `POST /runs` starts an `IngestWorkflow` instance (`trigger: "manual"`) → `202 {instanceId}`; `503 unavailable` when the workflow binding is absent (preview deploys).

Every resource route — session `/api/*`, `/api/v1/*`, and MCP tools — additionally requires the principal's user to have `role: "admin"` (Better Auth admin plugin); non-admin → `403 forbidden`.

## 4. Authentication and authorization

### 4.1 API keys

- Library: `@better-auth/api-key@1.7.12` (matches `better-auth@1.7.12`; ≥7 days old). Client: `apiKeyClient()`.
- Keys are shown **once** at creation; only a hash and a display prefix are stored. Prefix `hj_` (rewritten by `scripts/init.ts`).
- Transport: `Authorization: Bearer <key>` on both the HTTP API and MCP. No query-string keys.
- A key belongs to the user who created it (`referenceId` = user id). Users can list (name, prefix, created, last used, expiry, scopes) and revoke their own keys. Admins can't see other users' keys in this phase.
- Expiry choices at creation: 30 days, 90 days, 1 year, never.
- Schema: regenerate `src/auth-schema.ts` with `npm run auth:generate` after adding the plugin, then hand-write `0003_apikey.sql` to match the generated table exactly.

### 4.2 Scopes

| Scope        | Allows                                                   |
| ------------ | -------------------------------------------------------- |
| `jobs:read`  | list/get jobs, companies, sources, runs                  |
| `jobs:write` | all mutations incl. preview + trigger run (implies read) |

Stored in the key's `permissions` as `{ "jobs": ["read", "write"] }`. Checked per route/tool in one helper (`requireScope("jobs", "write")`). A request without the needed scope gets `403 insufficient_scope`.

### 4.3 Request flow

```
Authorization: Bearer hj_…
  → middleware requireApiKey: auth.api.verifyApiKey({ key })   (exact API verified at implementation)
  → 401 if missing/invalid/expired/revoked
  → c.set("principal", { userId, keyId, scopes, isAdmin })
  → route / MCP tool → requireScope + admin check → services/{jobs,companies,sources,runs}.*(db, …)
```

Session cookies are **not** accepted on `/api/v1/*` or `/mcp`; the web app keeps using its own session routes. This keeps the public surface single-auth and CSRF-free.

### 4.4 Rate limiting

- Existing per-IP `RATE_LIMITER` binding stays as the outer limit.
- Add a per-key limit on `/api/v1/*` and `/mcp` (Cloudflare RateLimit binding keyed by `keyId`, default 120 requests/minute, configurable in `project.config.ts`).
- Responses include `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; a limited request gets `429` with `Retry-After`.

## 5. HTTP API (`/api/v1`)

### 5.1 Endpoints

| Method | Path                                     | Scope                                              | Result                                                      |
| ------ | ---------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| GET    | `/api/v1/me`                             | any valid key                                      | `{ data: { userId, email, name, keyId, scopes } }`          |
| GET    | `/api/v1/jobs?status=&level=&country=&…` | `jobs:read`                                        | `{ data: Job[], nextCursor: string \| null }`               |
| GET    | `/api/v1/jobs/{id}`                      | `jobs:read`                                        | `{ data: Job }`                                             |
| PATCH  | `/api/v1/jobs/{id}`                      | `jobs:write`                                       | `{ data: Job }` (`{status: active\|retired}`)               |
| GET    | `/api/v1/companies`                      | `jobs:read`                                        | `{ data: Company[] }`                                       |
| POST   | `/api/v1/companies`                      | `jobs:write`                                       | `201 { data: Company }` (409 on duplicate slug)             |
| PATCH  | `/api/v1/companies/{id}`                 | `jobs:write`                                       | `{ data: Company }`                                         |
| GET    | `/api/v1/sources`                        | `jobs:read`                                        | `{ data: Source[] }` (company, last run, active job count)  |
| POST   | `/api/v1/sources`                        | `jobs:write`                                       | `201 { data: Source }` (409 on duplicate platform+board)    |
| PATCH  | `/api/v1/sources/{id}`                   | `jobs:write`                                       | `{ data: Source }`                                          |
| POST   | `/api/v1/sources/preview`                | `jobs:write`                                       | `{ data: { fetched, kept, sample } }` (502 upstream_failed) |
| GET    | `/api/v1/runs`                           | `jobs:read`                                        | `{ data: IngestRun[], nextCursor }`                         |
| GET    | `/api/v1/runs/{id}`                      | `jobs:read`                                        | `{ data: IngestRun & { sourceRuns } }`                      |
| POST   | `/api/v1/runs`                           | `jobs:write`                                       | `202 { data: { instanceId } }` (503 unavailable)            |
| GET    | `/api/v1/openapi.json`                   | any valid key (public if `PROJECT.api.publicSpec`) | OpenAPI 3.1 document                                        |

### 5.2 Conventions

- JSON only; `Content-Type: application/json` required on writes (`415` otherwise).
- Pagination: cursor-based, opaque base64url cursor of `(firstSeenAt, id)` for jobs and `(startedAt, id)` for runs; `limit` 1–100; newest first.
- Unknown ids return `404 not_found`; duplicate unique keys return `409 conflict`.
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

Codes: `unauthorized` (401), `insufficient_scope` (403), `forbidden` (403, non-admin), `not_found` (404), `conflict` (409), `validation_failed` (400), `unsupported_media_type` (415), `rate_limited` (429), `upstream_failed` (502), `unavailable` (503), `internal` (500). `requestId` comes from the existing request-id middleware.

### 5.3 OpenAPI generation

- `@hono/zod-openapi@1.6.3` (`OpenAPIHono`, `createRoute`); zod 4 is already in the repo.
- Schemas live once in `worker/api/schemas.ts` (`Job`, `JobUpdate`, `JobList`, `Company`, `CompanyCreate`, `CompanyUpdate`, `CompanyList`, `Source`, `SourceCreate`, `SourceUpdate`, `SourceList`, `SourcePreview`, `SourcePreviewResult`, `IngestRun`, `SourceRun`, `RunList`, `Error`) and are reused by the MCP tools.
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

| Tool             | Scope | Input                                                                       | Output                              | Annotations                   |
| ---------------- | ----- | --------------------------------------------------------------------------- | ----------------------------------- | ----------------------------- |
| `whoami`         | any   | –                                                                           | `{ userId, email, name, scopes }`   | readOnly, idempotent          |
| `list_jobs`      | read  | `{ status?, level?, country?, companyId?, sourceId?, q?, limit?, cursor? }` | `{ jobs: Job[], nextCursor }`       | readOnly, idempotent          |
| `get_job`        | read  | `{ id }`                                                                    | `{ job }`                           | readOnly, idempotent          |
| `list_companies` | read  | –                                                                           | `{ companies: Company[] }`          | readOnly, idempotent          |
| `list_sources`   | read  | –                                                                           | `{ sources: Source[] }`             | readOnly, idempotent          |
| `list_runs`      | read  | `{ limit?, cursor? }`                                                       | `{ runs: IngestRun[], nextCursor }` | readOnly, idempotent          |
| `get_run`        | read  | `{ id }`                                                                    | `{ run }` (with sourceRuns)         | readOnly, idempotent          |
| `set_job_status` | write | `{ id, status }`                                                            | `{ job }`                           | idempotent, not destructive   |
| `create_company` | write | `{ name, slug?, homepageUrl?, logoUrl? }`                                   | `{ company }`                       | not readOnly, not destructive |
| `create_source`  | write | `{ companyId, platform, board, config, includeAll, enabled }`               | `{ source }`                        | not readOnly, not destructive |
| `update_source`  | write | `{ id, enabled?, includeAll?, config?, board? }`                            | `{ source }`                        | idempotent, not destructive   |
| `preview_source` | write | `{ platform, board, config, includeAll }`                                   | `{ fetched, kept, sample }`         | not readOnly (network fetch)  |
| `trigger_run`    | write | –                                                                           | `{ instanceId }`                    | not readOnly, not idempotent  |

Tool descriptions are written for agents: what it does, when to use it, what the id format is. Tools a key lacks the scope for are still listed (simpler, cacheable) but return `insufficient_scope`.

### 6.3 Client setup (shown in Settings → API keys)

```bash
claude mcp add --transport http hirejuniors https://app.<domain>/mcp \
  --header "Authorization: Bearer hj_…"
```

Plus copyable snippets for Cursor (`mcp.json` with `headers`) and Codex (`config.toml` `bearer_token_env_var`).

## 7. Shared service layer

`worker/services/{jobs,companies,sources,runs}.ts`, pure functions over Drizzle, no Hono/MCP types. Resources are shared pipeline data (not per-user) — services take no ownerId; admin gating happens in the route/MCP layer:

```ts
// jobs.ts
listJobs(db, filters): Promise<{ items: Job[]; nextCursor: string | null }>
getJob(db, id): Promise<Job>                       // throws ServiceError("not_found")
setJobStatus(db, id, status): Promise<Job>
// companies.ts
listCompanies(db), createCompany(db, input)        // ServiceError("conflict") on dup slug
updateCompany(db, id, patch)
// sources.ts
listSources(db)                                    // + company, last run, active job count
createSource(db, input)                            // adapter parseConfig; "conflict" on dup
updateSource(db, id, patch)
previewSource(db, input)                           // real fetch, no writes; "upstream_failed"
// runs.ts
listRuns(db, { limit, cursor? }), getRun(db, id)   // getRun includes source_run rows
triggerRun(env)                                    // ServiceError("unavailable") w/o binding
```

`ServiceError { code, message, details? }` is translated to HTTP status in the API layer and to `isError` results in the MCP layer.

## 8. Web app UI

- **Dashboard** (`/dashboard`): tiles (active jobs, retired 7d, failing sources, last run), "Run now" button (disabled + tooltip on `503 unavailable`).
- **Jobs** (`/jobs`, `/jobs/$id`): URL-synced filter bar, Kumo `Table`, load-more pagination; detail with apply link + retire/restore `ConfirmDialog`.
- **Sources** (`/sources`): table with enabled toggle + last run; "Add source" `Dialog` (company picker/inline create, platform, board, config JSON, include-all, Test → preview, Save).
- **Runs** (`/runs`, `/runs/$id`): list + per-source detail.
- **Settings → API keys** (`SettingsSection`): list (name, `hj_…` prefix, scopes, created, last used, expires, revoke via `ConfirmDialog`); "Create key" `Dialog` (name, scopes checkboxes, expiry `Select`); show-once `Dialog` with `ClipboardText` and a warning, plus the client snippets from §6.3.
- All dashboard pages use session-authenticated internal routes (`/api/*`) that call the same service layer and require `role: "admin"`.

## 9. Discovery

- Only when `PROJECT.api.publicSpec` is true: `llms.txt` (site) gains a "For agents" section linking `/api/v1/openapi.json` and `/mcp`, and the app serves `/.well-known/api-catalog` (RFC 9727 linkset) pointing at the OpenAPI document.
- `server.json` (MCP registry format) in the repo root for later publishing; not published in this phase.

## 10. Testing (vitest + `@cloudflare/vitest-plugin`, no `vi.mock`)

1. Keys: create via session → shown once; verify valid/invalid/revoked/expired; list/revoke own only.
2. Auth: `/api/v1/me` 401 without key, 401 bad key, 200 good key; session cookie alone is rejected.
3. Scopes: read-only key gets 403 on POST/PATCH/DELETE and on write tools.
4. Resource APIs: jobs filters + pagination, PATCH retire/restore; companies create/slug/409; sources config validation/409/enable/active-count; runs list/detail/503; 401 unauth, 403 non-admin, `insufficient_scope` on under-scoped keys.
5. OpenAPI: 401 without a key by default, 200 with any key, public when `publicSpec` is true; document is `openapi: 3.1.x`, contains every path, every operation has `bearerAuth`, validates against the OpenAPI 3.1 schema.
6. MCP (official client `@modelcontextprotocol/client@2.3.1` over HTTP): 401 without key; `tools/list` returns 13 tools with annotations; `list_jobs`/`set_job_status` round-trip; `whoami`; scope + admin error results.
7. Rate limit: per-key limit returns 429 with headers (test env lowers the limit).
8. UI: verify-ui gate (screenshots light/dark/mobile) for dashboard/jobs/sources/runs and API keys.

Manual: MCP Inspector (`npx @modelcontextprotocol/inspector`) and a real `claude mcp add` against `alchemy dev`.

## 11. Delivery plan (small, reviewed commits)

1. Resources (jobs, companies, sources, runs): services, internal session routes, dashboard pages.
2. API keys: plugin, schema regen, migration, Settings UI, `requireApiKey` + `requireScope` + admin gate.
3. `/api/v1` with the OpenAPI document (key-gated by default), error envelope, rate-limit headers.
4. MCP server and tools.
5. Discovery (`llms.txt`, api-catalog, `server.json`).
6. Docs: README "Agent access" section, AGENTS.md routing, the `add-resource` skill using Sources as the worked reference.

## 12. Decisions

1. Key prefix: `hj_` (rewritten by `scripts/init.ts`).
2. Admins can't list or revoke other users' keys in this phase.
3. Default per-key rate limit: 120 requests/minute.
4. Resources: the ingest pipeline's jobs, companies, sources and runs — admin-only on every surface.

5. No API docs UI (no Scalar); ship `openapi.json` only.
6. MCP: the MCP SDK v2's own `createMcpHandler` (newest protocol revision + 2025 fallback); `agents` not needed.
7. OpenAPI document requires an API key by default; `PROJECT.api.publicSpec` opts in to public + discovery.
8. Rate-limit headers: `RateLimit-Limit` + `RateLimit-Policy` and `Retry-After` on 429. The CF RateLimit binding exposes no remaining/reset counters, so those headers are not sent.
