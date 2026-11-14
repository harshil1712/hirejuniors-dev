import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Config from "effect/Config";
import { fileURLToPath } from "node:url";
import { PROJECT, APP_DOMAIN } from "./project.config";

const isProd = process.env.ALCHEMY_STAGE === "prod";

// Explicit physical names: no random suffix, and D1 names are unique per
// account so the stage keeps dev/preview stages distinct (`<name>-db-<stage>`).
const sanitizeStage = (stage: string) => stage.toLowerCase().replace(/[^a-z0-9-]/g, "-");

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

const DB = Cloudflare.D1.Database(
  `${PROJECT.name}-db`,
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    return {
      name: `${PROJECT.name}-db-${sanitizeStage(stage)}`,
      migrations: "./packages/db/migrations",
    };
  }),
);

// Turnstile widget — prod only; every other stage uses Cloudflare's
// always-pass test pair so previews/e2e/local dev stay automatable.
const TurnstileWidget = isProd
  ? Cloudflare.Turnstile.Widget(
      `${PROJECT.name}-turnstile`,
      Effect.gen(function* () {
        const stage = yield* Alchemy.Stage;
        return {
          name: `${PROJECT.name}-turnstile-${sanitizeStage(stage)}`,
          domains: [APP_DOMAIN],
          mode: "managed" as const,
        };
      }),
    )
  : null;

// Email sending domain on the zone — prod only. Local dev uses alchemy's
// .eml simulator (.alchemy/local/email), previews send nothing real.
// Zone id comes from CLOUDFLARE_ZONE_ID (or a zone lookup) — never hardcode it.
const _EmailDomain =
  isProd && process.env.CLOUDFLARE_ZONE_ID
    ? Cloudflare.Email.SendingSubdomain(`${PROJECT.name}-email`, {
        zoneId: process.env.CLOUDFLARE_ZONE_ID,
        name: PROJECT.domain,
      })
    : null;

// Per-PR Worker Previews: with PR_NAME set each Worker is uploaded as a
// preview version *of* its production self (parent deployment untouched).
const PREVIEW_NAME = process.env.PR_NAME ?? "";

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

// Props given as an Effect so the Turnstile widget resolves first — its
// secret/sitekey are only known after the resource applies.
export const Web = Cloudflare.Website.Vite(
  `${PROJECT.name}-web`,
  Effect.gen(function* () {
    const widget = isProd ? yield* TurnstileWidget! : null;
    const stage = sanitizeStage(yield* Alchemy.Stage);
    const props = {
      // a Preview inherits script-level settings (name, domain) from its parent
      name: PREVIEW_NAME ? undefined : `${PROJECT.name}-web`,
      rootDir: "./apps/web",
      main: "./worker/index.ts",
      // Pin the runtime date explicitly. `nodejs_compat` is on by default
      // for dates ≥ 2026-08-04, and passing the flag with an undated (=newer)
      // default makes workerd throw "nodejs_compat became the default", so
      // don't list it. If you lower the date below 2026-08-04, add
      // `flags: ["nodejs_compat"]` back (better-auth + node:crypto need it).
      dev: { port: 1338, strictPort: true },
      compatibility: { date: "2026-10-01" },
      // Workers Observability: logs + traces (span-level view of subrequests).
      observability: {
        enabled: true,
        logs: { enabled: true, invocationLogs: true },
        traces: { enabled: true, headSamplingRate: 1 },
      },
      // Custom domains only on the prod stage — dev/preview stages run on
      // workers.dev preview URLs and must never claim the zone.
      domain: isProd && !PREVIEW_NAME ? { name: APP_DOMAIN } : undefined,
      preview: PREVIEW_NAME ? { of: `${PROJECT.name}-web`, name: PREVIEW_NAME } : undefined,
      assets: {
        notFoundHandling: "single-page-application" as const,
        runWorkerFirst: ["/api/*", "/mcp", "/.well-known/api-catalog"],
      },
      env: {
        PUBLIC_APP_URL: "https://" + APP_DOMAIN,
        DB,
        EMAIL: Cloudflare.Email.SendEmail("email"),
        RATE_LIMITER: Cloudflare.RateLimit("RATE_LIMITER", {
          namespaceId: 1001,
          simple: { limit: 60, period: 60 },
        }),
        // Per-key limit on /api/v1 and /mcp (spec §4.4).
        API_RATE_LIMITER: Cloudflare.RateLimit("API_RATE_LIMITER", {
          namespaceId: 1002,
          simple: { limit: PROJECT.api.rateLimitPerMinute, period: 60 },
        }),
        TURNSTILE_SECRET_KEY: widget ? widget.secret : "1x0000000000000000000000000000000AA",
        TURNSTILE_SITE_KEY: widget ? widget.sitekey : "1x00000000000000000000AA",
        BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
        BETTER_AUTH_URL: Config.Redacted("BETTER_AUTH_URL").pipe(
          Config.withDefault(isProd ? `https://${APP_DOMAIN}` : "http://localhost:1338"),
        ),
        GOOGLE_CLIENT_ID: Config.Redacted("GOOGLE_CLIENT_ID").pipe(Config.withDefault("")),
        GOOGLE_CLIENT_SECRET: Config.Redacted("GOOGLE_CLIENT_SECRET").pipe(Config.withDefault("")),
        OWNER_ADMIN_EMAIL: Config.String("OWNER_ADMIN_EMAIL").pipe(Config.withDefault("")),
        // Closed on prod (owner-only sign-up via the user.create hook);
        // open elsewhere so previews/dev stay usable. Env still overrides.
        SIGNUP_DISABLED: Config.String("SIGNUP_DISABLED").pipe(
          Config.withDefault(isProd ? "true" : ""),
        ),
        OAUTH_PROXY_URL: Config.String("OAUTH_PROXY_URL").pipe(Config.withDefault("")),
        OAUTH_PROXY_SECRET: Config.Redacted("OAUTH_PROXY_SECRET").pipe(Config.withDefault("")),
      },
    };
    if (PREVIEW_NAME) return props;
    // Cross-script binding to the jobs worker's IngestWorkflow — the
    // dashboard's "Run now". Absent on previews (no jobs worker there);
    // POST /runs then answers 503. `workflowName` repeats the jobs binding's
    // pinned physical name — they must resolve identically.
    const ingestWorkflow = Cloudflare.Workflow("IngestWorkflow", {
      className: "IngestWorkflow",
      scriptName: `${PROJECT.name}-jobs`,
      workflowName: `${PROJECT.name}-ingest-${stage}`,
    });
    return { ...props, env: { ...props.env, INGEST_WORKFLOW: ingestWorkflow } };
  }),
);

