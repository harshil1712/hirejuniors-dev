# Public site (job board) — spec

`apps/site` on the apex (`hirejuniors.dev`). Astro, `output: "server"` on the
Alchemy Astro adapter, reading the shared D1 (`DB`) through `@hirejuniors/db`.
Goals: every active job is a crawlable page with valid `JobPosting` data,
retired jobs drop out cleanly, and answer engines get compact text views.

## Rendering

- Job data pages render on request. Everything that doesn't read D1 stays
  prerendered (`export const prerender = true`): privacy, 404.
- SSR responses: `Cache-Control: public, max-age=300, s-maxage=3600,
  stale-while-revalidate=86400`; 404/410: `public, max-age=300`.
- Only `status = 'active'` jobs are listed anywhere. Queries live in
  `packages/db/src/queries.ts` (public read helpers), not in pages.
- No sign-in/sign-up CTAs — the public site has no accounts. Nav: Jobs,
  Companies.

## Routes

| Path                          | Content                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/`                           | Hero, active job count, latest 12 jobs, links to level hubs and top 8 country hubs, short FAQ (FAQPage JSON-LD) |
| `/jobs/`                      | All active jobs, newest first (`coalesce(posted_at, first_seen_at)`), 24 per page via `?page=N`                 |
| `/jobs/{level}/`              | Level hubs: `internships`, `graduate`, `junior`, `apprenticeships` (→ level enum)                               |
| `/jobs/in/{country}/`         | Country hub; `{country}` = slug of the English country name (`united-kingdom`)                                  |
| `/jobs/{level}/in/{country}/` | Level × country hub                                                                                             |
| `/job/{slug}/`                | Job detail (singular `/job/` so it can't collide with hubs)                                                     |
| `/companies/`                 | Companies with ≥1 active job, with counts                                                                       |
| `/companies/{slug}/`          | Company page: name, homepage link, its active jobs                                                              |
| `/sitemap-jobs.xml`           | SSR sitemap: active job URLs (`lastmod` = `updated_at`), hubs and companies with ≥1 active job                  |
| `/jobs/rss.xml`               | Latest 50 active jobs                                                                                           |
| `/llms.txt`, `/llms-full.txt` | SSR (see AEO)                                                                                                   |

Country names/slugs come from `Intl.DisplayNames(["en"], { type: "region" })`
on the alpha-2 codes; reverse lookup is over the distinct `country_code`s of
active jobs. Unknown level/country slug → 404. A country or level × country hub
with 0 active jobs → 404. A level hub with 0 jobs → 200 empty state,
`noindex`.

`/jobs/` with any query filter other than `page` (`q`, `level`, `country`) →
`<meta name="robots" content="noindex,follow">`, canonical to the matching
path hub (or `/jobs/`). Page N > 1 is self-canonical (`/jobs/?page=N`); a page
past the end → 404.

Job detail states: active → 200; retired → **410** with "This role is no
longer available", up to 6 active jobs from the same company or level,
`noindex`, no `JobPosting`; unknown slug → 404.

## SEO

Every SSR page: unique `<title>` and meta description, canonical, og tags
(via `Base.astro`), `BreadcrumbList` JSON-LD (except `/`).

- Job: title `"{title} at {company}"` (+ ` — {city or country}` if it fits in
  70 chars); description = first ~155 chars of `description_text`.
- Hubs: e.g. `"Internships in Germany — Hire Juniors"`, description with the
  live count. Hubs also emit an `ItemList` of their first 24 job URLs.
- Company: `"{name} junior jobs and internships — Hire Juniors"`;
  `Organization` JSON-LD with `sameAs` homepage.

`JobPosting` (job detail, active only), built by a pure function in
`apps/site/src/lib/job-posting.ts`:
`title`, `description` (sanitised HTML, fallback `description_text`),
`datePosted` = `posted_at ?? first_seen_at`, `validThrough` =
`valid_through ?? datePosted + 90 days` (matches the expiry rule),
`employmentType` = `employment_type ?? (level = internship ? "INTERN" :
undefined)`, `hiringOrganization` `{ @type Organization, name, sameAs:
homepage_url, logo: logo_url }` (omit null fields), `identifier` `{ @type
PropertyValue, name: company name, value: external_id }`, `directApply: false`,
location: `jobLocation` `Place` → `PostalAddress { addressLocality: city,
addressRegion: region, addressCountry: country_code }` when any is known; if
`workplace = remote`, `jobLocationType: "TELECOMMUTE"` plus
`applicantLocationRequirements { @type Country, name }` when the country is
known. `url` = canonical job URL.

Description HTML from sources is untrusted: sanitise with an established
pure-JS sanitizer that runs on Workers. Allow `p br ul ol li strong b em i h2
h3 h4 a` (map `h1` → `h2`); `a` keeps only `http(s)`/`mailto` `href`, gets
`rel="nofollow noopener"`; everything else (attributes, scripts, styles,
iframes, images) is stripped. The Apply link uses `rel="nofollow noopener"`.

Sitemaps: keep `@astrojs/sitemap` for prerendered pages and add
`customSitemaps: ["https://hirejuniors.dev/sitemap-jobs.xml"]` so the index
lists the SSR sitemap. `robots.txt` keeps pointing at `sitemap-index.xml`.

## AEO

- `/llms.txt`: one-paragraph description of Hire Juniors, then sections for the
  hubs (with live counts) and companies (with counts).
- `/llms-full.txt`: the above plus every active job as
  `- [{title} — {company}]({url}): {level} · {location} · posted {date}`.
- Home FAQ answers the questions people actually ask (what counts as a junior
  role here, how listings are found, how often they're refreshed (weekly), what
  happens when a role closes).

## Build checks

`scripts/check-dist.ts` still gates the prerendered output; internal links to
SSR prefixes (`/jobs/`, `/job/`, `/companies/`, `/sitemap-jobs.xml`,
`/llms.txt`, `/llms-full.txt`, `/jobs/rss.xml`) are allowed without a dist file.
