import { defineConfig } from "vite-plus";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

// Test-only: applied to the shared test D1 in tests via
// `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` — same convention as
// apps/web, proving the hand-written migrations apply unmodified.
const testMigrations = process.env.VITEST
  ? await readD1Migrations("../../packages/db/migrations")
  : [];

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
  plugins: [
    !!process.env.VITEST &&
      cloudflareTest({
        wrangler: { configPath: "./vitest.wrangler.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: testMigrations } },
      }),
  ],
});
