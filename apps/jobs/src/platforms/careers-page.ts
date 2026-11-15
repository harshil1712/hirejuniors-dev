// careers_page adapter — spec §Careers-page sources. board = normalised
// listing URL; config = {"listingUrl": string}. Needs browser + ai in ctx.
import { z } from "zod";
import { CAREERS_PAGE_FIELDS, JOB_LINK_STATE_PREFIX, jobLinkQuestion } from "../ai";
import { decodeEntities, markdownToHtml } from "../html";
import type { AdapterCtx, PlatformAdapter, RawListing, SourceRow } from "./types";

const configSchema = z.object({ listingUrl: z.string() });

/** Boundary parse for a Clairic answer (spec §Careers ingest fields). */
const textAnswer = z.object({ value: z.string().nullable(), confidence: z.number() });

const HEADING_RE = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i;

/** Link-text → job title (spec §Careers-page ingest): an HTML heading wins;
 * otherwise the text before the first tag or line break. Remaining tags are
 * stripped, entities decoded, whitespace collapsed. */
export function cleanJobTitle(text: string): string {
  const m = text.match(HEADING_RE);
  const head = m ? m[1] : (text.split(/<[^\s>]|[\r\n]/)[0] ?? text);
  return decodeEntities(head.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** Browser Run markdown may start with a YAML front-matter block — strip it
 * before html conversion and before Clairic (spec §Careers-page ingest). */
export function stripFrontMatter(md: string): string {
  const m = md.match(/^\s*---\s*\r?\n[\s\S]*?\r?\n---\s*(\r?\n|$)/);
  return m ? md.slice(m[0].length) : md;
}

const MAX_LINKS = 200;
const BATCH = 60;
const JOB_LINK_P = 0.7;
const MAX_NEW_PAGES = 30;
const CONFIDENCE = 0.8;

/** Hosts that may carry a job posting off the company's own domain. */
const JOB_HOSTS = new Set([
  "myworkdayjobs.com",
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "smartrecruiters.com",
  "workable.com",
  "recruitee.com",
  "personio.de",
  "personio.com",
]);

/** Normalised listing URL: lower-case host, no query/fragment, no trailing
 * slash — this is the `board` of a careers_page source. */
export function normaliseListingUrl(raw: string): string {
  const u = new URL(raw);
  u.hostname = u.hostname.toLowerCase();
  u.search = "";
  u.hash = "";
  const s = u.toString();
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/** Job-URL normalisation for externalId/dedupe: lower-case host, no
 * fragment, no trailing slash (query kept — ids often live there). */
function normaliseJobUrl(raw: string): string {
  const u = new URL(raw);
  u.hostname = u.hostname.toLowerCase();
  u.hash = "";
  const s = u.toString();
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/** Registrable domain = last two labels (no public-suffix list). */
function registrable(host: string): string {
  const parts = host.toLowerCase().split(".");
  return parts.slice(-2).join(".");
}

function hostAllowed(host: string, listingHost: string): boolean {
  const h = host.toLowerCase();
  if (h === listingHost || h.endsWith(`.${listingHost}`)) return true;
  if (registrable(h) === registrable(listingHost)) return true;
  for (const jh of JOB_HOSTS) {
    if (h === jh || h.endsWith(`.${jh}`)) return true;
  }
  return false;
}

const MD_LINK_RE = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export interface PageLink {
  text: string;
  url: string;
}

/** Markdown links on a page → resolved, filtered, deduped, capped at 200.
 * Pass `sameSiteOnly` to keep only the listing's own domain (one-hop). */
export function extractMarkdownLinks(
  markdown: string,
  listingUrl: string,
  sameSiteOnly = false,
): PageLink[] {
  let base: URL;
  try {
    base = new URL(listingUrl);
  } catch {
    return [];
  }
  const out: PageLink[] = [];
  const seen = new Set<string>();
  for (const m of markdown.matchAll(MD_LINK_RE)) {
    const text = m[1].trim().replace(/\s+/g, " ");
    const href = m[2].trim();
    if (!text) continue;
    if (href.startsWith("#")) continue;
    if (/^(mailto|tel):/i.test(href)) continue;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    const host = u.hostname.toLowerCase();
    const baseHost = base.hostname.toLowerCase();
    const sameSite =
      host === baseHost ||
      host.endsWith(`.${baseHost}`) ||
      registrable(host) === registrable(baseHost);
    if (sameSiteOnly ? !sameSite : !hostAllowed(host, baseHost)) continue;
    const key = normaliseJobUrl(u.toString());
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, url: u.toString() });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

function requireCtx(ctx: AdapterCtx) {
  if (!ctx.browser) throw new Error("careers_page requires a browser seam");
  if (!ctx.ai) throw new Error("careers_page requires an ai seam");
  return { browser: ctx.browser, ai: ctx.ai };
}

/** §Careers listing parse: markdown → links → batched noul ≥ 0.70.
 * Used by discovery step 5 and by every careers_page ingest. */
export async function parseJobLinks(ctx: AdapterCtx, listingUrl: string): Promise<PageLink[]> {
  const { browser, ai } = requireCtx(ctx);
  const md = await browser.markdown(listingUrl);
  const links = extractMarkdownLinks(md, listingUrl);
  const keep: PageLink[] = [];
  for (let i = 0; i < links.length; i += BATCH) {
    const batch = links.slice(i, i + BATCH);
    const state =
      `${JOB_LINK_STATE_PREFIX}${listingUrl}:\n` +
      batch.map((l, j) => `${i + j}. ${l.text} → ${l.url}`).join("\n");
    const questions = Object.assign({}, ...batch.map((_, j) => jobLinkQuestion(i + j)));
    const res = await ai.decide("clef-flash", state, questions);
    if (ctx.aiTokens) ctx.aiTokens.n += res.inputTokens;
    batch.forEach((l, j) => {
      const a = res.answers[`l${i + j}`];
      if (a && a.type === "noul" && a.noul >= JOB_LINK_P) keep.push(l);
    });
  }
  return keep;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const careersPage: PlatformAdapter<z.infer<typeof configSchema>, RawListing[]> = {
  configSchema,
  parseConfig: (json) => configSchema.parse(JSON.parse(json)),
  async fetchListings(ctx, src) {
    const { browser, ai } = requireCtx(ctx);
    const config = this.parseConfig(src.config);
    const links = await parseJobLinks(ctx, config.listingUrl);
    const known = ctx.knownExternalIds ?? new Set<string>();
    const out: RawListing[] = [];
    let newPages = 0;
    for (const l of links) {
      const externalId = normaliseJobUrl(l.url);
      const title = cleanJobTitle(l.text);
      if (known.has(externalId)) {
        // Existing link — re-seen only, no page fetch; upsert keeps the
        // stored fields (reSeen).
        out.push({ externalId, title, applyUrl: l.url, locationRaw: "", reSeen: true });
        continue;
      }
      if (newPages >= MAX_NEW_PAGES) continue; // deferred — excluded from feed
      newPages++;
      const md = stripFrontMatter(await browser.markdown(l.url));
      const res = await ai.extract(md, CAREERS_PAGE_FIELDS, today());
      if (ctx.aiTokens) ctx.aiTokens.n += res.inputTokens;
      const loc = textAnswer.safeParse(res.answers.location);
      out.push({
        externalId,
        title,
        applyUrl: l.url,
        locationRaw:
          loc.success && loc.data.confidence >= CONFIDENCE && loc.data.value ? loc.data.value : "",
        descriptionHtml: markdownToHtml(md),
        // postedAt stays null — first_seen_at stands in (spec §Careers ingest).
      });
    }
    return out;
  },
  toListings: (payload: RawListing[], _src: SourceRow) => payload,
};
