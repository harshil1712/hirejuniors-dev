# Hire Juniors — agent guide

Hire Juniors is a reusable starter for full-stack Cloudflare apps: a Vite/React SPA + Hono API worker with auth and D1, a static Astro marketing site, shared brand package, and one Alchemy stack. `vpx scripts/init.ts <name> <domain>` renames it into a product. This repo is developed mostly by agents; these rules keep production safe.

## Repo map

- `apps/web` — app.<domain> (React/TanStack Router file routes/Kumo SPA + Hono worker in `worker/`, D1 via Drizzle, Better Auth with email verification + Turnstile + admin plugin).
- `apps/site` — <domain> apex (Astro, static marketing + blog). `packages/brand` — logo, tokens, fonts (shared by both apps).
- `packages/db` (`@hirejuniors/db`) — shared Drizzle schema for the jobs pipeline (`company`, `source`, `job`, `ingest_run`, `source_run`), query helpers, and the single D1 migrations dir `packages/db/migrations`.
- `apps/jobs` (`@hirejuniors/jobs`) — ingest Worker hosting `IngestWorkflow` (weekly cron): platform adapters, classifier, upsert/feed-diff, expiry + link check. Spec: `docs/specs/ingest.md`.
- Blog posts are Markdown in git: `apps/site/src/content/blog/*.md` — schema in `src/content.config.ts`, write via the `write-post` skill; SEO gate is `apps/site/scripts/check-dist.ts` (runs in `vp run -r test`).
- Adding a resource to the app (schema → API → MCP → UI) — follow the `add-resource` skill; it walks the Sources resource end to end.
- `scripts/init.ts` — renames the starter (package scope, worker names, domains, product name). `scripts/cf-token-preflight.sh` — deploy-token check.
- `apps/web` agent access — one service layer (`worker/services/*`) behind three surfaces: session `/api/{jobs,companies,sources,runs}`, key-gated `/api/v1` + its OpenAPI doc, and MCP at `/mcp` (`worker/mcp.ts`). All resource routes require the admin role (`principal.isAdmin`). Shared zod schemas live in `worker/api/schemas.ts`; principal/scopes in `worker/middleware/principal.ts`. Agent spec: `docs/specs/agent-api.md`; registry entry: `server.json`.
- `tooling/anti-slop` — vendored Oxlint JS plugin, wired into `vp check`.
- `alchemy.run.ts` — all infrastructure (Alchemy IaC). No resource is created any other way.
- `project.config.ts` — single source for names/domains (name, productName, domain, appSubdomain, emailFrom).
- `PRODUCT.md` / `DESIGN.md` — impeccable's product brief + design-system doc (template for new projects; keep DESIGN.md in sync with `packages/brand/tokens.css`).

## Hard rules

1. **Production safety.** Production changes only through a merged PR with green CI and a passing Worker Preview smoke test. Never deploy production from a laptop or a feature branch. Never create Cloudflare resources outside `alchemy.run.ts`.
2. **Dependencies.** 7-day rule (`minimumReleaseAge: 10080`). Never add exclusions or weaken it; report the blocker. Use `vp add`/`vp remove`, never hand-edit versions to unvetted releases.
3. **Secrets.** Never commit, log or print secrets. Ask the human for new ones.
4. **Verification before done** (see the skills): `vp check` → `vp run -r test` → `vp run -r build`; UI changes need screenshots (`verify-ui`). Never claim a check passed without running it in this session.
5. **No hook bypass.** Never `--no-verify`, never force-push `main`, never rewrite published history.
6. **Database.** Drizzle ORM only, never raw SQL. Schema in `apps/web/schema/db.ts` (re-exports `@hirejuniors/db/schema`) + generated `src/auth-schema.ts` + `packages/db/src/schema.ts`; migrations in `packages/db/migrations` are hand-maintained SQL for now (`drizzle-kit generate` is broken with the pinned versions — see `packages/db/migrations/README.md`).
7. **Local dev.** `vp run dev` (`alchemy dev`) needs `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` in env (env credentials take precedence over any alchemy profile); without `alchemy login`, use `CLOUDFLARE_API_TOKEN=$(npx wrangler auth token | tail -1)` and the account id from `npx wrangler whoami`. Alchemy binds dev ports dynamically; point `BETTER_AUTH_URL` at the web URL it prints. Verification/reset mail lands in `.alchemy/local/email/`.
8. **Clean up after yourself.** Before reporting done: stop dev servers/browsers you started, delete Worker Previews and temporary branches you created, remove scratch files/debug logging/unused code, leave `git status` clean. Follow `cleanup`.

## Design skills

| Task                        | Skill                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New page/screen (esp. site) | `frontend-design` for direction, then `kumo-ui` to build                                                                                               |
| Any apps/web UI             | `kumo-ui`                                                                                                                                              |
| Tokens/branding/fonts       | `brand-tokens`                                                                                                                                         |
| Motion/interaction          | `emil-design-eng` (vendored, MIT; repo note at top: no Framer Motion — CSS/WAAPI only)                                                                 |
| Design review/polish        | `impeccable` (+ `npx impeccable detect`)                                                                                                               |
| Accessibility               | `accesslint` set (not vendored — `npx skills add accesslint/skills`) else web-design-guidelines a11y rules (`npx skills add vercel-labs/agent-skills`) |
| Site/blog/UI copy           | `copywriting`, `copy-editing`; blog posts → `write-post`                                                                                               |
| Before any UI PR            | `verify-ui`                                                                                                                                            |

**Precedence:** project skills (`kumo-ui`, `brand-tokens`, `write-post`, `verify-ui`) and this file beat vendored skills on any conflict — e.g. a vendored skill suggesting `dark:` classes, raw palette colors, new fonts or a new UI library is wrong here.

`accesslint/skills` and `web-design-guidelines` are **not** vendored (no redistribution license found upstream) — install them on demand with the commands above.

## Decisions — don't re-propose

- **SPA, not SSR.** The app is a Vite single-page app; the worker serves assets + `/api/*` (`runWorkerFirst`). No TanStack Start, no server rendering.
- **Astro for marketing** (`apps/site`), static output, separate worker on the apex.
- **Alchemy v2** (Effect style) owns all infra — no wrangler config files for deploy, no Terraform.
- **Kumo UI** (`@cloudflare/kumo`) + Phosphor icons + Tailwind 4. No other component library.
- **Workers Observability** (logs + traces) — no Sentry, no external APM.
- **No `vi.mock`** — the anti-slop plugin forbids module mocking; tests use real seams (service bindings, test env vars).
- **Email verification required** before sign-in; Turnstile (prod widget, test keys elsewhere) guards sign-up/sign-in/password-reset.
- **Admin via Better Auth's admin plugin** — no hand-rolled admin API; `OWNER_ADMIN_EMAIL` bootstraps the first admin.
- **Agent access** — API keys via `@better-auth/api-key` (created server-side; permissions are a server-only property), MCP via the SDK's own `createMcpHandler` (not `agents`, not `@hono/mcp`), stateless. One zod schema set feeds OpenAPI + MCP. No OAuth, so ChatGPT/Claude.ai web connectors can't connect yet.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
