import { z } from "zod";
import { decodeEntities } from "../html";
import { normalizeEmploymentType } from "./normalize";
import type { PlatformAdapter, RawListing } from "./types";

const configSchema = z.object({
  /** Query string for search.json (the student-programs search). */
  query: z.string(),
});

const jobSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  city: z.string().optional(),
  country_code: z.string().optional(),
  description_short: z.string().optional(),
  job_schedule_type: z.string().optional(),
  posted_date: z.string().optional(),
  job_path: z.string(),
  updated_time: z.string().optional(),
  description: z.string().optional(),
  basic_qualifications: z.string().optional(),
  preferred_qualifications: z.string().optional(),
});

const responseSchema = z.object({ jobs: z.array(jobSchema) });
export type AmazonPayload = z.input<typeof responseSchema>;

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export const amazonJobs: PlatformAdapter<z.infer<typeof configSchema>, AmazonPayload> = {
  configSchema,
  parseConfig: (json) => configSchema.parse(JSON.parse(json)),
  async fetchListings(fetcher, src) {
    const config = this.parseConfig(src.config);
    const res = await fetcher(`https://www.amazon.jobs/en/search.json?${config.query}`);
    if (!res.ok) throw new Error(`amazon.jobs ${res.status}`);
    return this.toListings(await res.json(), src);
  },
  toListings(payload, _src): RawListing[] {
    const { jobs } = responseSchema.parse(payload);
    return jobs.map((j) => ({
      externalId: String(j.id),
      title: j.title,
      applyUrl: `https://www.amazon.jobs${j.job_path}`,
      locationRaw: [j.city, j.country_code].filter(Boolean).join(", "),
      employmentTypeHint: normalizeEmploymentType(j.job_schedule_type),
      countryHint: j.country_code,
      descriptionHtml: decodeEntities(
        j.description ?? j.description_short ?? j.basic_qualifications ?? "",
      ),
      postedAt: parseDate(j.posted_date),
      updatedAt: parseDate(j.updated_time),
    }));
  },
};
