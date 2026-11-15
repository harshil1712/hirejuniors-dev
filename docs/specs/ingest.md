# Job ingest — spec

Company-agnostic pipeline that discovers company job boards, fetches their
roles, classifies them with Workers AI decision/extraction models, keeps them
fresh, and retires listings that close. Runs weekly as one Cloudflare
Workflow in `apps/jobs`.

## Principles

- **No company-specific code.** Code knows _platforms_ (Greenhouse, Lever,
  Ashby, Amazon Jobs); companies and their boards are rows in `source`.
  Discovery creates those rows automatically; the dashboard can add them too.
- **Never delete.** Retiring sets `status = 'retired'` + `retired_at` +
  `retire_reason`. A job that reappears in its feed is reactivated unless it
  was retired `manual`ly (manual is sticky).
- **A failed fetch never retires anything.** Feed-diff only runs for a source
  whose fetch + parse fully succeeded and passed the shrink guard.
- **Models decide, code verifies.** Every model answer is gated by an explicit
  probability threshold and sanity checks in code; anything below threshold
  goes to human review, never straight to the public board.
- **AI is optional at the edges.** Clairic (preview) fields are all nullable;
  if Clairic fails, jobs still publish without them. If Clef is unavailable,
  jobs stay `pending` and are retried next run — never published unclassified.

## Layout

- `packages/db` (`@hirejuniors/db`) — Drizzle schema for `company`, `source`,
  `job`, `ingest_run`, `source_run`, `discovery_candidate` + relations,
  shared query helpers, and the single D1 migrations dir
  `packages/db/migrations`.
- `apps/jobs` (`@hirejuniors/jobs`) — Worker exporting `IngestWorkflow`;
  `src/platforms/*` adapters, `src/classify.ts` (keyword pre-filter +
  model classification), `src/extract.ts` (Clairic), `src/discover.ts`,
  `src/location.ts`, `src/ingest.ts` (per-source upsert + feed diff),
  `src/retire.ts` (expiry), `src/ai.ts` (typed wrappers
  over the AI binding). The Workflow class is thin glue over these functions.

## Schema (`packages/db`)

Nothing has been deployed yet, so these changes are made **in place** in
`0004_jobs.sql` (and the seed in `0005_seed_sources.sql`), not as a new
migration. Conventions as in the starter: text ids `<prefix>_` + nanoid(16),
timestamps `integer` `timestamp_ms`, snake_case columns.

`company` — `id` (`cmp_`), `slug` unique, `name`, `homepage_url` null,
`logo_url` null, `created_at`, `updated_at`.

`source` — `id` (`src_`), `company_id` → company (cascade), `platform` enum
`greenhouse | lever | ashby | amazon_jobs`, `board` text, `config` text JSON
(validated per platform with zod), `include_all` boolean default false (board
is already early-career only — skip the level decision), `enabled` boolean
default true, **`origin` enum `seed | manual | discovered` default `manual`**,
**`trial` boolean default false** (discovered and not yet proven to have
junior roles), **`disabled_reason` enum `no_junior_roles | manual` null**,
**`last_fetched` integer null** (listing count of the last successful fetch,
for the shrink guard), `last_run_at` null, `last_status` enum
`succeeded | failed` null, `last_error` null, `created_at`, `updated_at`.
Unique `(platform, board)`.

`job` — as before, with these changes:

