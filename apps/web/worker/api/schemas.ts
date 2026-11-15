import { z } from "@hono/zod-openapi";

const JOB_EXAMPLE = {
  id: "job_9f2kLmQwXyZaBcDe",
  slug: "software-engineer-intern-cloudflare-a1b2c3",
  title: "Software Engineer Intern",
  level: "internship",
  employmentType: "INTERN",
  workplace: "hybrid",
  locationRaw: "Austin, TX, United States",
  city: "Austin",
  region: "TX",
  countryCode: "US",
  descriptionText: "Work on Cloudflare's network…",
  applyUrl: "https://boards.greenhouse.io/cloudflare/jobs/123",
  postedAt: "2026-02-02T17:45:00.000Z",
  firstSeenAt: "2026-02-03T06:00:00.000Z",
  lastSeenAt: "2026-02-09T06:00:00.000Z",
  status: "active",
  retiredAt: null,
  retireReason: null,
  missedRuns: 0,
  company: { id: "cmp_cloudflare000001", name: "Cloudflare", slug: "cloudflare" },
  sourceId: "src_cf_greenhouse01",
} as const;

const COMPANY_EXAMPLE = {
  id: "cmp_cloudflare000001",
  name: "Cloudflare",
  slug: "cloudflare",
  homepageUrl: "https://www.cloudflare.com",
  logoUrl: null,
  createdAt: "2026-01-15T09:30:00.000Z",
  updatedAt: "2026-02-02T17:45:00.000Z",
} as const;

const SOURCE_EXAMPLE = {
  id: "src_cf_greenhouse01",
  company: { id: "cmp_cloudflare000001", name: "Cloudflare", slug: "cloudflare" },
  platform: "greenhouse",
  board: "cloudflare",
  config: "{}",
  includeAll: false,
  enabled: true,
  lastRunAt: "2026-02-09T06:00:00.000Z",
  lastStatus: "succeeded",
  lastError: null,
  activeJobs: 42,
  createdAt: "2026-01-15T09:30:00.000Z",
  updatedAt: "2026-02-02T17:45:00.000Z",
} as const;

const RUN_EXAMPLE = {
  id: "run_9f2kLmQwXyZaBcDe",
  trigger: "schedule",
  status: "succeeded",
  startedAt: "2026-02-09T06:00:00.000Z",
  finishedAt: "2026-02-09T06:04:12.000Z",
  fetched: 812,
  inserted: 34,
  updated: 120,
  reactivated: 2,
  retired: 9,
  error: null,
} as const;

const API_KEY_EXAMPLE = {
  id: "k_2aF9xQzLmNpRwVbCtYsEuHgJdKiO",
  key: "hj_9f2kLmQwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZ",
  name: "Claude Code",
  start: "hj_9f2",
  expiresAt: "2027-01-15T09:30:00.000Z",
  scopes: ["jobs:read"],
} as const;

const ME_EXAMPLE = {
  userId: "O4q6Rkcv8paDGK8krUsg0a9mBZ2k6FiZ",
  email: "you@example.com",
  name: "You",
  keyId: "k_2aF9xQzLmNpRwVbCtYsEuHgJdKiO",
  scopes: ["jobs:read"],
} as const;

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const JobStatus = z
  .enum(["pending", "active", "review", "rejected", "retired"])
  .openapi("JobStatus", { example: "active" });

export const JobLevel = z
  .enum(["internship", "apprenticeship", "graduate", "junior"])
  .openapi("JobLevel", { example: "internship" });

