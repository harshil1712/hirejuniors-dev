import { z } from "zod";
import { decodeEntities } from "../html";
import { normalizeEmploymentType, normalizeWorkplace } from "./normalize";
import type { PlatformAdapter, RawListing } from "./types";

const configSchema = z.object({}).strict();

const locationField = z.union([
  z.string(),
  z.object({ locationName: z.string() }).transform((o) => o.locationName),
]);

const jobSchema = z.object({
  id: z.string(),
  title: z.string(),
  jobUrl: z.string().optional(),
  applyUrl: z.string().optional(),
  location: locationField.optional(),
  employmentType: z.string().optional(),
  isRemote: z.boolean().optional(),
  workplaceType: z.string().optional(),
  address: z
    .object({ postalAddress: z.object({ addressCountry: z.string().optional() }).optional() })
    .optional(),
  publishedAt: z.string().optional(),
  descriptionHtml: z.string().optional(),
  descriptionPlain: z.string().optional(),
});

const responseSchema = z.object({ jobs: z.array(jobSchema) });
export type AshbyPayload = z.input<typeof responseSchema>;

export const ashby: PlatformAdapter<z.infer<typeof configSchema>, AshbyPayload> = {
  configSchema,
  parseConfig: (json) => configSchema.parse(JSON.parse(json)),
  async fetchListings(ctx, src) {
    const fetcher = ctx.fetcher;
    this.parseConfig(src.config);
    const res = await fetcher(`https://api.ashbyhq.com/posting-api/job-board/${src.board}`);
    if (!res.ok) throw new Error(`ashby ${res.status} for board ${src.board}`);
    return this.toListings(await res.json(), src);
  },
  async probe(fetcher, board) {
    try {
      const res = await fetcher(`https://api.ashbyhq.com/posting-api/job-board/${board}`);
      if (!res.ok) return { ok: false };
      z.object({ jobs: z.array(z.object({ id: z.string() })) }).parse(await res.json());
      return { ok: true };
    } catch {
      return { ok: false, networkError: true };
    }
  },
  toListings(payload, _src): RawListing[] {
    const { jobs } = responseSchema.parse(payload);
    return jobs.map((j) => ({
      externalId: j.id,
      title: j.title,
      applyUrl: j.jobUrl ?? j.applyUrl ?? "",
      locationRaw: j.location ?? "",
      employmentTypeHint: normalizeEmploymentType(j.employmentType),
      workplaceHint: j.isRemote ? "remote" : normalizeWorkplace(j.workplaceType),
      countryHint: j.address?.postalAddress?.addressCountry,
      descriptionHtml: decodeEntities(j.descriptionHtml ?? j.descriptionPlain ?? ""),
      postedAt: j.publishedAt ? new Date(j.publishedAt) : undefined,
    }));
  },
};
