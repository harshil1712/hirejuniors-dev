/// <reference path="../.astro/types.d.ts" />
declare module "#project" {
  export const PROJECT: {
    name: string;
    productName: string;
    domain: string;
    appSubdomain: string;
    emailFrom: string;
  };
  export const APP_DOMAIN: string;
}

/** Worker bindings exposed to SSR pages via cloudflare:workers (the Alchemy
 * Astro adapter injects the runtime; env mirrors the Site env block). */
declare module "cloudflare:workers" {
  export const env: { DB: D1Database; PUBLIC_APP_URL?: string };
}
