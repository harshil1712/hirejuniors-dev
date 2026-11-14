// Junior-level classifier — spec docs/specs/ingest.md §Classification.
// Word-boundary, case-insensitive; exclusions always win.

const EXCLUDED = /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|vp|chief)\b/i;

const RULES: [level: Level, pattern: RegExp][] = [
  ["internship", /\b(intern|interns|internship|co-?op|working students?|placements?)\b/i],
  ["apprenticeship", /\bapprentice(ship)?s?\b/i],
  [
    "graduate",
    /\b(graduate|graduates|new grads?|university grads?|early career|campus|entry[- ]levels?)\b/i,
  ],
  ["junior", /\b(junior|jr\.?)\b/i],
];

export type Level = "internship" | "apprenticeship" | "graduate" | "junior";

/** Seniority keywords that disqualify a job even under include_all. */
export function isExcluded(title: string): boolean {
  return EXCLUDED.test(title);
}

/**
 * Match a title (+ optional employmentType hint) to a junior level, or null
 * when the job isn't early-career.
 */
export function classifyLevel(title: string, employmentTypeHint?: string): Level | null {
  if (isExcluded(title)) return null;
  for (const [level, pattern] of RULES) {
    if (pattern.test(title)) return level;
  }
  if (employmentTypeHint === "INTERN") return "internship";
  return null;
}