- `status` enum **`pending | active | review | rejected | retired`** default
  `pending`. Only `active` is public. `pending` = awaiting classification;
  `review` = model unsure, waiting for the admin; `rejected` = classified as
  not early-career or not tech (kept so it isn't re-classified every week).
- `level` becomes **nullable** (null while pending/rejected).
- `retire_reason` enum `missing_from_feed | expired | manual`.
- New: `content_hash` text not null (see §Change detection),
  `classified_at` null, `classified_by` enum `rules | clef-flash | clef |
  admin` null, `classifier_confidence` real null, `reject_reason` enum
  `not_early_career | not_tech | admin` null, `review_reason`
  text null, `salary_min` integer null,
  `salary_max` integer null, `salary_currency` text null (ISO 4217),
  `salary_period` enum `HOUR | WEEK | MONTH | YEAR` null, `extracted_at` null.
- Index `(status, classified_at)` added for the classify queue.

`ingest_run` — add totals `classified, rejected, review, discovered`
integers default 0 and `ai_input_tokens` integer default 0.

`discovery_candidate` (new) — `id` (`dsc_`), `origin` enum `manual |
listings`, `input` text (manual: bare domain like `stripe.com` or
`<platform>:<board>` for a pasted board URL; listings:
`<platform>:<board>`), `status` enum `queued | found | not_found | duplicate |
failed` default `queued`, `platform` null, `board` null, `source_id` →
source null (set null), `error` null, `attempts` integer default 0,
`created_at`, `updated_at`. Unique `(input)`.

Seed (`0005`): the two existing sources get `origin = 'seed'`.

## Adapters (`apps/jobs/src/platforms`)

Unchanged contract: `parseConfig(json)`, `fetchListings(fetcher, source)`,
pure `toListings(payload, source)`. Add to each of greenhouse/lever/ashby a
**`probe(fetcher, board) → { ok: true, companyName?: string, jobCount: number } | { ok: false }`**
used by discovery: one GET of the same endpoint `fetchListings` uses (without
`content=true` for Greenhouse); `ok` = HTTP 200 and the payload zod-parses.
Greenhouse `companyName` comes from `GET /v1/boards/{board}` → `name`; others
leave it undefined (company name falls back to title-cased board).

**Tolerant parsing** (real run: Greenhouse returns `"metadata": null` on some
boards — Figma, Stripe, Monzo, Wise — and Ashby returns `isRemote: null` /
`workplaceType: null` — Notion; each failed the whole board):

- Every optional field in every platform job schema is `.nullish()` and
  null is treated as absent.
- The response envelope (e.g. `{ jobs: [...] }`) must parse; then each job is
  `safeParse`d individually. Invalid jobs are skipped. If more than **20 %**
  of a non-empty feed's jobs are invalid, the fetch fails (no feed diff) with
  the first zod issue path in the error.
- `probe`: HTTP 200 + envelope parses → `ok: true` (individual jobs are not
  validated). A zod/JSON failure is a real answer → `{ ok: false }`; only a
  thrown fetch (network/timeout) is `{ ok: false, networkError: true }`.

## Discovery (`discover.ts`)

Two inputs, one pipeline. Both end in `probe` → create company + source.

**Manual (domains).** The dashboard accepts a pasted list of domains (one per
line, normalised to lower-case bare host, deduped) → `discovery_candidate`
rows with `origin = 'manual'`. For each queued manual candidate:

1. For each of, in order, `https://{d}/careers`, `https://{d}/jobs`,
   `https://careers.{d}`, `https://{d}` — stopping at the first that yields
   an ATS link — get the page's links with **Browser Run `links`** (rendered,
   so script-injected boards and iframes count; see §Browser Run). If the
   Browser Run call errors, fall back to a plain `fetch` (GET,
   `redirect: "follow"`, 10 s timeout, first 512 KB) and scan the raw HTML.
2. Scan the links (joined with `\n`) or HTML with these patterns (first
   match wins, in this order):
   - Greenhouse: `(?:boards|job-boards)\.greenhouse\.io/(?:embed/job_board\?for=)?([A-Za-z0-9_-]+)`
   - Lever: `jobs\.lever\.co/([A-Za-z0-9_.-]+)`
   - Ashby: `jobs\.ashbyhq\.com/([A-Za-z0-9_.-]+)`
     Ignore the captured board if it is one of `embed`, `api`, `v1`, `jobs`.
