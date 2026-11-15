/** Worker bindings for the ingest worker — mirrors the `env` block on the
 * jobs Worker in alchemy.run.ts. */
interface Env {
  DB: D1Database;
  /** The workflow this worker hosts — bound so manual triggers can
   * `env.INGEST_WORKFLOW.create({ params: { trigger } })`. */
  INGEST_WORKFLOW: Workflow<{ trigger: "schedule" | "manual" }>;
  /** Test seam: D1 migrations read by `readD1Migrations` in vite.config.ts;
   * applied with `applyD1Migrations` in tests. */
  /** Workers AI binding — clef-flash / clef / clairic (spec §Infra). */
  AI: Ai;
  TEST_MIGRATIONS?: import("cloudflare:test").D1Migration[];
}
