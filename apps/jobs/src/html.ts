const NAMED = new Map<string, string>([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["ndash", "–"],
  ["mdash", "—"],
  ["lsquo", "‘"],
  ["rsquo", "’"],
  ["ldquo", "“"],
  ["rdquo", "”"],
  ["hellip", "…"],
  ["middot", "·"],
  ["bull", "•"],
  ["copy", "©"],
  ["reg", "®"],
  ["trade", "™"],
  ["eacute", "é"],
  ["egrave", "è"],
  ["agrave", "à"],
  ["ccedil", "ç"],
  ["uuml", "ü"],
  ["ouml", "ö"],
  ["auml", "ä"],
  ["szlig", "ß"],
  ["atilde", "ã"],
  ["otilde", "õ"],
  ["ntilde", "ñ"],
]);

/** Decode HTML entities (Greenhouse `content` arrives entity-escaped). */
export function decodeEntities(html: string): string {
  return html.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? m : String.fromCodePoint(code);
    }
    return NAMED.get(entity) ?? m;
  });
}

/** Escape all HTML special characters — nothing raw passes through. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
