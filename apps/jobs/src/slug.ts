export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "job";
}

/** 6-char base36 hash of `sourceId:externalId` — keeps slugs unique and stable. */
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(6, "0").slice(0, 6);
}

export function jobSlug(
  title: string,
  companySlug: string,
  sourceId: string,
  externalId: string,
): string {
  return `${slugify(title)}-${companySlug}-${shortHash(`${sourceId}:${externalId}`)}`;
}
