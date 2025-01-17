import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";

export const jobs = sqliteTable("jobs", {
  id: integer().primaryKey({ autoIncrement: true }),
  listingId: text('listing_id').notNull().unique(),
  title: text().notNull(),
  city: text().notNull(),
  countryCode: text('country_code').notNull(),
  description: text().notNull(),
  jobType: text('job_type').notNull(),
  portalPostedDate: text('portal_posted_date').notNull(),
  companyListingUrl: text('company_listing_url').notNull(),
  portalUpdatedTime: text('portal_updated_time').notNull(),
  createdAt: text('created_at').notNull().default(sql`(CURRENT_TIME)`),
  updatedAt: text('updated_at').notNull().default(sql`(CURRENT_TIME)`),
  archived: integer({ mode: 'boolean' }).notNull().default(false),
  companyId: integer('company_id').references(() => companies.id),
}, (table) => {
  return {
    titleIdx: index('title_idx').on(table.title).where(sql`archived = 0`),
    countryIdx: index('country_idx').on(table.countryCode).where(sql`archived = 0`),
    jobTypeIdx: index('job_type_idx').on(table.jobType).where(sql`archived = 0`),
    archivedIdx: index('archived_idx').on(table.archived),
  };
})

export const companies = sqliteTable("companies", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  createdAt: text('created_at').notNull().default(sql`(CURRENT_TIME)`),
  updatedAt: text('updated_at').notNull().default(sql`(CURRENT_TIME)`),
  homepageUrl: text('homepage_url').notNull(),
  logo: text().notNull(),
}, (table) => {
  return {
    nameIdx: index('name_idx').on(table.name),
  };
})

export const companiesRelation = relations(companies, ({ many }) => ({
  jobs: many(jobs)
}))

export const jobsRelation = relations(jobs, ({ one }) => ({
  company: one(companies, {
    fields: [jobs.companyId],
    references: [companies.id],
  })
}))

export const insertCompany = createInsertSchema(companies);
export const insertJob = createInsertSchema(jobs);

export type Job = typeof jobs.$inferSelect;
export type Company = typeof companies.$inferSelect;