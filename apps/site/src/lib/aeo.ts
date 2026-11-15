// Sitemap/RSS/llms emitters — pure string builders (origin passed in) so
// tests stay node-only and the Worker bundle never reaches outside rootDir.

export function jobUrl(origin: string, slug: string): string {
  return `${origin}/job/${slug}/`;
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SitemapEntry {
  loc: string;
  lastmod?: Date | null;
}

export function buildJobsSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map(
      (e) =>
        `  <url><loc>${xmlEscape(e.loc)}</loc>` +
        (e.lastmod ? `<lastmod>${e.lastmod.toISOString()}</lastmod>` : "") +
        `</url>`,
    )
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
}

/** Exact spec line for llms-full.txt job entries. */
export function llmsJobLine(
  origin: string,
  j: {
    slug: string;
    title: string;
    levelLabel: string;
    location: string;
    posted: string;
    companyName: string;
  },
): string {
  return `- [${j.title} — ${j.companyName}](${jobUrl(origin, j.slug)}): ${j.levelLabel} · ${j.location} · posted ${j.posted}`;
}
