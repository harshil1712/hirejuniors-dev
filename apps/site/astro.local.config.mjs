// Local build config: adds the Alchemy Cloudflare adapter so `astro build`
// produces the real SSR worker for `vp run -r test`/`vp run -r build` and
// local wrangler smoke runs. The committed astro.config.mjs stays
// adapter-free — the Alchemy deploy build injects this same adapter itself
// and fails if the natively-loaded config already declares one.
import base from "./astro.config.mjs";
import { distilledCloudflare } from "@alchemy.run/frontend-frameworks/astro/cloudflare";

export default {
  ...base,
  output: "server",
  integrations: [...(base.integrations ?? []), distilledCloudflare({})],
};