export type WorkerEnv = Cloudflare.InferEnv<typeof Web>;

// Static marketing site on the apex; www 301s to apex. Prod only for the
// custom domain — previews run under preview URLs.
export const Site = Cloudflare.Website.Astro(`${PROJECT.name}-site`, {
  name: PREVIEW_NAME ? undefined : `${PROJECT.name}-site`,
  // Absolute: the dev child spawns with cwd=rootDir; a relative path would
  // resolve twice (apps/site/apps/site) and astro loses src/pages.
  rootDir: fileURLToPath(new URL("./apps/site", import.meta.url)),
  // static site: no Astro sessions, so no auto-provisioned KV namespace
  sessionKVBindingName: false,
  domain:
    isProd && !PREVIEW_NAME
      ? { name: PROJECT.domain, redirects: [`www.${PROJECT.domain}`] }
      : undefined,
  preview: PREVIEW_NAME ? { of: `${PROJECT.name}-site`, name: PREVIEW_NAME } : undefined,
  dev: { port: 1337, strictPort: true },
  env: {
    PUBLIC_APP_URL: isProd ? `https://${APP_DOMAIN}` : "http://localhost:1338",
  },
});

// Ingest worker hosting IngestWorkflow (docs/specs/ingest.md). Not created
// for Worker Previews — Cloudflare rejects Workflow classes on preview
// versions, so the whole worker is skipped when PR_NAME is set.
export const Jobs = PREVIEW_NAME
  ? null
  : Cloudflare.Worker(
      `${PROJECT.name}-jobs`,
      Effect.gen(function* () {
        const stage = yield* Alchemy.Stage;
        return {
          name: `${PROJECT.name}-jobs`,
          main: "./apps/jobs/src/index.ts",
          compatibility: { date: "2026-10-01" },
          observability: {
            enabled: true,
            logs: { enabled: true, invocationLogs: true },
            traces: { enabled: true, headSamplingRate: 1 },
          },
          env: {
            DB,
            // Pinned stage-scoped physical name — the web worker's
            // cross-script binding repeats it verbatim.
            INGEST_WORKFLOW: Cloudflare.Workflow("IngestWorkflow", {
              className: "IngestWorkflow",
              workflowName: `${PROJECT.name}-ingest-${sanitizeStage(stage)}`,
              schedules: ["0 6 * * 1"],
            }),
          },
        };
      }),
    );

export default Alchemy.Stack(
  PROJECT.name,
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const web = yield* Web;
    const site = yield* Site;
    const jobs = Jobs ? yield* Jobs : null;
    return { url: web.url, siteUrl: site.url, jobsUrl: jobs?.url };
  }),
);
