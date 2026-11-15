import { decodeHTML } from "entities";

/** Decode HTML entities (Greenhouse `content` arrives entity-escaped). */
export function decodeEntities(html: string): string {
  return decodeHTML(html);
}

/** Plain text for `description_text` — strip tags, decode, collapse, cap. */
export function htmlToText(html: string, max = 500): string {
  const text = decodeEntities(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}
