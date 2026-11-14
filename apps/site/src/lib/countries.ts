// Country display names and URL slugs. Per docs/specs/site.md both derive
// from Intl.DisplayNames, so slug and label can never disagree.
import { COUNTRY_NAME_TO_ALPHA2 } from "@hirejuniors/jobs/countries";

const NAMES = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string): string {
  return NAMES.of(code) ?? code;
}

/** ASCII-folded, lowercased, hyphenated display name. */
export function countrySlug(code: string): string {
  return countryName(code)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SLUG_TO_CODE = new Map<string, string>();
for (const code of COUNTRY_NAME_TO_ALPHA2.values()) {
  const slug = countrySlug(code);
  if (!SLUG_TO_CODE.has(slug)) SLUG_TO_CODE.set(slug, code);
}

/** URL slug → alpha-2, or null for unknown slugs. */
export function countryCodeFromSlug(slug: string): string | null {
  return SLUG_TO_CODE.get(slug) ?? null;
}
