import { asc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { company } from "../../schema/db";
import type { CompanyCreate, CompanyUpdate } from "../api/schemas";
import { ServiceError } from "./errors";
import { slugify } from "@hirejuniors/jobs/slug";

type Db = DrizzleD1Database;

function toApi(row: typeof company.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    homepageUrl: row.homepageUrl,
    logoUrl: row.logoUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function list(db: Db) {
  return db
    .select()
    .from(company)
    .orderBy(asc(company.name), asc(company.id))
    .then((rows) => rows.map(toApi));
}

export async function create(db: Db, input: CompanyCreate) {
  const slug = input.slug ?? slugify(input.name);
  const existing = await db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.slug, slug))
    .get();
  if (existing) throw new ServiceError("conflict", `A company with slug ${slug} already exists`);
  const now = new Date();
  await db.insert(company).values({
    name: input.name,
    slug,
    homepageUrl: input.homepageUrl ?? null,
    logoUrl: input.logoUrl ?? null,
    createdAt: now,
    updatedAt: now,
  });
  const row = await db.select().from(company).where(eq(company.slug, slug)).get();
  return toApi(row!);
}

export async function update(db: Db, id: string, patch: CompanyUpdate) {
  const existing = await db.select().from(company).where(eq(company.id, id)).get();
  if (!existing) throw new ServiceError("not_found", `No such company: ${id}`);
  if (patch.slug !== undefined && patch.slug !== existing.slug) {
    const dupe = await db
      .select({ id: company.id })
      .from(company)
      .where(eq(company.slug, patch.slug))
      .get();
    if (dupe) {
      throw new ServiceError("conflict", `A company with slug ${patch.slug} already exists`);
    }
  }
  await db
    .update(company)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(company.id, id));
  return toApi((await db.select().from(company).where(eq(company.id, id)).get())!);
}
