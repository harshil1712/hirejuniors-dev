/** Worker bindings — mirrors the `env` block in alchemy.run.ts. `alchemy dev`
 * can regenerate this file (Cloudflare.InferEnv<typeof Web>); keep it in sync
 * by hand until then. */
interface Env {
  DB: D1Database;
  /** The one account Cloudflare Access admits and the API authorises —
   * the dashboard is owner-only. */
  OWNER_ADMIN_EMAIL: string;
  /** Test seam: D1 migrations read by `readD1Migrations` in vite.config.ts;
   * applied with `applyD1Migrations` in tests. */
  TEST_MIGRATIONS?: import("cloudflare:test").D1Migration[];
  /** `alchemy dev` lowers the Worker's `dev.access` config into this binding
   * (the dev stand-in for `ctx.access`). Never present in deployed workers. */
  ALCHEMY_DEV_ACCESS?: { aud?: string; identity?: { email?: string } };
  /** Cross-script Workflow binding to the jobs worker's IngestWorkflow.
   * Absent on PR previews (the jobs worker doesn't exist there) and in the
   * vitest pool — POST /runs answers 503 `unavailable`. */
  INGEST_WORKFLOW?: Workflow;
}
