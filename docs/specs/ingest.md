# Job ingest — spec

Company-agnostic pipeline that fetches junior/intern/graduate roles from public
job-board APIs, keeps them fresh, and retires listings that disappear. Runs
weekly as one Cloudflare Workflow in `apps/jobs`.

## Principles

- **No company-specific code.** Code knows _platforms_ (Greenhouse, Lever,
  Ashby, Amazon Jobs); companies and their boards are rows in `source`.
  Adding a company = adding a row (dashboard, later phase).
- **Never delete.** Retiring sets `status = 'retired'` + `retired_at` +
  `retire_reason`. A job that reappears in its feed is reactivated unless it
  was retired `manual`ly (manual is sticky).
- **A failed fetch never retires anything.** Feed-diff only runs for a source
  whose fetch + parse fully succeeded.

## Layout

- `packages/db` (`@hirejuniors/db`) — Drizzle schema for `company`, `source`,
  `job`, `ingest_run`, `source_run` + relations, shared query helpers, and the
  single D1 migrations dir `packages/db/migrations` (moved from
  `apps/web/migrations`; auth tables included). Auth schema stays generated in
  `apps/web/src/auth-schema.ts`.
- `apps/jobs` (`@hirejuniors/jobs`) — Worker exporting `IngestWorkflow`;
  `src/platforms/*` adapters, `src/classify.ts`, `src/location.ts`,
  `src/ingest.ts` (per-source upsert + feed diff), `src/retire.ts` (expiry +
  link check). The Workflow class is thin glue over these functions.

## Schema (`packages/db`, migration `0004_jobs.sql`)

Conventions as in the starter: text ids `<prefix>_` + nanoid(16), timestamps
`integer` `timestamp_ms`, snake_case columns.

`company` — `id` (`cmp_`), `slug` unique, `name`, `homepage_url` null,
`logo_url` null, `created_at`, `updated_at`.

`source` — `id` (`src_`), `company_id` → company (cascade), `platform` enum
`greenhouse | lever | ashby | amazon_jobs`, `board` text (Greenhouse board
token / Lever site / Ashby board name / Amazon: `"amazon"`), `config` text
JSON (validated per platform with zod; see adapters), `include_all` boolean
default false (skip the level classifier — for boards that are already
early-career only), `enabled` boolean default true, `last_run_at` null,
`last_status` enum `succeeded | failed` null, `last_error` null, `created_at`,
`updated_at`. Unique `(platform, board)`.

`job` — `id` (`job_`), `source_id` → source (cascade), `company_id` →
company, `external_id`, `slug` unique (set on insert, never regenerated),
`title`, `level` enum `internship | apprenticeship | graduate | junior`,
`employment_type` null (schema.org: `FULL_TIME | PART_TIME | INTERN |
CONTRACTOR | TEMPORARY | OTHER`), `workplace` enum `onsite | hybrid | remote`
null, `location_raw`, `city` null, `region` null, `country_code` null
(ISO 3166-1 alpha-2, upper case), `description_html` null (raw from source,
entity-decoded; sanitised at render time), `description_text` (plain text,
≤ 500 chars, for cards/meta), `apply_url`, `posted_at` null, `source_updated_at`
null, `valid_through` null, `status` enum `active | retired` default active,
`retired_at` null, `retire_reason` enum `missing_from_feed | link_dead |
expired | manual` null, `missed_runs` integer default 0, `first_seen_at`,
`last_seen_at`, `last_checked_at` null, `created_at`, `updated_at`.
Unique `(source_id, external_id)`. Indexes: `(status, posted_at DESC)`,
`(status, country_code)`, `(status, level)`, `(company_id, status)`.

`ingest_run` — `id` (`run_`), `trigger` enum `schedule | manual`,
`workflow_instance_id`, `status` enum `running | succeeded | partial | failed`,
`started_at`, `finished_at` null, totals `fetched, inserted, updated,
reactivated, retired` integers default 0, `error` null.

`source_run` — `id` (`srn_`), `run_id` → ingest_run (cascade), `source_id` →
source (cascade), `status` enum `succeeded | failed`, `fetched, kept,
inserted, updated, reactivated, retired` integers, `error` null,
`started_at`, `finished_at`.

