// Jobs pipeline schema — migration packages/db/migrations/0004_jobs.sql
// mirrors this file (hand-maintained, see migrations/README.md).
import { nanoid } from "nanoid";
import { desc, relations } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = (prefix: string) =>
  text("id")
    .primaryKey()
    .$defaultFn(() => prefix + nanoid(16));

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .$defaultFn(() => new Date())
    .notNull(),
};

export const company = sqliteTable(
  "company",
  {
    id: id("cmp_"),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    homepageUrl: text("homepage_url"),
    logoUrl: text("logo_url"),
    ...timestamps,
  },
  (table) => [uniqueIndex("company_slug_idx").on(table.slug)],
);

export const source = sqliteTable(
  "source",
  {
    id: id("src_"),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["greenhouse", "lever", "ashby", "amazon_jobs"] }).notNull(),
    /** Greenhouse board token / Lever site / Ashby board name / "amazon". */
    board: text("board").notNull(),
    /** Platform-specific JSON, validated per adapter with zod. */
    config: text("config").notNull().default("{}"),
    /** Skip the junior-level filter — board is already early-career only. */
    includeAll: integer("include_all", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
    lastStatus: text("last_status", { enum: ["succeeded", "failed"] }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [uniqueIndex("source_platform_board_idx").on(table.platform, table.board)],
);

export const job = sqliteTable(
  "job",
  {
    id: id("job_"),
    sourceId: text("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    /** Set on insert, never regenerated. */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    level: text("level", {
      enum: ["internship", "apprenticeship", "graduate", "junior"],
    }).notNull(),
    /** schema.org employmentType. */
    employmentType: text("employment_type", {
      enum: ["FULL_TIME", "PART_TIME", "INTERN", "CONTRACTOR", "TEMPORARY", "OTHER"],
    }),
    workplace: text("workplace", { enum: ["onsite", "hybrid", "remote"] }),
    locationRaw: text("location_raw").notNull(),
    city: text("city"),
    region: text("region"),
    /** ISO 3166-1 alpha-2, upper case. */
    countryCode: text("country_code"),
    /** Raw from source, entity-decoded; sanitised at render time. */
    descriptionHtml: text("description_html"),
    /** Plain text, <= 500 chars, for cards/meta. */
    descriptionText: text("description_text").notNull(),
    applyUrl: text("apply_url").notNull(),
    postedAt: integer("posted_at", { mode: "timestamp_ms" }),
    sourceUpdatedAt: integer("source_updated_at", { mode: "timestamp_ms" }),
    validThrough: integer("valid_through", { mode: "timestamp_ms" }),
    status: text("status", { enum: ["active", "retired"] })
      .notNull()
      .default("active"),
    retiredAt: integer("retired_at", { mode: "timestamp_ms" }),
    retireReason: text("retire_reason", {
      enum: ["missing_from_feed", "link_dead", "expired", "manual"],
    }),
    missedRuns: integer("missed_runs").notNull().default(0),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("job_slug_idx").on(table.slug),
    uniqueIndex("job_source_external_idx").on(table.sourceId, table.externalId),
    index("job_status_posted_idx").on(table.status, desc(table.postedAt)),
    index("job_status_country_idx").on(table.status, table.countryCode),
    index("job_status_level_idx").on(table.status, table.level),
    index("job_company_status_idx").on(table.companyId, table.status),
  ],
);

export const ingestRun = sqliteTable("ingest_run", {
  id: id("run_"),
  trigger: text("trigger", { enum: ["schedule", "manual"] }).notNull(),
  workflowInstanceId: text("workflow_instance_id").notNull(),
  status: text("status", { enum: ["running", "succeeded", "partial", "failed"] })
    .notNull()
    .default("running"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  fetched: integer("fetched").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  reactivated: integer("reactivated").notNull().default(0),
  retired: integer("retired").notNull().default(0),
  error: text("error"),
});

export const sourceRun = sqliteTable("source_run", {
  id: id("srn_"),
  runId: text("run_id")
    .notNull()
    .references(() => ingestRun.id, { onDelete: "cascade" }),
  sourceId: text("source_id")
    .notNull()
    .references(() => source.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
  fetched: integer("fetched").notNull().default(0),
  kept: integer("kept").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  reactivated: integer("reactivated").notNull().default(0),
  retired: integer("retired").notNull().default(0),
  error: text("error"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }).notNull(),
});

export const companyRelations = relations(company, ({ many }) => ({
  sources: many(source),
  jobs: many(job),
}));

export const sourceRelations = relations(source, ({ one, many }) => ({
  company: one(company, { fields: [source.companyId], references: [company.id] }),
  jobs: many(job),
  runs: many(sourceRun),
}));

export const jobRelations = relations(job, ({ one }) => ({
  source: one(source, { fields: [job.sourceId], references: [source.id] }),
  company: one(company, { fields: [job.companyId], references: [company.id] }),
}));

export const ingestRunRelations = relations(ingestRun, ({ many }) => ({
  sourceRuns: many(sourceRun),
}));

export const sourceRunRelations = relations(sourceRun, ({ one }) => ({
  run: one(ingestRun, { fields: [sourceRun.runId], references: [ingestRun.id] }),
  source: one(source, { fields: [sourceRun.sourceId], references: [source.id] }),
}));