export const Job = z
  .object({
    id: z.string().openapi({ example: JOB_EXAMPLE.id }),
    slug: z.string().openapi({ example: JOB_EXAMPLE.slug }),
    title: z.string().openapi({ example: JOB_EXAMPLE.title }),
    level: JobLevel.nullable(),
    employmentType: z.string().nullable().openapi({ example: "INTERN" }),
    workplace: z.string().nullable().openapi({ example: "hybrid" }),
    locationRaw: z.string().openapi({ example: JOB_EXAMPLE.locationRaw }),
    city: z.string().nullable().openapi({ example: "Austin" }),
    region: z.string().nullable().openapi({ example: "TX" }),
    countryCode: z.string().nullable().openapi({ example: "US" }),
    descriptionHtml: z.string().nullable(),
    descriptionText: z.string().openapi({ example: JOB_EXAMPLE.descriptionText }),
    applyUrl: z.string().openapi({ example: JOB_EXAMPLE.applyUrl }),
    postedAt: z.iso.datetime().nullable().openapi({ example: JOB_EXAMPLE.postedAt }),
    sourceUpdatedAt: z.iso.datetime().nullable().openapi({ example: JOB_EXAMPLE.postedAt }),
    validThrough: z.iso.datetime().nullable().openapi({ example: null }),
    firstSeenAt: z.iso.datetime().openapi({ example: JOB_EXAMPLE.firstSeenAt }),
    lastSeenAt: z.iso.datetime().openapi({ example: JOB_EXAMPLE.lastSeenAt }),
    lastCheckedAt: z.iso.datetime().nullable().openapi({ example: JOB_EXAMPLE.lastSeenAt }),
    status: JobStatus,
    retiredAt: z.iso.datetime().nullable().openapi({ example: null }),
    retireReason: z
      .enum(["missing_from_feed", "link_dead", "closed_page", "expired", "manual"])
      .nullable()
      .openapi({ example: null }),
    classifiedAt: z.iso.datetime().nullable().openapi({ example: null }),
    classifiedBy: z
      .enum(["rules", "clef-flash", "clef", "admin"])
      .nullable()
      .openapi({ example: "clef-flash" }),
    classifierConfidence: z.number().nullable().openapi({ example: null }),
    rejectReason: z
      .enum(["not_early_career", "not_tech", "experience", "admin"])
      .nullable()
      .openapi({ example: null }),
    reviewReason: z.string().nullable().openapi({ example: null }),
    minYearsExperience: z.number().int().nullable().openapi({ example: null }),
    salaryMin: z.number().int().nullable().openapi({ example: null }),
    salaryMax: z.number().int().nullable().openapi({ example: null }),
    salaryCurrency: z.string().nullable().openapi({ example: null }),
    salaryPeriod: z.enum(["HOUR", "WEEK", "MONTH", "YEAR"]).nullable().openapi({ example: null }),
    graduationYear: z.number().int().nullable().openapi({ example: null }),
    missedRuns: z.number().int().openapi({ example: 0 }),
    createdAt: z.iso.datetime().openapi({ example: JOB_EXAMPLE.firstSeenAt }),
    updatedAt: z.iso.datetime().openapi({ example: JOB_EXAMPLE.lastSeenAt }),
    companyId: z.string().openapi({ example: COMPANY_EXAMPLE.id }),
    sourceId: z.string().openapi({ example: SOURCE_EXAMPLE.id }),
    company: z
      .object({
        id: z.string().openapi({ example: COMPANY_EXAMPLE.id }),
        name: z.string().openapi({ example: "Cloudflare" }),
        slug: z.string().openapi({ example: "cloudflare" }),
      })
      .openapi({ example: JOB_EXAMPLE.company }),
  })
  .openapi("Job");

export const JobListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
    status: JobStatus.default("active"),
    level: JobLevel.optional(),
    country: z
      .string()
      .regex(/^[A-Za-z]{2}$/, "ISO alpha-2 country code")
      .optional()
      .openapi({ example: "US" }),
    companyId: z.string().optional(),
    sourceId: z.string().optional(),
    q: z.string().trim().min(1).max(120).optional().openapi({ example: "intern" }),
  })
  .openapi("JobListQuery");

export const JobUpdate = z
  .object({ status: z.enum(["active", "retired"]) })
  .openapi("JobUpdate", { example: { status: "retired" } });

export const JobList = z
  .object({
    data: z.array(Job),
    nextCursor: z.string().nullable().openapi({ example: "MTc3MDAwMDAwMDAwMDpqb2JfOWYyaw" }),
  })
  .openapi("JobList");