3. First successful `probe` → `found`.
4. No link found → guess the board from the domain: `label` = first DNS
   label, plus `label` without a trailing `hq` when ≥ 3 chars remain
   (`datadoghq` → `datadog`). Probe every guess on Greenhouse, Lever and
   Ashby; keep answers with ≥ 1 job, and drop a Greenhouse answer whose
   board name — lower-cased, non-alphanumerics removed, one trailing
   `inc|ltd|careers|jobs` removed — isn't equal to the guess (`wise` ≠
   "Wise Worksite Field Sales"). The kept answer
   with the most jobs → `found`; none → `not_found`. (Real run: careers
   pages link to their own branded pages, so the link scan alone found 3
   of 20 domains; with guessing, 13.)
5. Network errors on every attempt → `failed` (retried next run while
   `attempts < 3`).

A pasted line that is a URL on a Greenhouse/Lever/Ashby host is stored
normalised as `<platform>:<board>` (it dedupes with listings rows) and goes
straight to `probe`, like a listings candidate.

**Listings (early-career job lists).** The dependable automatic source is
the two community-maintained early-career lists, which link straight to ATS
postings:

- `https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json`
- `https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json`

Each is a JSON array of `{ url, active, … }` (~13 MB). One step
`discover:listings`, best-effort: per list, fetch (30 s
timeout), parse tolerantly (array of objects with string `url` and optional
boolean `active`; skip other rows), keep `active !== false`, run the same
ATS patterns as step 1 over each `url`, and insert `origin = 'listings'`,
`input = '<platform>:<board>'` rows with `INSERT OR IGNORE` (D1 batches of
≤ 100 statements). Only the board is taken; jobs still come from the
platform API. Workday and other links are ignored. On any error, record
nothing for that list and move on. In 2026-11 the lists held ~700 distinct
Greenhouse/Lever/Ashby boards with active junior roles.

Listings and pasted board-URL candidates skip steps 1–2 and go straight
to `probe`.

**Creating the source.** On `found`: if `(platform, board)` already exists
→ candidate `duplicate` with `source_id` = existing. Otherwise insert
`company` (name = probe `companyName` ?? title-cased board with `-`/`_` →
space; slug = slugify(name), append `-2`, `-3`… on collision;
`homepage_url = https://{d}` for manual, null for listings) and `source`
(`origin = 'discovered'`, `enabled = true`, `trial = true`,
`include_all = false`, `config = '{}'`).

**Per-run caps.** Probe at most **150 candidates per run** (manual first,
oldest first). Steps of 15 candidates each (`discover:<n>`).

**Trial evaluation (auto-enable).** After classification, for every source
with `trial = true` that ingested successfully this run: if it has ≥1 job in
`active` or `review` → `trial = false` (kept). If it still has `pending`
jobs (classify cap reached) → leave it in trial for the next run. Otherwise → `enabled = false`,
`trial = false`, `disabled_reason = 'no_junior_roles'`. Sources disabled for
`no_junior_roles` are re-tried (treated as enabled, `trial = true`) when
`last_run_at` is older than **28 days**. `manual` disables are never retried.

## Change detection

`content_hash = sha256hex(title + "\n" + location_raw + "\n" +
htmlToText(description_html))` computed at upsert. On update, if the hash is
unchanged the classification/extraction columns are left alone. If it
changed, the job is queued for re-classification (unless `retired`
`manual`, or `rejected`/`active` by `admin` — admin decisions are sticky):
`pending`/`review`/`rejected` rows go to `pending`; an **`active` row stays
`active`** (no public flicker) with `classified_at = null`, and the classify
queue selects `status IN ('pending') OR (status = 'active' AND
classified_at IS NULL)`. Re-classification may then move it to
`rejected`/`review`. Jobs of `include_all` sources in that queue are
re-classified by rules (§2), never by Clef. In all cases
`description_html` is refreshed.

## Classification (`classify.ts`)

**1. Keyword pre-filter (no model).** `isExcluded(title)` as today
(senior, sr, staff, principal, lead, manager, director, head of, vp, chief —
word-boundary, case-insensitive) → listing is dropped, never stored. Exception
so "Sales Lead Intern"-style titles survive: if the title also matches the
internship/apprenticeship/graduate patterns, don't drop it.

