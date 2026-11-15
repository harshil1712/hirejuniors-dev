# Deploy setup

CI runs `alchemy deploy`. The root `deploy`/`deploy:dev` scripts exist for CI
parity — `deploy` sets `ALCHEMY_STAGE=prod`, which `alchemy.run.ts` needs to
provision prod resources (custom domains, the real Cloudflare Access policy). They are **not** a manual deploy path: production still
ships only through a merged PR (see `deploy` skill / AGENTS.md rule 1).

Production secrets go in the GitHub `production` environment
(restricted to `main`); preview secrets are repository secrets. An environment secret
overrides a repository secret of the same name, so both tokens are `CLOUDFLARE_API_TOKEN`.

**Prerequisite:** Cloudflare Zero Trust must be enabled on the account with
**One-time PIN** login configured (Zero Trust → Settings → Authentication) —
the dashboard's Access application uses it to admit the owner email.

Two account-owned Cloudflare API tokens (Manage Account → Account API Tokens). Put the
Account permissions in a policy whose resource is the account and the Zone permissions in a
separate policy on your zone; account permissions inside a zone policy grant nothing.
`scripts/cf-token-preflight.sh` (first deploy step) names any missing permission.

| Permission                                     | Production | Preview |
| ---------------------------------------------- | ---------- | ------- |
| Account · Workers Scripts · Write              | ✓          | ✓       |
| Account · D1 · Write                           | ✓          | ✓       |
| Account · Workers R2 Storage · Write           | ✓          | ✓       |
| Account · Secrets Store · Write                | ✓          | ✓       |
| Account · Access: Apps and Policies · Write    | ✓          | ✓       |
| Zone `<domain>` · Workers Routes · Write       | ✓          | —       |
| Zone `<domain>` · Zone · Read                  | ✓          | —       |
| Zone `<domain>` · Dynamic URL Redirects · Edit | ✓          | —       |

Use **Workers Scripts · Write** even though the dashboard labels it Legacy (no deprecation
date; Cloudflare promises advance notice), not the new Workers Admin/Editor roles: per
Cloudflare's API spec, custom domains, static-asset upload sessions and Worker Previews
accept only Workers Scripts Write. Secrets Store is for Alchemy's state store
(`alchemy-state-store`). No DNS permission is needed (custom domains create their own records).

| Secret                  | Scope                                               | Notes                            |
| ----------------------- | --------------------------------------------------- | -------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | see the token table above                           | prod: environment; preview: repo |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID (dashboard → overview)                   |                                  |
| `CLOUDFLARE_ZONE_ID`    | Zone ID for the apex domain                         | Prod only — custom domains       |
| `WORKERS_DEV_SUBDOMAIN` | your `*.workers.dev` subdomain                      | Used to build site preview URLs  |
| `OWNER_ADMIN_EMAIL`     | the email Cloudflare Access admits to the dashboard |                                  |

**First deploy:** a new project's first PR can't get a Worker Preview —
previews are versions of the production Workers, which don't exist until the
first merge to main deploys them. Merge the first PR on green CI; every later
PR gets a preview.

Alchemy state lives in the account (`Cloudflare.state()`: the `alchemy-state-store` Worker
plus its Secrets Store secrets), so no extra state secrets are needed.

PR previews need only `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` + `WORKERS_DEV_SUBDOMAIN`.

Preview URLs: the dashboard at `https://pr-<n>.app.hirejuniors.dev` (custom-domain Previews on
`app.`, behind the same Access policy; Cloudflare issues the `*.app.hirejuniors.dev` certificate
when the first Preview is created, which can take a few minutes), the public site at
`https://pr-<n>-hirejuniors-site.<subdomain>.workers.dev` (workers.dev answers `noindex`).