Seed migration `0005_seed_sources.sql` (`INSERT OR IGNORE`, fixed ids):
companies Cloudflare (`cloudflare`, https://www.cloudflare.com) and Amazon
(`amazon`, https://www.amazon.jobs); sources Cloudflare/greenhouse board
`cloudflare` config `{"departmentIds":[70480]}` include_all true, and
Amazon/amazon_jobs board `amazon` config = the student-programs search used
today (`git show main:workers/workflows/amazon.ts`) include_all true.

## Adapters (`apps/jobs/src/platforms`)

Each platform exports `parseConfig(json)` (zod) and
`fetchListings(fetcher, source) → Promise<RawListing[]>` plus a pure
`toListings(payload, source)` used by tests. `fetcher` is a `typeof fetch`
argument (test seam — no module mocking). `RawListing`: `externalId, title,
applyUrl, locationRaw, employmentTypeHint, workplaceHint, countryHint,
descriptionHtml, postedAt, updatedAt`.

- **greenhouse** — `GET https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true`,
  or per `config.departmentIds` `.../departments/{id}?content=true` (dedupe by id).
  `content` is HTML-entity-escaped → decode.
- **lever** — `GET https://api.lever.co/v0/postings/{board}?mode=json`;
  `categories.commitment/location`, `workplaceType`, `country`, `createdAt` ms.
- **ashby** — `GET https://api.ashbyhq.com/posting-api/job-board/{board}`;
  `employmentType`, `isRemote`/`workplaceType`, `address.postalAddress.addressCountry`, `publishedAt`.
- **amazon_jobs** — `GET https://www.amazon.jobs/en/search.json?<config.query>`;
  port fields from the old workflow (`job_path` → `https://www.amazon.jobs{job_path}`).

All responses are zod-parsed; a parse failure fails the source (no feed-diff).

## Classification (`classify.ts`)

`classifyLevel(title, employmentTypeHint) → level | null`, case-insensitive,
word-boundary matches. Exclusions win: senior, sr, staff, principal, lead,
manager, director, head of, vp, chief. Then: intern, internship, co-op,
working student, placement → `internship`; apprentice(ship) → `apprenticeship`;
graduate, new grad, university grad, early career, campus, entry level,
entry-level → `graduate`; junior, jr → `junior`. Employment type `INTERN` with
no title match → `internship`. `null` = not stored. With `include_all` the
classifier still runs for `level`; unmatched defaults to `graduate` and
exclusions still drop the job.

`location.ts` — split `location_raw` on `,`/`|`/`;`, detect remote/hybrid
keywords, map the last segment (or `countryHint`) to ISO alpha-2 using the
table from `git show main:utils/countryCode.ts` (+ alpha-2/alpha-3 passthrough).

## Workflow (`IngestWorkflow`)

Schedule: `0 6 * * 1` (Mondays 06:00 UTC) via Alchemy's Workflow `schedules`.
Params `{ trigger: "schedule" | "manual" }`.

1. `start` — insert `ingest_run` (running).
2. `load sources` — enabled sources (ids only).
3. Per source, step `ingest:<sourceId>` (retries: 3, exponential): fetch →
   parse → classify → upsert by `(source_id, external_id)` (insert sets slug,
   `first_seen_at`; update refreshes fields, `last_seen_at`, `missed_runs = 0`,
   reactivates `missing_from_feed`/`expired`/`link_dead` retirees, never
   `manual`) → feed diff: active jobs of this source not seen this run get
   `missed_runs + 1`; those reaching **2** are retired `missing_from_feed`.
   Writes in `db.batch` chunks sized under D1's 100 bound-parameter limit.
   Returns counts only (keep step output small). Step failure after retries is
   caught: record `source_run` failed + `source.last_status/last_error`, continue.
4. `expire` — retire active jobs with `valid_through < now`, or
   `coalesce(posted_at, first_seen_at) < now − 90 days` → `expired`.
5. `linkcheck:<n>` for n = 1..10 — 40 active jobs per step ordered by
   `last_checked_at` nulls first; `GET apply_url` with `redirect: "manual"`;
   404/410 → retire `link_dead`; any other response → set `last_checked_at`;
   network error/timeout (10 s) → leave untouched.
6. `finish` — totals, status `succeeded` / `partial` (some source failed) /
   `failed`.

Slug: `slugify(title)-{company.slug}-{6-char base36 hash of source_id:external_id}`.

## Infra (`alchemy.run.ts`)

`Cloudflare.Worker("hirejuniors-jobs", …)` with `rootDir`/`main` in
`apps/jobs`, same `DB`, `IngestWorkflow` binding with the schedule,
observability as the web worker, no domain. **Not created when `PR_NAME` is
set** (Alchemy rejects Workflow classes on preview versions). D1 migrations
path → `./packages/db/migrations`.