**Early-career title gate.** Outside `include_all` sources, a title must
also carry an early-career signal (`hasEarlySignal(title)`): any of the
four level patterns in `classifyLevel`, or `trainee`, `student(s)`,
`associate(s)`, `fellow(ship)(s)`, `residency`, `university`, or a level-one
suffix (`engineer|developer|analyst|scientist|designer` followed by `I` or
`1`). Titles without one are dropped like excluded titles. Measured on the
real run (286 boards, 14k listings): titles without a signal were 1,590
model rejects, 73 review and 16 approvals (mostly mid-level), and 78 % of
the pending backlog; keeping them cost ~5× the model calls for ~8 % of
approvals. Everything else is stored as `pending`.

**2. `include_all` sources.** Level = `classifyLevel(title)` ?? `graduate`,
status `active`, `classified_by = 'rules'`. No Clef call. (Clairic still runs.)

**3. Model decision.** For pending jobs: step `classify:<n>` takes **20
pending jobs** (oldest first). Per job, call `@cf/cloudflare/clef-flash`
with `model: "clef-flash"`, `state` = the text below, and `questions`
exactly:

State:

```
Title: {title}
Company: {company.name}
Location: {location_raw}
Employment type: {employment_type ?? "unknown"}

{htmlToText(description_html, 6000) — the full description text up to 6000 characters}
```

Questions:

```json
{
  "level": {
    "type": "choice",
    "instructions": "What seniority is this job aimed at?",
    "criteria": {
      "internship": "Internship, co-op, working student or placement for students",
      "apprenticeship": "Apprenticeship with on-the-job training",
      "graduate": "Graduate scheme, new-grad or entry-level role for recent graduates",
      "junior": "Junior role open to people with roughly 0-2 years of experience",
      "not_early_career": "Requires more than about 2 years of experience, or is mid-level, senior or leadership"
    }
  },
  "is_tech": {
    "type": "noul",
    "instructions": "Is this a technology role, such as software, data, machine learning, infrastructure, security, IT, QA, hardware, technical product or technical design?"
  },
  "workplace": {
    "type": "choice",
    "instructions": "Where is the work done?",
    "criteria": {
      "onsite": "At the employer's office or site",
      "hybrid": "Split between office and home",
      "remote": "Fully remote",
      "unclear": "The posting does not say"
    }
  },
  "salary_currency": {
    "type": "choice",
    "instructions": "In which currency is pay stated?",
    "criteria": {
      "USD": "US dollars",
      "EUR": "Euros",
      "GBP": "British pounds",
      "CAD": "Canadian dollars",
      "AUD": "Australian dollars",
      "INR": "Indian rupees",
      "SGD": "Singapore dollars",
      "other": "Another currency",
      "none": "Pay is not stated"
    }
  },
  "salary_period": {
    "type": "choice",
    "instructions": "What period does the stated pay cover?",
    "criteria": {
      "YEAR": "Per year",
      "MONTH": "Per month",
      "WEEK": "Per week",
      "HOUR": "Per hour",
      "none": "Pay is not stated"
    }
  }
}
```

Let `pTech = is_tech.noul`. `pLevel = probabilities.not_early_career` when
`level.choice = not_early_career`, otherwise `1 − probabilities.not_early_career`
— the question to decide is "early career or not"; which early-career level
is only the label. (Real run: Clef split "Engineer I" roles between `junior`
0.50 and `graduate` 0.44 with `not_early_career` 0.04, so a top-choice
probability sent clearly junior roles to review.)

Each model call is evaluated with its own thresholds — Flash: `T = 0.80`,
`techHigh = 0.80`, `techLow = 0.20`; Clef: `T = 0.70`, `techHigh = 0.70`,
`techLow = 0.30` — in this order (first rule that fires decides):

1. `level.choice = not_early_career` and `pLevel ≥ T` → **rejected** /
   `not_early_career` (tech is irrelevant).
