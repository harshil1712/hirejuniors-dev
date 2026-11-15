/** Worker bindings — mirrors the `env` block in alchemy.run.ts. `alchemy dev`
 * can regenerate this file (Cloudflare.InferEnv<typeof Web>); keep it in sync
 * by hand until then. */
interface Env {
  DB: D1Database;
  RATE_LIMITER: RateLimit;
  /** Cloudflare Email send_email binding — prod/local .eml simulator. */
  EMAIL?: SendEmail;
  /** Test seam: when bound, outbound mail is POSTed here as JSON instead of
   * going through EMAIL. Bound only by the vitest miniflare config. */
  EMAIL_SINK?: Fetcher;
  /** Test seam: D1 migrations read by `readD1Migrations` in vite.config.ts;
   * applied with `applyD1Migrations` in tests. */
  TEST_MIGRATIONS?: import("cloudflare:test").D1Migration[];
  TURNSTILE_SECRET_KEY: string;
  TURNSTILE_SITE_KEY: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  OWNER_ADMIN_EMAIL: string;
  /** Cross-script Workflow binding to the jobs worker's IngestWorkflow.
   * Absent on PR previews (the jobs worker doesn't exist there) and in the
   * vitest pool — POST /runs answers 503 `unavailable`. */
  INGEST_WORKFLOW?: Workflow;
}
