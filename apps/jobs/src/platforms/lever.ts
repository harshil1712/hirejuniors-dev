import { z } from "zod";
import { decodeEntities } from "../html";
import { normalizeEmploymentType, normalizeWorkplace } from "./normalize";
import { parseJobList } from "./tolerant";
import type { PlatformAdapter, RawListing } from "./types";

const configSchema = z.object({}).strict();

const postingSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string().nullish(),
  applyUrl: z.string().nullish(),
  categories: z
    .object({
      commitment: z.string().nullish(),
      location: z.string().nullish(),
      team: z.string().nullish(),
      department: z.string().nullish(),
      country: z.string().nullish(),
    })
    .nullish(),
  country: z.string().nullish(),
  workplaceType: z.string().nullish(),
  description: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
  createdAt: z.number().nullish(),
  updatedAt: z.number().nullish(),
});

const envelopeSchema = z.array(z.unknown());
export type LeverPayload = z.input<typeof envelopeSchema>;

export const lever: PlatformAdapter<z.infer<typeof configSchema>, LeverPayload> = {
  configSchema,
  parseConfig: (json) => configSchema.parse(JSON.parse(json)),
  async fetchListings(ctx, src) {
    const fetcher = ctx.fetcher;
    this.parseConfig(src.config);
    const res = await fetcher(`https://api.lever.co/v0/postings/${src.board}?mode=json`);
    if (!res.ok) throw new Error(`lever ${res.status} for board ${src.board}`);
    return this.toListings(await res.json(), src);
  },
  async probe(fetcher, board) {
    let res: Response;
    try {
      res = await fetcher(`https://api.lever.co/v0/postings/${board}?mode=json`);
    } catch {
      return { ok: false, networkError: true };
    }
    if (!res.ok) return { ok: false };
    let jobs: unknown[];
    try {
      jobs = z.array(z.unknown()).parse(await res.json());
    } catch {
      return { ok: false }; // answered, but not a Lever payload
    }
    return { ok: true, jobCount: jobs.length };
  },
  toListings(payload, _src): RawListing[] {
    const postings = parseJobList(envelopeSchema.parse(payload), postingSchema);
    return postings.map((p) => ({
      externalId: p.id,
      title: p.text,
      applyUrl: p.hostedUrl ?? p.applyUrl ?? "",
      locationRaw: p.categories?.location ?? "",
      employmentTypeHint: normalizeEmploymentType(p.categories?.commitment),
      workplaceHint: normalizeWorkplace(p.workplaceType),
      countryHint: p.country ?? p.categories?.country ?? undefined,
      descriptionHtml: decodeEntities(
        [p.description, ...(p.lists ?? []).map((l) => l.content)].filter(Boolean).join(""),
      ),
      postedAt: p.createdAt ? new Date(p.createdAt) : undefined,
      updatedAt: p.updatedAt ? new Date(p.updatedAt) : undefined,
    }));
  },
};
