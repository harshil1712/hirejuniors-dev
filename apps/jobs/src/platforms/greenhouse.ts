import { z } from "zod";
import { decodeEntities } from "../html";
import type { Fetcher, PlatformAdapter, RawListing } from "./types";

const configSchema = z.object({
  /** Fetch these departments instead of the whole board (deduped by job id). */
  departmentIds: z.array(z.number()).optional(),
});

const jobSchema = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  content: z.string().optional().default(""),
  location: z.object({ name: z.string() }).optional(),
  updated_at: z.string().optional(),
  metadata: z.array(z.object({ name: z.string(), value: z.unknown() })).optional(),
});

const responseSchema = z.object({ jobs: z.array(jobSchema) });
export type GreenhousePayload = z.input<typeof responseSchema>;

const API = "https://boards-api.greenhouse.io/v1/boards";

async function get(fetcher: Fetcher, url: string) {
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`greenhouse ${res.status} for ${url}`);
  return responseSchema.parse(await res.json()).jobs;
}

export const greenhouse: PlatformAdapter<z.infer<typeof configSchema>, GreenhousePayload> = {
  configSchema,
  parseConfig: (json) => configSchema.parse(JSON.parse(json)),
  async fetchListings(fetcher, src) {
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
    const seen = new Set<number>();
    const deduped = jobs.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
    return this.toListings({ jobs: deduped }, src);
  },
  toListings(payload, _src): RawListing[] {
    const { jobs } = responseSchema.parse(payload);
    return jobs.map((j) => ({
      externalId: String(j.id),
      title: j.title,
      applyUrl: j.absolute_url,
      locationRaw: j.location?.name ?? "",
      descriptionHtml: decodeEntities(j.content),
      postedAt: j.updated_at ? new Date(j.updated_at) : undefined,
      updatedAt: j.updated_at ? new Date(j.updated_at) : undefined,
    }));
  },
};
