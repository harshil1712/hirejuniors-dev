import type { source } from "@hirejuniors/db/schema";
import type { z } from "zod";

/** A job posting normalised across platforms, before classification. */
export interface RawListing {
  externalId: string;
  title: string;
  applyUrl: string;
  locationRaw: string;
  /** schema.org employmentType when the platform reports one. */
  employmentTypeHint?: string;
  /** "remote" | "hybrid" | "onsite" when the platform reports one. */
  workplaceHint?: string;
  /** Country name / alpha-2 / alpha-3 when the platform reports one. */
  countryHint?: string;
  descriptionHtml?: string;
  postedAt?: Date;
  updatedAt?: Date;
  /** careers_page re-seen links — refresh lastSeen/missedRuns only, keep the
   * stored fields (no page was fetched this run). */
  reSeen?: boolean;
}

export type SourceRow = typeof source.$inferSelect;

export type Fetcher = typeof fetch;

/** Adapter context — spec §Careers-page sources. JSON platforms use only
 * `fetcher`; careers_page needs `browser` (listing + job pages) and `ai`
 * (link filter + field extraction). `knownExternalIds` = externalIds already
 * stored for the source, so careers_page re-sees existing links without
 * fetching their pages. */
export interface AdapterCtx {
  fetcher: Fetcher;
  browser?: import("../browser").Browser;
  ai?: import("../ai").AiModels;
  knownExternalIds?: Set<string>;
  /** Accumulates AI input tokens spent by the adapter (run totals). */
  aiTokens?: { n: number };
}

export interface PlatformAdapter<C = unknown, Payload = unknown> {
  /** zod schema for `source.config` JSON. */
  configSchema: z.ZodType<C>;
  parseConfig(json: string): C;
  fetchListings(ctx: AdapterCtx, source: SourceRow): Promise<RawListing[]>;
  /** Pure transform of a raw API payload — the unit-testable half. */
  toListings(payload: Payload, source: SourceRow): RawListing[];
  /** Discovery probe: one GET of the listings endpoint; ok = HTTP 200 and the
   * payload zod-parses. networkError distinguishes a thrown fetch/timeout
   * from a real HTTP answer — a 404 is a real answer (not_found). Not
   * implemented for amazon_jobs. */
  probe?(
    fetcher: Fetcher,
    board: string,
  ): Promise<{ ok: true; companyName?: string } | { ok: false; networkError?: boolean }>;
}
