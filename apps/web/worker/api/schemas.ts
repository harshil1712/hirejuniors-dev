// Request schemas for the session API (zod + @hono/zod-validator). Response
// types come from the services' return types via the router — nothing else
// lives here.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const JobStatus = z.enum(["pending", "active", "review", "rejected", "retired"]);

export const JobLevel = z.enum(["internship", "apprenticeship", "graduate", "junior"]);

export const JobListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  status: JobStatus.default("active"),
  level: JobLevel.optional(),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/, "ISO alpha-2 country code")
    .optional(),
  companyId: z.string().optional(),
  sourceId: z.string().optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

export const JobUpdate = z.object({ status: z.enum(["active", "retired"]) });

export const JobApprove = z.object({ level: JobLevel });

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export const CompanyCreate = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase slug, dash-separated")
    .optional(),
  homepageUrl: z.url().optional(),
  logoUrl: z.url().optional(),
});

export const CompanyUpdate = z
  .object({
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
  })
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
    message: "at least one field is required",
  });

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const SourcePlatform = z.enum(["greenhouse", "lever", "ashby", "amazon_jobs"]);

/** Board slug as used in the platform API path — no `/`, `?`, `..` tricks. */
const BoardSlug = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "letters, digits, dot, dash or underscore");

export const SourceCreate = z.object({
  companyId: z.string(),
  platform: SourcePlatform,
  // Board token for the platform.
  board: z.union([BoardSlug, z.string().url()]),
  config: z.string().max(4000).default("{}"),
  includeAll: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export const SourceUpdate = z
  .object({
    board: BoardSlug.optional(),
    config: z.string().max(4000).optional(),
    includeAll: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
    message: "at least one field is required",
  });

export const SourcePreview = z.object({
  platform: SourcePlatform,
  board: z.union([BoardSlug, z.string().url()]),
  config: z.string().max(4000).default("{}"),
  includeAll: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const RunListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export const DiscoveryListQuery = z.object({
  status: z.enum(["queued", "found", "not_found", "duplicate", "failed"]).optional(),
  cursor: z.string().optional(),
});

export const DiscoveryAdd = z.object({
  domains: z
    .array(
      z
        .string()
        .regex(/^(?:[a-z0-9][a-z0-9.-]*\.[a-z]{2,}|https?:\/\/\S+)$/i, "hostname or board URL"),
    )
    .min(1)
    .max(500),
});

export type JobStatus = z.infer<typeof JobStatus>;
export type JobLevel = z.infer<typeof JobLevel>;
export type JobListQuery = z.infer<typeof JobListQuery>;
export type JobUpdate = z.infer<typeof JobUpdate>;
export type CompanyCreate = z.infer<typeof CompanyCreate>;
export type CompanyUpdate = z.infer<typeof CompanyUpdate>;
export type SourcePlatform = z.infer<typeof SourcePlatform>;
export type SourceCreate = z.infer<typeof SourceCreate>;
export type SourceUpdate = z.infer<typeof SourceUpdate>;
export type SourcePreview = z.infer<typeof SourcePreview>;
export type RunListQuery = z.infer<typeof RunListQuery>;
export type DiscoveryListQuery = z.infer<typeof DiscoveryListQuery>;
