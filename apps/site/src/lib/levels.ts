// URL slug ↔ job.level for the level hubs. Unknown slugs map to null → 404.
export const LEVELS = ["internship", "apprenticeship", "graduate", "junior"] as const;
export type Level = (typeof LEVELS)[number];

const SLUGS: Record<Level, string> = {
  internship: "internships",
  graduate: "graduate",
  junior: "junior",
  apprenticeship: "apprenticeships",
};
const FROM_SLUG = new Map(Object.entries(SLUGS).map(([l, s]) => [s, l as Level]));

export function levelSlug(level: Level): string {
  return SLUGS[level];
}
export function levelFromSlug(slug: string): Level | null {
  return FROM_SLUG.get(slug) ?? null;
}
export function levelLabel(level: Level): string {
  return {
    internship: "Internships",
    apprenticeship: "Apprenticeships",
    graduate: "Graduate roles",
    junior: "Junior roles",
  }[level];
}
export function levelLabelLower(level: Level): string {
  return {
    internship: "internships",
    apprenticeship: "apprenticeships",
    graduate: "graduate roles",
    junior: "junior roles",
  }[level];
}
export function levelLabelSingular(level: Level): string {
  return {
    internship: "Internship",
    apprenticeship: "Apprenticeship",
    graduate: "Graduate",
    junior: "Junior",
  }[level];
}
export function levelLabelSingularLower(level: Level): string {
  return levelLabelSingular(level).toLowerCase();
}
