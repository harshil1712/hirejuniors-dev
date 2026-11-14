# Hire Juniors

Looking for the first job in tech is not easy. Although there are a lot of openings out there is no central place where these postings are listed, especially for junior roles and internships. [hirejuniors.dev](https://hirejuniors.dev) is a website that aims to list all these opportunities for someone who is going to start their journey in tech. [hirejuniors.dev](https://hirejuniors.dev) aims to be a community-driven project. If you come across any job posting for a junior role or for an internship please fill-out the Typeform to get it listed.

Let us take a step to help and welcome junior developers on this amazing journey.

## Contributing 🚀

We love when people contribute to the project. Refer to the [CONTRIBUTING.md](./CONTRIBUTING.md) to learn how you can get involved.

## Built With 💪

- React SPA (Vite + TanStack Router + Kumo UI) on Cloudflare Workers
- Hono API worker — Better Auth, D1 via Drizzle ORM, Turnstile
- Astro job board (server-rendered over D1) + blog
- Cloudflare Workflows for weekly job ingest and retirement
- Alchemy IaC (one stack for D1, workers, domains, previews)

## Getting Started

### Installation

```sh
vp install
cp .env.example .env        # fill in BETTER_AUTH_SECRET at minimum
```

### Development

`alchemy dev` needs Cloudflare credentials in env (it picks them up before
any profile). Either `alchemy login` once, or reuse wrangler's OAuth:

```bash
# account id: the "Account ID" column of `npx wrangler whoami`
CLOUDFLARE_ACCOUNT_ID=<your-account-id> \
  CLOUDFLARE_API_TOKEN=$(npx wrangler auth token | tail -1) \
  vp run dev
```

Start the dev servers:

```sh
vp run dev          # app on http://localhost:1338 (emails land in .alchemy/local/email as .eml)
vp run dev:site     # marketing site on http://localhost:1337
```

Sign up with any email; the verification email is written to `.alchemy/local/email/*.eml` — open it and click the link. Set `OWNER_ADMIN_EMAIL` to your email before signing up to get the admin area.

`project.config.ts` is the single source for name/domain/product name — `alchemy.run.ts`, both apps and `scripts/init.ts` read it.

## Building for Production

```sh
vp check           # format + oxlint (incl. anti-slop rules) + types
vp run -r test     # worker tests (miniflare, real D1 — no mocks)
vp run -r build    # web + site
```

## Deployment

Push to `main` deploys production via `.github/workflows/deploy.yml` (check → test → build → `alchemy deploy --stage prod` → smoke → auto-rollback). Every PR gets a Worker Preview deployment and a smoke check. Required secrets and the API-token permissions are in `docs/deploy.md`.
