// Untrusted listing HTML → safe render subset. htmlparser2/domutils/
// dom-serializer are pure JS, so this runs in the Worker; the allowlist is
// from docs/specs/site.md.
import { parseDocument, ElementType } from "htmlparser2";
import { render } from "dom-serializer";
import type { AnyNode } from "domhandler";

const ALLOWED = new Set([
  "p",
  "br",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "h2",
  "h3",
  "h4",
  "a",
]);
// Contents of these are dropped entirely, not just unwrapped.
const DROP_CONTENTS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
]);

function cleanNode(node: AnyNode): AnyNode[] {
  if (node.type === ElementType.Text) return [node];
  if (node.type !== ElementType.Tag) return [];
  const el = node;
  if (DROP_CONTENTS.has(el.name)) return [];
  const name = el.name === "h1" ? "h2" : el.name;
  const kids = el.children.flatMap(cleanNode);
  if (!ALLOWED.has(name)) return kids; // unwrap unknown tags, keep children
  if (name === "a") {
    const href = el.attribs.href ?? "";
    if (/^(https?:|mailto:)/i.test(href.trim())) {
      el.attribs = { href: href.trim(), rel: "nofollow noopener" };
    } else {
      el.attribs = {};
    }
  } else {
    el.attribs = {};
  }
  el.name = name;
  el.children = kids;
  for (const k of kids) k.parent = el;
  return [el];
}

export function sanitizeDescription(html: string): string {
  const doc = parseDocument(html ?? "");
  const out = doc.children.flatMap(cleanNode);
  return render(out);
}