export const JobResult = z.object({ data: Job }).openapi("JobResult", {
  example: { data: JOB_EXAMPLE },
});

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export const Company = z
  .object({
    id: z.string().openapi({ example: COMPANY_EXAMPLE.id }),
    name: z.string().openapi({ example: "Cloudflare" }),
    slug: z.string().openapi({ example: "cloudflare" }),
    homepageUrl: z.string().nullable().openapi({ example: "https://www.cloudflare.com" }),
    logoUrl: z.string().nullable().openapi({ example: null }),
    createdAt: z.iso.datetime().openapi({ example: COMPANY_EXAMPLE.createdAt }),
    updatedAt: z.iso.datetime().openapi({ example: COMPANY_EXAMPLE.updatedAt }),
  })
  .openapi("Company");

export const CompanyCreate = z
  .object({
    name: z.string().trim().min(1).max(120).openapi({ example: "Cloudflare" }),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase slug, dash-separated")
      .optional()
      .openapi({ example: "cloudflare" }),
    homepageUrl: z.url().optional().openapi({ example: "https://www.cloudflare.com" }),
    logoUrl: z.url().optional(),
  })
  .openapi("CompanyCreate");

export const CompanyPatchFields = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase slug, dash-separated")
    .optional(),
  homepageUrl: z.url().nullable().optional(),
  logoUrl: z.url().nullable().optional(),
});

export const CompanyUpdate = CompanyPatchFields.refine(
  (patch) => Object.values(patch).some((v) => v !== undefined),
  { message: "at least one field is required" },
).openapi("CompanyUpdate", { example: { homepageUrl: "https://www.cloudflare.com" } });

export const CompanyList = z.object({ data: z.array(Company) }).openapi("CompanyList", {
  example: { data: [COMPANY_EXAMPLE] },
});
export const CompanyResult = z.object({ data: Company }).openapi("CompanyResult", {
  example: { data: COMPANY_EXAMPLE },
});

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const SourcePlatform = z
  .enum(["greenhouse", "lever", "ashby", "amazon_jobs", "careers_page"])
  .openapi("SourcePlatform", { example: "greenhouse" });

export const Source = z
  .object({
    id: z.string().openapi({ example: SOURCE_EXAMPLE.id }),
    company: z
      .object({
        id: z.string().openapi({ example: COMPANY_EXAMPLE.id }),
        name: z.string().openapi({ example: "Cloudflare" }),
        slug: z.string().openapi({ example: "cloudflare" }),
      })
      .openapi({ example: SOURCE_EXAMPLE.company }),
    platform: SourcePlatform,
    board: z.string().openapi({ example: "cloudflare" }),
    /** Platform-specific JSON — validated by that platform's adapter. */
    config: z.string().openapi({ example: "{}" }),
    includeAll: z.boolean().openapi({ example: false }),
    enabled: z.boolean().openapi({ example: true }),
    origin: z.enum(["seed", "manual", "discovered"]).openapi({ example: "manual" }),
    trial: z.boolean().openapi({ example: false }),
    disabledReason: z.enum(["no_junior_roles", "manual"]).nullable().openapi({ example: null }),
    lastFetched: z.number().int().nullable().openapi({ example: 12 }),
    lastRunAt: z.iso.datetime().nullable().openapi({ example: SOURCE_EXAMPLE.lastRunAt }),
    lastStatus: z.enum(["succeeded", "failed"]).nullable().openapi({ example: "succeeded" }),
    lastError: z.string().nullable().openapi({ example: null }),
    activeJobs: z.number().int().openapi({ example: 42 }),
    createdAt: z.iso.datetime().openapi({ example: SOURCE_EXAMPLE.createdAt }),
    updatedAt: z.iso.datetime().openapi({ example: SOURCE_EXAMPLE.updatedAt }),
  })
  .openapi("Source");

/** Board slug as used in the platform API path — no `/`, `?`, `..` tricks. */
const BoardSlug = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "letters, digits, dot, dash or underscore");

