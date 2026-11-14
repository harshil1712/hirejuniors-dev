// Shared SSR plumbing for the job-board pages.
export const CACHE_OK = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
export const CACHE_GONE = "public, max-age=300";

/** Minimal response surface both Astro pages and endpoints expose. */
interface SsrResponse {
  response: { headers: Headers; status?: number };
}
export function cacheHeaders(c: SsrResponse, value: string) {
  c.response.headers.set("cache-control", value);
}

export function breadcrumbs(items: { name: string; path: string }[], origin: string) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${origin}${it.path}`,
    })),
  };
}

export function itemList(jobs: { slug: string; title: string }[], origin: string) {
  return {
    "@type": "ItemList",
    itemListElement: jobs.map((j, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${origin}/job/${j.slug}/`,
      name: j.title,
    })),
  };
}

/** Robots meta for filtered/noindex pages. */
export const NOINDEX = "noindex,follow";

export function locationLabel(j: {
  city?: string | null;
  countryName?: string | null;
  locationRaw?: string;
}): string {
  return j.city ?? j.countryName ?? j.locationRaw ?? "";
}
