import { z } from "zod";
import { decodeEntities } from "../html";
import { normalizeEmploymentType, normalizeWorkplace } from "./normalize";
import { parseJobList } from "./tolerant";
import type { PlatformAdapter, RawListing } from "./types";

const configSchema = z.object({}).strict();

const locationField = z.union([
  z.string(),
  z.object({ locationName: z.string() }).transform((o) => o.locationName),
]);

// Every optional field is .nullish() — Ashby returns explicit nulls
// (e.g. isRemote/workplaceType on Notion's board) which are treated as absent.
const jobSchema = z.object({
  id: z.string(),
  title: z.string(),
  jobUrl: z.string().nullish(),
  applyUrl: z.string().nullish(),
  location: locationField.nullish(),
  employmentType: z.string().nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  address: z
    .object({ postalAddress: z.object({ addressCountry: z.string().nullish() }).nullish() })
    .nullish(),
  publishedAt: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
});

// Envelope only — individual jobs are validated one by one in toListings.
const envelopeSchema = z.object({ jobs: z.array(z.unknown()) });
export type AshbyPayload = z.input<typeof envelopeSchema>;

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
    let res: Response;
    try {
      res = await fetcher(`https://api.ashbyhq.com/posting-api/job-board/${board}`);
    } catch {
      return { ok: false, networkError: true };
    }
    if (!res.ok) return { ok: false };
    try {
      envelopeSchema.parse(await res.json());
    } catch {
      return { ok: false }; // answered, but not an Ashby payload — a real answer
    }
    return { ok: true };
  },
  toListings(payload, _src): RawListing[] {
    const { jobs } = envelopeSchema.parse(payload);
    return parseJobList(jobs, jobSchema).map((j) => ({
      externalId: j.id,
      title: j.title,
      applyUrl: j.jobUrl ?? j.applyUrl ?? "",
      locationRaw: j.location ?? "",
      employmentTypeHint: normalizeEmploymentType(j.employmentType ?? undefined),
      workplaceHint: j.isRemote ? "remote" : normalizeWorkplace(j.workplaceType ?? undefined),
      countryHint: j.address?.postalAddress?.addressCountry ?? undefined,
      descriptionHtml: decodeEntities(j.descriptionHtml ?? j.descriptionPlain ?? ""),
      postedAt: j.publishedAt ? new Date(j.publishedAt) : undefined,
    }));
  },
};