2. `pTech ≤ techLow` → **rejected** / `not_tech` (level is irrelevant).
3. `level.choice ≠ not_early_career`, `pLevel ≥ T` and `pTech ≥ techHigh` →
   **active** with `level`.
4. Otherwise undecided: after Flash → **escalate** (repeat the identical
   call on `@cf/cloudflare/clef`, `model: "clef"`); after Clef → status
   `review`, `level` = best guess unless it is `not_early_career`,
   `review_reason` = `"level p=0.62, tech p=0.55"` style string.

(Real run 2026-11-15: requiring a confident tech answer even when the model
was confident the role was senior, or vice versa, sent 111 of 500 jobs to
review.) Store `classifier_confidence` = the probability of the rule that
fired (`pLevel` for 1, `1 − pTech` for 2, `min(pLevel, pTech)` for 3; null
for review), `classified_by` = the model whose answer decided, `classified_at`. `workplace`: only
fill when the column is null, the answer isn't `unclear` and its probability
≥ 0.70. `salary_currency`/`salary_period`: keep in step-local memory for
extraction; persist only via §Extraction rules. Rejected jobs get
`description_html = null` to save space.

A Clef error (binding throws / non-2xx) throws the step → Workflow retries
(3, exponential); after retries the job stays `pending` and the run moves
on. The classify loop stops after **100 steps** (2,000 jobs) per run; the rest
wait for the next run.

## Extraction (`extract.ts`)

For each job that became `active` or `review` in a classify step, in the
same step, call `@cf/cloudflare/clairic` (`model: "clairic"`,
`reference_date` = posted_at ?? first_seen_at as `YYYY-MM-DD`, same `state`)
with `fields` exactly:

```json
{
  "salary_min": {
    "type": "number",
    "decimals": 0,
    "instructions": "Lowest stated pay amount for this role, as a plain number. Null if pay is not stated."
  },
  "salary_max": {
    "type": "number",
    "decimals": 0,
    "instructions": "Highest stated pay amount for this role, as a plain number. Same as the lowest if only one amount is given. Null if pay is not stated."
  }
}
```

Use a value only when it is non-null and its `confidence ≥ 0.80`, then apply
this check (a failing value is dropped, not the job):

- Salary: persist `salary_min`, `salary_max`, `salary_currency`,
  `salary_period` only if min and max are present, `0 < min ≤ max`,
  `max ≤ 20 × min`, currency ∉ {`other`, `none`} with probability ≥ 0.70,
  and period ≠ `none` with probability ≥ 0.70. Otherwise all four null.

Set `extracted_at`. Any Clairic error → log, leave fields null, continue
(never throws the step). Tokens from every model call are summed into
`ingest_run.ai_input_tokens` via the step's returned counts.

## Feed diff and retirement

**Shrink guard** (in `ingestSource`, before upsert): if `last_fetched ≥ 10`
and this fetch returned fewer than 20 % of `last_fetched` listings, or
returned 0 while the source has ≥ 1 `active` job → throw
`"feed shrank from X to Y"` (treated as a failed fetch: no diff). On success
set `last_fetched`.

**Missing from feed.** A stored job not seen in a successful fetch is
retired `missing_from_feed` after **one** miss (JSON feeds are complete).

**Expire** — `valid_through < now` → `expired`. **No age-based expiry.** (The
90-day rule was removed after the real run: Palantir keeps evergreen Lever
postings with old `createdAt`, so 68 open jobs were retired, reactivated by
the next feed, and retired again every run.) On upsert, an `expired` job is
reactivated only if its `valid_through` is null or in the future.

## Workflow (`IngestWorkflow`)

Schedule: `0 6 * * 1` (Mondays 06:00 UTC). Params `{ trigger }`. Steps:

1. `start` — insert `ingest_run`.
2. `discover:listings` — best-effort (caught).
3. `discover:<n>` — probe queued candidates (≤ 10 steps × 15).
4. `load sources` — enabled sources + `no_junior_roles` sources due for retry
   (re-enabled as trial).
