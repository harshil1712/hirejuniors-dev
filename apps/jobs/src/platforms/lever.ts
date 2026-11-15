import { z } from "zod";
import { decodeEntities } from "../html";
import { normalizeEmploymentType, normalizeWorkplace } from "./normalize";
import type { PlatformAdapter, RawListing } from "./types";

const configSchema = z.object({}).strict();

const postingSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string().optional(),
  applyUrl: z.string().optional(),
  categories: z
    .object({
      commitment: z.string().optional(),
      location: z.string().optional(),
      team: z.string().optional(),
      department: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
  country: z.string().optional(),
  workplaceType: z.string().optional(),
  description: z.string().optional(),
  descriptionPlain: z.string().optional(),
  lists: z
    .array(z.object({ text: z.string().optional(), content: z.string().optional() }))
    .optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

const responseSchema = z.array(postingSchema);
export type LeverPayload = z.input<typeof responseSchema>;

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
    try {
      const res = await fetcher(`https://api.lever.co/v0/postings/${board}?mode=json`);
      if (!res.ok) return { ok: false };
      z.array(z.object({ id: z.string() })).parse(await res.json());
      return { ok: true };
    } catch {
      return { ok: false, networkError: true };
    }
  },
  toListings(payload, _src): RawListing[] {
    const postings = responseSchema.parse(payload);
    return postings.map((p) => ({
      externalId: p.id,
      title: p.text,
      applyUrl: p.hostedUrl ?? p.applyUrl ?? "",
      locationRaw: p.categories?.location ?? "",
      employmentTypeHint: normalizeEmploymentType(p.categories?.commitment),
      workplaceHint: normalizeWorkplace(p.workplaceType),
      countryHint: p.country ?? p.categories?.country,
      descriptionHtml: decodeEntities(
        [p.description, ...(p.lists ?? []).map((l) => l.content)].filter(Boolean).join(""),
      ),
      postedAt: p.createdAt ? new Date(p.createdAt) : undefined,
      updatedAt: p.updatedAt ? new Date(p.updatedAt) : undefined,
    }));
  },
};
