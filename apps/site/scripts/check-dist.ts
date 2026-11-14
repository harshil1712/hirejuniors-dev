/**
 * SEO regression check over dist/. Fails loudly so agent-written posts can't
 * silently break SEO. Run via `astro build && vpx scripts/check-dist.ts`.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Adapter builds put prerendered assets under dist/client; plain static
// builds use dist/ directly.
const _root = new URL("../dist/", import.meta.url).pathname;
const DIST = existsSync(join(_root, "client")) ? join(_root, "client") : _root;
const failures: string[] = [];
const fail = (file: string, msg: string) => failures.push(`${file}: ${msg}`);

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
const files = [...walk(DIST)];
const htmlFiles = files.filter((f) => f.endsWith(".html"));
const rel = (f: string) => relative(DIST, f);
const read = (f: string) => readFileSync(f, "utf8");

// collect every emitted path for internal-link checks
const emitted = new Set(
  htmlFiles.map(
    (f) =>
      "/" +
      rel(f)
        .replace(/index\.html$/, "")
        .replace(/\.html$/, "/"),
  ),
);
emitted.add("/");

// Routes rendered on demand by the site worker (per docs/specs/site.md) —
// they emit no dist files, so link/emission checks must not expect them.
const SSR_PREFIXES = ["/jobs", "/job/", "/companies", "/sitemap-jobs.xml", "/llms"];

const titles = new Map<string, string[]>();
const descs = new Map<string, string[]>();

for (const f of htmlFiles) {
  const r = rel(f);
  const html = read(f);
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  if (!title) fail(r, "missing <title>");
  else titles.set(title, [...(titles.get(title) ?? []), r]);
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  if (!desc) fail(r, "missing meta description");
  else descs.set(desc, [...(descs.get(desc) ?? []), r]);
  if (!/<link rel="canonical"/.test(html)) fail(r, "missing canonical");
  if (!/<meta property="og:image"/.test(html)) fail(r, "missing og:image");
  if (!/<meta name="description"/.test(html)) fail(r, "no meta description tag at all");

  // JSON-LD must be valid JSON
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(m[1]);
      const types = JSON.stringify(parsed);
      // h2 may carry Astro's scoped-style attribute (data-astro-cid-*)
      if (/<section[^>]*>\s*<h2[^>]*>FAQ<\/h2>/.test(html) && !types.includes('"FAQPage"'))
        fail(r, "has FAQ section but no FAQPage JSON-LD");
    } catch {
      fail(r, "invalid JSON in ld+json block");
    }
  }

  // internal links → emitted paths; SSR-prefixed routes (job board) emit
  // no files — they resolve at request time, not build time.
  for (const m of html.matchAll(/href="(\/[^"#]*)"/g)) {
    const path = m[1];
    if (path.startsWith("//") || /\.(svg|png|css|js|woff2?|txt|xml|ico)$/.test(path)) continue;
    if (SSR_PREFIXES.some((p) => path === p || path.startsWith(p))) continue;
    const norm = path.endsWith("/") ? path : path + "/";
    if (!emitted.has(norm) && !emitted.has(path)) fail(r, `internal link to missing path ${path}`);
  }
}

// duplicate titles / descriptions across pages
for (const [t, files] of titles)
  if (files.length > 1) fail(files.join(", "), `duplicate <title> "${t}"`);
for (const [d, files] of descs)
  if (files.length > 1) fail(files.join(", "), `duplicate description "${d.slice(0, 60)}…"`);

// required files — /jobs/, /job/*, /companies*, /sitemap-jobs.xml,
// /jobs/rss.xml, /llms*.txt are SSR endpoints (worker-emitted, not in dist).
for (const req of ["sitemap-index.xml", "robots.txt"])
  if (!existsSync(join(DIST, req))) fail(req, "required file missing from dist");

// Organization logo URL must resolve to a real asset — checked on a
// prerendered page (home is SSR; every page shares the same @graph org).
const orgPage = join(DIST, "privacy", "index.html");
const orgHtml = existsSync(orgPage) ? read(orgPage) : "";
const logoUrl = orgHtml.match(/"logo":\s*"[^"]*\/([^/"]+)"/)?.[1];
if (logoUrl && !existsSync(join(DIST, logoUrl)))
  fail("privacy/index.html", `Organization logo ${logoUrl} missing from dist`);

if (failures.length) {
  console.error(`check-dist: ${failures.length} failure(s)`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`check-dist: ok (${htmlFiles.length} pages, ${files.length} files)`);
