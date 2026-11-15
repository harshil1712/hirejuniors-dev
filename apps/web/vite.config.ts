import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

// Test-only: applied to the shared test D1 in tests via
// `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` — proves the hand-written
// migrations apply unmodified, exactly as alchemy will apply them.
const testMigrations = process.env.VITEST
  ? await readD1Migrations("../../packages/db/migrations")
  : [];

export default defineConfig({
  staged: { "*": "vp check --fix" },
  fmt: { ignorePatterns: ["src/routeTree.gen.ts"] },
  lint: {
    ignorePatterns: ["src/routeTree.gen.ts"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
  plugins: [
    lazyPlugins(() => [
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ]),
    // Test-only: cloudflareTest switches resolve conditions to workerd,
    // which makes the browser app resolve server builds. Load it only
    // under Vitest.
    !!process.env.VITEST &&
      cloudflareTest({
        wrangler: { configPath: "./vitest.wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: testMigrations },
          // Every outbound global fetch in the worker under test lands here —
          // keeps the suite fully offline. Routes the Greenhouse board API
          // used by POST /sources/preview.
          outboundService: "fixture-feed",
          workers: [
            {
              name: "fixture-feed",
              modules: true,
              compatibilityDate: "2025-06-01",
              script: `const GH_JOBS = [
                { id: 1, title: "Software Engineer Intern", absolute_url: "https://b.example/1", content: "", location: { name: "Austin, TX, United States" }, updated_at: "2026-02-02T17:45:00.000Z" },
                { id: 2, title: "Senior Software Engineer", absolute_url: "https://b.example/2", content: "", location: { name: "Austin, TX, United States" } },
                { id: 3, title: "Graduate Data Analyst", absolute_url: "https://b.example/3", content: "", location: { name: "London, United Kingdom" } },
                { id: 4, title: "Engineering Manager", absolute_url: "https://b.example/4", content: "", location: { name: "Austin, TX, United States" } },
                { id: 5, title: "Junior Frontend Developer", absolute_url: "https://b.example/5", content: "", location: { name: "Remote - Portugal" } },
              ];
              export default { async fetch(req) {
                const host = new URL(req.url).hostname;
                if (host === "boards-api.greenhouse.io") {
                  return Response.json({ jobs: GH_JOBS });
                }
                return new Response("fixture-feed: unknown host " + host, { status: 404 });
              }}`,
            },
          ],
        },
      }),
  ],
});
