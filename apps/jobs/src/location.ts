// Parse free-text locations: split on , | ; detect remote/hybrid keywords,
// map the last segment (or countryHint) to ISO alpha-2.
import { ALPHA3_TO_ALPHA2, COUNTRY_NAME_TO_ALPHA2 } from "./countries";

const ALPHA2 = new Set(ALPHA3_TO_ALPHA2.values());

const WORKPLACE_WORDS = /^\s*(remote|hybrid|on[\s-]?site|in[\s-]?office)\b[\s–—-]*/i;

export interface ParsedLocation {
  city: string | null;
  region: string | null;
  countryCode: string | null;
  workplace: "onsite" | "hybrid" | "remote" | null;
}

function toAlpha2(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  if (upper.length === 2 && ALPHA2.has(upper)) return upper;
  return ALPHA3_TO_ALPHA2.get(upper) ?? COUNTRY_NAME_TO_ALPHA2.get(upper) ?? null;
}

export function parseLocation(
  locationRaw: string,
  countryHint?: string,
  workplaceHint?: string,
): ParsedLocation {
  const raw = locationRaw ?? "";
  let workplace: ParsedLocation["workplace"] = null;
  if (workplaceHint === "remote" || workplaceHint === "hybrid" || workplaceHint === "onsite") {
    workplace = workplaceHint;
  }
  if (/\bremote\b/i.test(raw)) workplace = "remote";
  else if (/\bhybrid\b/i.test(raw)) workplace = workplace ?? "hybrid";

  const segments = raw
    .split(/[,|;]/)
    .map((s) => s.replace(WORKPLACE_WORDS, "").trim())
    .filter((s) => s.length > 0 && !/^(remote|hybrid|on[\s-]?site|in[\s-]?office)$/i.test(s));

  let countryCode: string | null = null;
  let countryIdx = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    const code = toAlpha2(segments[i]);
    if (code) {
      countryCode = code;
      countryIdx = i;
      break;
    }
  }
  if (!countryCode && countryHint) countryCode = toAlpha2(countryHint);

  const geo = segments.filter((_, i) => i !== countryIdx);
  return {
    city: geo[0] ?? null,
    region: geo[1] ?? null,
    countryCode,
    workplace,
  };
}