export const SourceCreate = z
  .object({
    companyId: z.string().openapi({ example: COMPANY_EXAMPLE.id }),
    platform: SourcePlatform,
    // Board token for ATS platforms; a listing URL for careers_page.
    board: z.union([BoardSlug, z.string().url()]).openapi({ example: "cloudflare" }),
    config: z.string().max(4000).default("{}").openapi({ example: "{}" }),
    includeAll: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .openapi("SourceCreate");

export const SourcePatchFields = z.object({
  board: BoardSlug.optional(),
  config: z.string().max(4000).optional(),
  includeAll: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const SourceUpdate = SourcePatchFields.refine(
  (patch) => Object.values(patch).some((v) => v !== undefined),
  { message: "at least one field is required" },
).openapi("SourceUpdate", { example: { enabled: false } });

export const SourcePreview = z
  .object({
    platform: SourcePlatform,
    board: z.union([BoardSlug, z.string().url()]).openapi({ example: "cloudflare" }),
    config: z.string().max(4000).default("{}").openapi({ example: "{}" }),
    includeAll: z.boolean().default(false),
  })
  .openapi("SourcePreview");

export const SourcePreviewResult = z
  .object({
    data: z.object({
      fetched: z.number().int().openapi({ example: 812 }),
      kept: z.number().int().openapi({ example: 34 }),
      sample: z
        .array(
          z.object({
            title: z.string().openapi({ example: "Software Engineer Intern" }),
            level: JobLevel.nullable(),
            locationRaw: z.string().openapi({ example: "Austin, TX, United States" }),
            countryCode: z.string().nullable().openapi({ example: "US" }),
          }),
        )
        .openapi({ example: [] }),
    }),
  })
  .openapi("SourcePreviewResult", {
    example: {
      data: {
        fetched: 812,
        kept: 34,
        sample: [
          {
            title: "Software Engineer Intern",
            level: "internship",
            locationRaw: "Austin, TX, United States",
            countryCode: "US",
          },
        ],
      },
    },
  });

export const SourceList = z.object({ data: z.array(Source) }).openapi("SourceList", {
  example: { data: [SOURCE_EXAMPLE] },
});
export const SourceResult = z.object({ data: Source }).openapi("SourceResult", {
  example: { data: SOURCE_EXAMPLE },
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const IngestRun = z
  .object({
    id: z.string().openapi({ example: RUN_EXAMPLE.id }),
    trigger: z.enum(["schedule", "manual"]).openapi({ example: "schedule" }),
    status: z.enum(["running", "succeeded", "partial", "failed"]).openapi({
      example: "succeeded",
    }),
    startedAt: z.iso.datetime().openapi({ example: RUN_EXAMPLE.startedAt }),
    finishedAt: z.iso.datetime().nullable().openapi({ example: RUN_EXAMPLE.finishedAt }),
    fetched: z.number().int().openapi({ example: 812 }),
    inserted: z.number().int().openapi({ example: 34 }),
    updated: z.number().int().openapi({ example: 120 }),
    reactivated: z.number().int().openapi({ example: 2 }),
    retired: z.number().int().openapi({ example: 9 }),
    classified: z.number().int().openapi({ example: 40 }),
    rejected: z.number().int().openapi({ example: 5 }),
    review: z.number().int().openapi({ example: 3 }),
    discovered: z.number().int().openapi({ example: 7 }),
    aiInputTokens: z.number().int().openapi({ example: 12500 }),
    aiOutputTokens: z.number().int().openapi({ example: 800 }),
    browserMs: z.number().int().openapi({ example: 4200 }),
    error: z.string().nullable().openapi({ example: null }),
  })
  .openapi("IngestRun");

export const SourceRun = z
  .object({
    id: z.string().openapi({ example: "srn_9f2kLmQwXyZaBcDe" }),
    sourceId: z.string().openapi({ example: SOURCE_EXAMPLE.id }),
    sourceName: z.string().openapi({ example: "greenhouse/cloudflare" }),
    companyName: z.string().openapi({ example: "Cloudflare" }),
    status: z.enum(["succeeded", "failed"]).openapi({ example: "succeeded" }),
    fetched: z.number().int().openapi({ example: 812 }),
    kept: z.number().int().openapi({ example: 34 }),
    inserted: z.number().int().openapi({ example: 34 }),
    updated: z.number().int().openapi({ example: 120 }),
    reactivated: z.number().int().openapi({ example: 2 }),
    retired: z.number().int().openapi({ example: 9 }),
    error: z.string().nullable().openapi({ example: null }),
    startedAt: z.iso.datetime().openapi({ example: RUN_EXAMPLE.startedAt }),
    finishedAt: z.iso.datetime().openapi({ example: RUN_EXAMPLE.finishedAt }),
  })
  .openapi("SourceRun");

export const RunListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
  })
  .openapi("RunListQuery");

export const RunList = z
  .object({
    data: z.array(IngestRun),
    nextCursor: z.string().nullable().openapi({ example: "MTc3MDAwMDAwMDAwMDpydW5fOWYyaw" }),
  })
  .openapi("RunList");

export const RunDetail = z
  .object({ data: IngestRun.extend({ sourceRuns: z.array(SourceRun) }) })
  .openapi("RunDetail", { example: { data: { ...RUN_EXAMPLE, sourceRuns: [] } } });

export const RunTriggered = z
  .object({ data: z.object({ instanceId: z.string().openapi({ example: "01JXYZ…" }) }) })
  .openapi("RunTriggered", { example: { data: { instanceId: "01JXYZ" } } });

// ---------------------------------------------------------------------------
// Dashboard summary (session-only surface)
// ---------------------------------------------------------------------------

export const DashboardSummary = z
  .object({
    data: z.object({
      activeJobs: z.number().int().openapi({ example: 142 }),
      retiredLast7Days: z.number().int().openapi({ example: 6 }),
      failingSources: z.number().int().openapi({ example: 1 }),
      lastRun: IngestRun.nullable(),
    }),
  })
  .openapi("DashboardSummary", {
    example: {
      data: { activeJobs: 142, retiredLast7Days: 6, failingSources: 1, lastRun: RUN_EXAMPLE },
    },
  });

// ---------------------------------------------------------------------------
// Errors / keys / identity
// ---------------------------------------------------------------------------

export const ErrorDetail = z
  .object({
    path: z.string().openapi({ example: "name" }),
    message: z.string().openapi({ example: "String must contain at least 1 character(s)" }),
  })
  .openapi("ErrorDetail");

export const ErrorBody = z
  .object({
    code: z.string().openapi({ example: "validation_failed" }),
    message: z.string().openapi({ example: "name must be 1-120 characters" }),
    requestId: z.string().openapi({ example: "0f8fad5b-d9cb-469f-a165-70867728950e" }),
    details: z.array(ErrorDetail).optional(),
  })
  .openapi("ErrorBody");

/** The uniform error envelope: every non-2xx response body. */
export const ErrorResponse = z.object({ error: ErrorBody }).openapi("ErrorResponse", {
  example: {
    error: {
      code: "not_found",
      message: "No such job: job_9f2kLmQwXyZaBcDe",
      requestId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    },
  },
});

export const Scope = z.enum(["jobs:read", "jobs:write"]).openapi("Scope", { example: "jobs:read" });

export const ApiKeyCreate = z
  .object({
    name: z.string().trim().min(1).max(32).openapi({ example: "Claude Code" }),
    scopes: z.array(Scope).min(1),
    expiresInDays: z
      .union([z.literal(30), z.literal(90), z.literal(365), z.null()])
      .openapi({ example: 90 }),
  })
  .openapi("ApiKeyCreate");

export const ApiKeyCreated = z
  .object({
    id: z.string().openapi({ example: "k_2aF9xQzLmNpRwVbCtYsEuHgJdKiO" }),
    /** The full key — returned once at creation, never again. */
    key: z.string().openapi({ example: "hj_9f2kLmQwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZ" }),
    name: z.string().nullable().openapi({ example: "Claude Code" }),
    start: z.string().nullable().openapi({ example: "hj_9f2" }),
    expiresAt: z.iso.datetime().nullable().openapi({ example: "2027-01-15T09:30:00.000Z" }),
    scopes: z.array(Scope),
  })
  .openapi("ApiKeyCreated");

export const ApiKeyResult = z.object({ data: ApiKeyCreated }).openapi("ApiKeyResult", {
  example: { data: API_KEY_EXAMPLE },
});

export const Me = z
  .object({
    userId: z.string().openapi({ example: "O4q6Rkcv8paDGK8krUsg0a9mBZ2k6FiZ" }),
    email: z.string().openapi({ example: "you@example.com" }),
    name: z.string().openapi({ example: "You" }),
    keyId: z.string().nullable().openapi({ example: "k_2aF9xQzLmNpRwVbCtYsEuHgJdKiO" }),
    scopes: z.array(Scope),
  })
  .openapi("Me");

export const MeResult = z.object({ data: Me }).openapi("MeResult", {
  example: { data: ME_EXAMPLE },
});

export type JobStatus = z.infer<typeof JobStatus>;
export type JobLevel = z.infer<typeof JobLevel>;
export type Job = z.infer<typeof Job>;
export type JobListQuery = z.infer<typeof JobListQuery>;
export type JobUpdate = z.infer<typeof JobUpdate>;
export type JobList = z.infer<typeof JobList>;
export type Company = z.infer<typeof Company>;
export type CompanyCreate = z.infer<typeof CompanyCreate>;
export type CompanyUpdate = z.infer<typeof CompanyUpdate>;
export type SourcePlatform = z.infer<typeof SourcePlatform>;
export type Source = z.infer<typeof Source>;
export type SourceCreate = z.infer<typeof SourceCreate>;
export type SourceUpdate = z.infer<typeof SourceUpdate>;
export type SourcePreview = z.infer<typeof SourcePreview>;
export type SourcePreviewResult = z.infer<typeof SourcePreviewResult>;
export type IngestRun = z.infer<typeof IngestRun>;
export type SourceRun = z.infer<typeof SourceRun>;
export type RunListQuery = z.infer<typeof RunListQuery>;
export type DashboardSummary = z.infer<typeof DashboardSummary>;
export type ErrorBody = z.infer<typeof ErrorBody>;
export type Scope = z.infer<typeof Scope>;
export type ApiKeyCreate = z.infer<typeof ApiKeyCreate>;
export type ApiKeyCreated = z.infer<typeof ApiKeyCreated>;
export type Me = z.infer<typeof Me>;

export const JobApprove = z
  .object({ level: JobLevel })
  .openapi("JobApprove", { example: { level: "junior" } });

export const DiscoveryAdd = z
  .object({
    domains: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i, "valid hostname"))
      .min(1)
      .max(500),
  })
  .openapi("DiscoveryAdd", { example: { domains: ["stripe.com", "figma.com"] } });

export const DiscoveryCandidate = z
  .object({
    id: z.string(),
    origin: z.enum(["manual", "crawl"]),
    input: z.string().openapi({ example: "stripe.com" }),
    status: z.enum(["queued", "found", "not_found", "duplicate", "failed"]),
    platform: z.enum(["greenhouse", "lever", "ashby", "amazon_jobs", "careers_page"]).nullable(),
    board: z.string().nullable(),
    sourceId: z.string().nullable(),
    error: z.string().nullable(),
    attempts: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi("DiscoveryCandidate");

export const DiscoveryList = z
  .object({
    data: z.array(DiscoveryCandidate).openapi({ example: [] }),
    nextCursor: z.string().nullable().openapi({ example: null }),
  })
  .openapi("DiscoveryList");

export const DiscoveryAddResult = z
  .object({
    data: z.object({ added: z.number().int() }).openapi({ example: { added: 3 } }),
  })
  .openapi("DiscoveryAddResult");
