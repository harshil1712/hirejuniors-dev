import { z } from "@hono/zod-openapi";

const PROJECT_EXAMPLE = {
  id: "prj_9f2kLmQwXyZaBcDe",
  name: "Website rebuild",
  status: "active",
  notes: "Migrate to the new design system",
  createdAt: "2026-01-15T09:30:00.000Z",
  updatedAt: "2026-02-02T17:45:00.000Z",
} as const;

const API_KEY_EXAMPLE = {
  id: "k_2aF9xQzLmNpRwVbCtYsEuHgJdKiO",
  key: "hj_9f2kLmQwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZ",
  name: "Claude Code",
  start: "hj_9f2",
  expiresAt: "2027-01-15T09:30:00.000Z",
  scopes: ["projects:read"],
} as const;

const ME_EXAMPLE = {
  userId: "O4q6Rkcv8paDGK8krUsg0a9mBZ2k6FiZ",
  email: "you@example.com",
  name: "You",
  keyId: "k_2aF9xQzLmNpRwVbCtYsEuHgJdKiO",
  scopes: ["projects:read"],
} as const;

export const ProjectStatus = z
  .enum(["active", "paused", "archived"])
  .openapi("ProjectStatus", { example: "active" });

export const Project = z
  .object({
    id: z.string().openapi({ example: "prj_9f2kLmQwXyZaBcDe" }),
    name: z.string().openapi({ example: "Website rebuild" }),
    status: ProjectStatus,
    notes: z.string().openapi({ example: "Migrate to the new design system" }),
    createdAt: z.iso.datetime().openapi({ example: "2026-01-15T09:30:00.000Z" }),
    updatedAt: z.iso.datetime().openapi({ example: "2026-02-02T17:45:00.000Z" }),
  })
  .openapi("Project");

export const ProjectCreate = z
  .object({
    name: z.string().trim().min(1).max(80).openapi({ example: "Website rebuild" }),
    status: ProjectStatus.optional(),
    notes: z.string().max(2000).optional(),
  })
  .openapi("ProjectCreate");

export const ProjectPatchFields = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  status: ProjectStatus.optional(),
  notes: z.string().max(2000).optional(),
});

export const ProjectUpdate = ProjectPatchFields.refine(
  (patch) => Object.values(patch).some((v) => v !== undefined),
  { message: "at least one field is required" },
).openapi("ProjectUpdate", { example: { status: "paused" } });

export const ProjectListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
    status: ProjectStatus.optional(),
  })
  .openapi("ProjectListQuery");

export const ProjectList = z
  .object({
    data: z.array(Project),
    nextCursor: z.string().nullable().openapi({ example: "MTc3MDAwMDAwMDAwMDpwcmpfOWYyaw" }),
  })
  .openapi("ProjectList");

export const ErrorDetail = z
  .object({
    path: z.string().openapi({ example: "name" }),
    message: z.string().openapi({ example: "String must contain at least 1 character(s)" }),
  })
  .openapi("ErrorDetail");

export const ErrorBody = z
  .object({
    code: z.string().openapi({ example: "validation_failed" }),
    message: z.string().openapi({ example: "name must be 1-80 characters" }),
    requestId: z.string().openapi({ example: "0f8fad5b-d9cb-469f-a165-70867728950e" }),
    details: z.array(ErrorDetail).optional(),
  })
  .openapi("ErrorBody");

export const ProjectResult = z.object({ data: Project }).openapi("ProjectResult", {
  example: { data: PROJECT_EXAMPLE },
});

/** The uniform error envelope: every non-2xx response body. */
export const ErrorResponse = z.object({ error: ErrorBody }).openapi("ErrorResponse", {
  example: {
    error: {
      code: "not_found",
      message: "No such project: prj_9f2kLmQwXyZaBcDe",
      requestId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    },
  },
});

export type ProjectStatus = z.infer<typeof ProjectStatus>;
export type Project = z.infer<typeof Project>;
export type ProjectCreate = z.infer<typeof ProjectCreate>;
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;
export type ProjectListQuery = z.infer<typeof ProjectListQuery>;
export type ProjectList = z.infer<typeof ProjectList>;
export type ErrorBody = z.infer<typeof ErrorBody>;

export const Scope = z
  .enum(["projects:read", "projects:write"])
  .openapi("Scope", { example: "projects:read" });

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

export type Scope = z.infer<typeof Scope>;
export type ApiKeyCreate = z.infer<typeof ApiKeyCreate>;
export type ApiKeyCreated = z.infer<typeof ApiKeyCreated>;
export type Me = z.infer<typeof Me>;
