import { env, applyD1Migrations } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { company, source } from "@hirejuniors/db/schema";
import type { RawListing } from "../src/platforms";

// `cloudflare:test` env is the generated Cloudflare.Env; our bindings come
// from the vitest wrangler config, so narrow once here instead of per use.
const testEnv = env as Env;

let migrated = false;
export async function migrate() {
  if (migrated) return;
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS!);
  migrated = true;
}

export function db() {
  return drizzle(testEnv.DB);
}

export async function seedCompany(over: Partial<typeof company.$inferInsert> = {}) {
  const row = {
    id: "cmp_test00000001",
    slug: "testco",
    name: "Test Co",
    ...over,
  };
  await db().insert(company).values(row);
  return row;
}

export async function seedSource(over: Partial<typeof source.$inferInsert> = {}) {
  const row = {
    id: "src_test00000001",
    companyId: "cmp_test00000001",
    platform: "lever" as const,
    board: over.id ?? "testco",
    config: "{}",
    ...over,
  };
  await db().insert(source).values(row);
  const saved = await db().select().from(source).where(eq(source.id, row.id));
  return saved[0];
}

let n = 0;
export function listing(over: Partial<RawListing> = {}): RawListing {
  n++;
  return {
    externalId: `ext-${n}`,
    title: `Graduate Engineer ${n}`,
    applyUrl: `https://jobs.example.com/${n}`,
    locationRaw: "Austin, TX, United States",
    ...over,
  };
}