5. `ingest:<sourceId>` — per source (retries 3): fetch → shrink guard →
   pre-filter → upsert (new/changed → `pending`) → feed diff.
6. `classify:<n>` — ≤ 100 steps × 20 pending jobs: decision + extraction.
7. `trial` — trial evaluation for sources ingested this run.
8. `expire`.
9. `finish` — totals (incl. `classified`, `rejected`, `review`,
   `discovered`, `ai_input_tokens`, `browser_ms`), status `succeeded` / `partial` /
   `failed`.

Step outputs stay small (counts/ids only). Default limit is 10,000 steps per
instance (Workers Paid); the caps above keep a run well under 1,000.

The AI binding is passed into `classify.ts`/`extract.ts` as an
argument typed by a small interface in `ai.ts` (`decide(model, state,
questions)`, `extract(state, fields, referenceDate)`) — the test seam, like
`fetcher`. Tests pass a hand-written fake; no module mocking.

## Dashboard / API (`apps/web`)

- **Discovery page** (`/discovery`): textarea to paste domains or
  job-board URLs → creates manual candidates; table of candidates (input,
  origin, status, platform, board, linked source, error), filter by status.
  Service + session route `POST /api/discovery` (body `{ domains: string[] }`,
  max 500, each a valid hostname or ATS board URL) and `GET /api/discovery`.
  Admin-only like the rest.
- **Jobs page**: status filter gains `pending | review | rejected`; default
  stays `active`. Job detail shows `classified_by`, confidence,
  `review_reason`/`reject_reason`, and the extracted fields. Actions:
  **Approve** (review/rejected → active, needs a level picked, sets
  `classified_by = 'admin'`) and **Reject** (→ rejected / `admin`). Admin
  decisions are sticky across content changes.
- **Sources page**: show `origin`, `trial`, `disabled_reason`.
- **Runs page**: show the new totals including `ai_input_tokens` and
  `browser_ms`.

## Site (`apps/site`)

- Only `active` jobs are public (already true — re-check queries handle the
  new statuses).
- `JobPosting.baseSalary` when salary fields are present:
  `{ "@type": "MonetaryAmount", currency, value: { "@type":
  "QuantitativeValue", minValue, maxValue, unitText: salary_period } }`.
- Job page stub: show salary (formatted with `Intl.NumberFormat`, currency,
  "/ year" etc.) when present.

## Browser Run (`browser.ts`)

Browser Run is used for one thing: **scanning a pasted domain's candidate
pages for ATS links** (rendered, so script-injected boards count). Platform
JSON feeds stay on plain `fetch` — they are APIs.

- Binding `BROWSER` on the jobs worker (runtime type `BrowserRun`). Call:
  `env.BROWSER.quickAction("links", { url })` → a `Response` whose JSON is
  `{ success, result: string[] }` of absolute URLs.
- `browser.ts` exposes a seam like `ai.ts`:
  `interface Browser { links(url): Promise<string[]> }`, built from the
  binding. Tests pass a hand-written fake.
- Each call: 30 s timeout (`AbortSignal.timeout` around the call); on HTTP
  429 retry up to 2 times after 2 s and 6 s; any other failure throws.
  Sum the `X-Browser-Ms-Used` response header into the step's returned
  counts → `ingest_run.browser_ms` (new integer column, default 0).
- Calls are sequential (no parallel fan-out) to stay inside rate limits.

## Infra (`alchemy.run.ts`)

Add `AI: Cloudflare.Workers.AI()` and `BROWSER: Cloudflare.Browser()` to the
jobs worker `env`. No other infra. Jobs worker still not created when
`PR_NAME` is set.

## Cost envelope

Pricing (2026-11): clef-flash $0.038, clef $0.24, clairic $0.10 per M input
tokens; no output-token charge. At ~1.5k tokens per job and 2,000
new/changed jobs a week, expect well under $1/week. `ai_input_tokens` on
each run is the check.

Browser Run (Workers Paid): 10 browser-hours/month included, then $0.09/h.
`ingest_run.browser_ms` on each run is the check.
