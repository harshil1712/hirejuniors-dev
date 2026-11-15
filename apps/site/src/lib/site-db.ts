// D1 access for SSR pages. The Alchemy Astro adapter binds the shared
// database as `DB` (see alchemy.run.ts) — read it off the Worker's env.
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import type { Db } from "@hirejuniors/db/queries";

export function siteDb(): Db {
  const e: { DB?: D1Database } = env;
  if (!e.DB) throw new Error("DB binding is not configured on the site worker");
  return drizzle(e.DB);
}
