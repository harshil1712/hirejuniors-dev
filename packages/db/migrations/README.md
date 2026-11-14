# Migrations

Single D1 migrations dir for the whole repo (moved here from apps/web in the
jobs-pipeline phase). Hand-maintained for now — `drizzle-kit generate` is
broken under the pinned drizzle-orm 0.45.4 (see docs/friction-log.md).

- Keep `0001_init.sql` in sync with `apps/web/src/auth-schema.ts` (regenerate
  that file with `npm run auth:generate` in apps/web).
- `0004_jobs.sql` mirrors `packages/db/src/schema.ts`; `0005_seed_sources.sql`
  seeds the ingest sources (`INSERT OR IGNORE`, fixed ids).
- The worker tests apply these via `applyD1Migrations` exactly as alchemy's
  `D1.Database` `migrations` option applies them.
