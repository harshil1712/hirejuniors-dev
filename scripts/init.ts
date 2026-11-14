/**
 * Rename this starter into your project.
 *
 *   vpx scripts/init.ts <name> <domain> ["Product Name"] [--dry-run]
 *
 * Example: vpx scripts/init.ts acme acme.dev "Acme Cloud"
 *
 * Rewrites project.config.ts, package scopes (@fastflare/* → @<name>/*),
 * worker/domain references in workflows, and doc titles. Safe to re-run:
 * it only replaces the tokens it knows about.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PROJECT } from "../project.config";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => !a.startsWith("--"));

if (positional.length < 2) {
  console.error('usage: vpx scripts/init.ts <name> <domain> ["Product Name"] [--dry-run]');
  process.exit(1);
}

const [name, domain] = positional;
const productName = positional[2] ?? name[0].toUpperCase() + name.slice(1);

if (!/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error(`invalid name "${name}" — lowercase letters, digits, dashes`);
  process.exit(1);
}
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
  console.error(`invalid domain "${domain}"`);
  process.exit(1);
}

const OLD = {
  name: PROJECT.name,
  domain: PROJECT.domain,
  productName: PROJECT.productName,
  emailFrom: PROJECT.emailFrom,
  appSubdomain: PROJECT.appSubdomain,
  apiKeyPrefix: PROJECT.apiKeyPrefix,
  api: PROJECT.api,
};

// API key prefix is derived from the new name: first two alphanumeric chars.
const apiKeyPrefix = `${name
  .replace(/[^a-z0-9]/gi, "")
  .slice(0, 2)
  .toLowerCase()}_`;

const files: { path: string; next: string }[] = [];
const changed: string[] = [];

function consider(path: string, next: string) {
  const prev = readFileSync(path, "utf8");
  if (next !== prev) {
    files.push({ path, next });
    changed.push(path);
  }
}

// 1. project.config.ts is regenerated wholesale — it is THE source of truth.
consider(
  "project.config.ts",
  `/** Single source for names/domains — alchemy.run.ts, the apps and
 * scripts/init.ts all read from here. \`vpx scripts/init.ts\` rewrites it. */
export const PROJECT = {
  /** Repo + worker name prefix: <name>-web, <name>-site, <name>-db. */
  name: "${name}",
  /** Product name used in UI copy and email subjects. */
  productName: "${productName}",
  /** Cloudflare zone apex. */
  domain: "${domain}",
  /** Subdomain the app runs on (site lives on the apex). */
  appSubdomain: "${OLD.appSubdomain}",
  /** From: address for auth emails (verify, reset). */
  emailFrom: "noreply@${domain}",
  /** User-facing support address shown in auth emails and the footer. */
  supportEmail: "support@${domain}",
  /** API key prefix — keys are shown once and identified in lists by it. */
  apiKeyPrefix: "${apiKeyPrefix}",
  /** Agent API (/api/v1 + /mcp). publicSpec exposes openapi.json + discovery
   * without a key; rateLimitPerMinute is the per-key ceiling. */
  api: { publicSpec: ${OLD.api.publicSpec}, rateLimitPerMinute: ${OLD.api.rateLimitPerMinute} },
} as const;

export const APP_DOMAIN = \`\${PROJECT.appSubdomain}.\${PROJECT.domain}\`;
`,
);

// 2. Token replacement everywhere else the old identity appears.
const TEXT_EXT = new Set([
  ".json",
  ".ts",
  ".tsx",
  ".mjs",
  ".astro",
  ".css",
  ".md",
  ".yml",
  ".yaml",
  ".jsonc",
  ".svg",
  ".html",
  ".txt",
]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".alchemy",
  ".wrangler",
  ".astro",
  "tooling",
  // symlinks to .devin/skills — walked once via .devin
  ".agents",
  ".claude",
]);
const SKIP_FILES = new Set([
  "scripts/init.ts",
  "pnpm-lock.yaml",
  "src/auth-schema.ts",
  "src/routeTree.gen.ts",
]);

const replacements: [RegExp, string][] = [
  [new RegExp(`@${OLD.name}/`, "g"), `@${name}/`],
  [new RegExp(`"${OLD.name}"`, "g"), `"${name}"`],
  [new RegExp(`${OLD.name}-web`, "g"), `${name}-web`],
  [new RegExp(`${OLD.name}-site`, "g"), `${name}-site`],
  [new RegExp(`${OLD.name}-db`, "g"), `${name}-db`],
  [new RegExp(`${OLD.name}-turnstile`, "g"), `${name}-turnstile`],
  [new RegExp(`${OLD.name}-email`, "g"), `${name}-email`],
  [new RegExp(`${OLD.name}-local`, "g"), `${name}-local`],
  [new RegExp(`${OLD.name}-test`, "g"), `${name}-test`],
  // Reverse-DNS forms (server.json's "name"): dev.fastflare → dev.acme.
  [
    new RegExp(OLD.domain.split(".").reverse().join("\\."), "g"),
    domain.split(".").reverse().join("."),
  ],
  [new RegExp(OLD.domain.replace(/\./g, "\\."), "g"), domain],
  [new RegExp(OLD.emailFrom, "g"), `noreply@${domain}`],
  [new RegExp(`\\b${OLD.apiKeyPrefix}`, "g"), apiKeyPrefix],
  [new RegExp(OLD.productName, "g"), productName],
  [new RegExp(`\\b${OLD.name}\\b`, "g"), name],
];

function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p);
      continue;
    }
    const ext = p.slice(p.lastIndexOf("."));
    if (!TEXT_EXT.has(ext)) continue;
    if (SKIP_FILES.has(p) || SKIP_FILES.has(entry)) continue;
    let text: string;
    try {
      text = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    let next = text;
    for (const [re, sub] of replacements) next = next.replace(re, sub);
    // Renamed scope can break dependency sort order — re-sort the blocks
    // oxfmt checks.
    if (entry === "package.json") {
      try {
        const pkg = JSON.parse(next);
        for (const k of [
          "dependencies",
          "devDependencies",
          "peerDependencies",
          "allowScripts",
        ] as const) {
          const block = pkg[k] as Record<string, string> | undefined;
          if (block) {
            const sorted = Object.fromEntries(
              Object.entries(block).sort(([a], [b]) => a.localeCompare(b)),
            );
            pkg[k] = sorted;
          }
        }
        next = JSON.stringify(pkg, null, 2) + "\n";
      } catch {
        // not valid JSON — leave as-is
      }
    }
    if (next !== text) consider(p, next);
  }
}
walk(".");

if (dryRun) {
  console.log(`[dry-run] would update ${changed.length} file(s):`);
  for (const p of changed) console.log(`  ${p}`);
  console.log(`\nname=${name} domain=${domain} product="${productName}"`);
  console.log("re-run without --dry-run to apply");
} else {
  for (const f of files) writeFileSync(f.path, f.next);
  console.log(`updated ${changed.length} file(s):`);
  for (const p of changed) console.log(`  ${p}`);
  console.log(`\nDone. Next: vp install && vp run dev`);
}
