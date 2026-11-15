import { z } from "zod";
import { decodeEntities } from "../html";
import { parseJobList } from "./tolerant";
import type { Fetcher, PlatformAdapter, RawListing } from "./types";

const configSchema = z.object({
  /** Fetch these departments instead of the whole board (deduped by job id). */
  departmentIds: z.array(z.number()).optional(),
});

// Every optional field is .nullish() — Greenhouse returns explicit nulls
// (e.g. "metadata": null on Figma/Stripe/Monzo/Wise boards).
const jobSchema = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  content: z.string().nullish(),
  location: z.object({ name: z.string() }).nullish(),
  updated_at: z.string().nullish(),
  metadata: z.array(z.object({ name: z.string(), value: z.unknown() })).nullish(),
});

// Envelope only — individual jobs are validated one by one in toListings.
const envelopeSchema = z.object({ jobs: z.array(z.unknown()) });
export type GreenhousePayload = z.input<typeof envelopeSchema>;

const API = "https://boards-api.greenhouse.io/v1/boards";

async function get(fetcher: Fetcher, url: string) {
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`greenhouse ${res.status} for ${url}`);
  return envelopeSchema.parse(await res.json()).jobs;
}

export const greenhouse: PlatformAdapter<z.infer<typeof configSchema>, GreenhousePayload> = {
  configSchema,
  parseConfig: (json) => configSchema.parse(JSON.parse(json)),
  async fetchListings(ctx, src) {
    const fetcher = ctx.fetcher;
    const config = this.parseConfig(src.config);
    const jobs = config.departmentIds?.length
      ? (
          await Promise.all(
            config.departmentIds.map((id) =>
              get(fetcher, `${API}/${src.board}/departments/${id}?content=true`),
            ),
          )
        ).flat()
      : await get(fetcher, `${API}/${src.board}/jobs?content=true`);
    return this.toListings({ jobs }, src);
  },
  async probe(fetcher, board) {
    let res: Response;
    try {
      res = await fetcher(`${API}/${board}/jobs`);
    } catch {
      return { ok: false, networkError: true };
    }
    if (!res.ok) return { ok: false };
    try {
      envelopeSchema.parse(await res.json());
    } catch {
      return { ok: false }; // answered, but not a Greenhouse payload
    }
    let companyName: string | undefined;
    try {
      const meta = await fetcher(`${API}/${board}`);
      if (meta.ok) {
        const parsed = z.object({ name: z.string() }).safeParse(await meta.json());
        companyName = parsed.success ? parsed.data.name : undefined;
      }
    } catch {
      // meta is best-effort — the listings answer already proved the board
    }
    return { ok: true, companyName };
  },
  toListings(payload, _src): RawListing[] {
    const { jobs } = envelopeSchema.parse(payload);
    const seen = new Set<string>();
    const out: RawListing[] = [];
    for (const j of parseJobList(jobs, jobSchema)) {
      const externalId = String(j.id);
      if (seen.has(externalId)) continue; // dedupe across departments
      seen.add(externalId);
      out.push({
        externalId,
        title: j.title,
        applyUrl: j.absolute_url,
        locationRaw: j.location?.name ?? "",
        descriptionHtml: decodeEntities(j.content ?? ""),
        postedAt: j.updated_at ? new Date(j.updated_at) : undefined,
        updatedAt: j.updated_at ? new Date(j.updated_at) : undefined,
      });
    }
    return out;
  },
};
