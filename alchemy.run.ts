import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
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

// Per-PR Worker Previews: with PR_NAME set each Worker is uploaded as a
// preview version *of* its production self (parent deployment untouched).
const PREVIEW_NAME = process.env.PR_NAME ?? "";

// The dashboard's only user. Cloudflare Access gates app.<domain> (and its
// preview/workers.dev URLs) to this email; the worker re-checks the admitted
// identity against it. Required for deployable stages so nobody deploys an
// Access app with a placeholder owner; local dev falls back to a stub.
const OWNER =
  process.env.OWNER_ADMIN_EMAIL ??
  (isProd || PREVIEW_NAME
    ? (() => {
        throw new Error(
          "OWNER_ADMIN_EMAIL is required for prod and PR-preview deploys — it is the email Cloudflare Access admits to the dashboard.",
        );
      })()
    : "dev@localhost");

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

export const Web = Cloudflare.Website.Vite(
  `${PROJECT.name}-web`,
  Effect.gen(function* () {
    const stage = sanitizeStage(yield* Alchemy.Stage);
    const props = {
      // a Preview inherits script-level settings (name, domain) from its parent
      name: PREVIEW_NAME ? undefined : `${PROJECT.name}-web`,
      rootDir: "./apps/web",
      main: "./worker/index.ts",
      // Owner-only dashboard: a dedicated Access application covers the
      // custom domain, workers.dev and version preview URLs. The worker
      // re-checks ctx.access's identity against OWNER_ADMIN_EMAIL.
      access: {
        policies: [{ decision: "allow", include: [{ email: OWNER }] }],
        sessionDuration: "720h",
      },
      // Pin the runtime date explicitly. `nodejs_compat` is on by default
      // for dates ≥ 2026-08-04, and passing the flag with an undated (=newer)
      // default makes workerd throw "nodejs_compat became the default", so
      // don't list it. If you lower the date below 2026-08-04 and something
      // needs node:crypto, add `flags: ["nodejs_compat"]` back.
      dev: { port: 1338, strictPort: true, access: { identity: { email: OWNER } } },
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
      // Prod is served on the custom domain only; version preview URLs stay
      // on for PR previews.
      workersDev: isProd && !PREVIEW_NAME ? { enabled: false, previewsEnabled: true } : undefined,
      preview: PREVIEW_NAME ? { of: `${PROJECT.name}-web`, name: PREVIEW_NAME } : undefined,
      assets: {
        notFoundHandling: "single-page-application" as const,
        runWorkerFirst: ["/api/*"],
      },
      env: {
        DB,
        OWNER_ADMIN_EMAIL: OWNER,
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

// Public job board on the apex (SSR over shared D1); www 301s to apex. Prod
// only for the custom domain — previews run under preview URLs.
export const Site = Cloudflare.Website.Astro(`${PROJECT.name}-site`, {
  name: PREVIEW_NAME ? undefined : `${PROJECT.name}-site`,
  // Absolute: the dev child spawns with cwd=rootDir; a relative path would
  // resolve twice (apps/site/apps/site) and astro loses src/pages.
  rootDir: fileURLToPath(new URL("./apps/site", import.meta.url)),
  // no Astro sessions, so no auto-provisioned KV namespace
  sessionKVBindingName: false,
  domain:
    isProd && !PREVIEW_NAME
      ? { name: PROJECT.domain, redirects: [`www.${PROJECT.domain}`] }
      : undefined,
  // Apex only on prod (no duplicate workers.dev copy of the site); version
  // preview URLs stay on for PR previews.
  workersDev: isProd && !PREVIEW_NAME ? { enabled: false, previewsEnabled: true } : undefined,
  preview: PREVIEW_NAME ? { of: `${PROJECT.name}-site`, name: PREVIEW_NAME } : undefined,
  dev: { port: 1337, strictPort: true },
  env: {
    // Server-rendered job board reads the shared D1 (active listings only).
    DB,
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
          // No HTTP surface — no workers.dev URL on prod.
          workersDev: isProd ? false : undefined,
          // Explicit port so the jobs worker never races the web worker's 1338.
          dev: { port: 1339, strictPort: true },
          compatibility: { date: "2026-10-01" },
          observability: {
            enabled: true,
            logs: { enabled: true, invocationLogs: true },
            traces: { enabled: true, headSamplingRate: 1 },
          },
          env: {
            DB,
            AI: Cloudflare.Workers.AI(),
            BROWSER: Cloudflare.Browser(),
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
