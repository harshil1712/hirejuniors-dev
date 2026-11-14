// Title/description rules from docs/specs/site.md.

/** "{title} at {company}" plus " — {place}" only while it stays <= 70 chars. */
export function jobTitle(title: string, company: string, place?: string | null): string {
  const base = `${title} at ${company}`;
  if (!place) return base;
  const full = `${base} — ${place}`;
  return full.length <= 70 ? full : base;
}

/** First ~155 chars of text on a word boundary. */
export function jobDescription(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 155) return clean;
  const cut = clean.slice(0, 155);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}
