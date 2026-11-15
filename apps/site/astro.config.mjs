import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { PROJECT } from "../../project.config.ts";
import { fileURLToPath } from "node:url";
export default defineConfig({
  site: `https://${PROJECT.domain}`,
  output: "server",
  integrations: [
    sitemap({
      // SSR job sitemap is served by the worker, not emitted into dist.
      customSitemaps: [`https://${PROJECT.domain}/sitemap-jobs.xml`],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "#project": fileURLToPath(new URL("../../project.config.ts", import.meta.url)),
      },
    },
  },
});
