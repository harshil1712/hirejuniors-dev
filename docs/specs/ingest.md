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
  `job`, `ingest_run`, `source_run`, `discovery_candidate`,
  `discovery_cursor` + relations, shared query helpers, and the single D1
  migrations dir `packages/db/migrations`.
- `apps/jobs` (`@hirejuniors/jobs`) — Worker exporting `IngestWorkflow`;
  `src/platforms/*` adapters, `src/classify.ts` (keyword pre-filter +
  model classification), `src/extract.ts` (Clairic), `src/discover.ts`,
  `src/location.ts`, `src/ingest.ts` (per-source upsert + feed diff),
  `src/retire.ts` (expiry + link/page check), `src/ai.ts` (typed wrappers
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
- `retire_reason` enum adds **`closed_page`**.
- New: `content_hash` text not null (see §Change detection),
  `classified_at` null, `classified_by` enum `rules | clef-flash | clef |
  admin` null, `classifier_confidence` real null, `reject_reason` enum
  `not_early_career | not_tech | experience | admin` null, `review_reason`
  text null, `min_years_experience` integer null, `salary_min` integer null,
  `salary_max` integer null, `salary_currency` text null (ISO 4217),
  `salary_period` enum `HOUR | WEEK | MONTH | YEAR` null, `graduation_year`
  integer null, `extracted_at` null.
- Index `(status, classified_at)` added for the classify queue.

`ingest_run` — add totals `classified, rejected, review, discovered`
integers default 0 and `ai_input_tokens` integer default 0.

`discovery_candidate` (new) — `id` (`dsc_`), `origin` enum `manual | crawl`,
`input` text (manual: bare domain like `stripe.com`; crawl:
`<platform>:<board>`), `status` enum `queued | found | not_found | duplicate |
failed` default `queued`, `platform` null, `board` null, `source_id` →
source null (set null), `error` null, `attempts` integer default 0,
`created_at`, `updated_at`. Unique `(input)`.

`discovery_cursor` (new) — `id` text pk = `<crawl-id>:<host>` (e.g.
`CC-MAIN-2026-43:jobs.lever.co`), `next_page` integer default 0,
`num_pages` integer null, `done` boolean default false, `updated_at`.

Seed (`0005`): the two existing sources get `origin = 'seed'`.

## Adapters (`apps/jobs/src/platforms`)

Unchanged contract: `parseConfig(json)`, `fetchListings(fetcher, source)`,
pure `toListings(payload, source)`. Add to each of greenhouse/lever/ashby a
**`probe(fetcher, board) → { ok: true, companyName?: string } | { ok: false }`**
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
3. If no link is found, guess boards from the first label of `d`: the label
   itself (e.g. `stripe` from `stripe.com`), then — if the label ends with
   `hq`, `app`, `inc`, `labs`, `io` or `jobs` and is longer than that suffix
   - 2 chars — the label without the suffix (e.g. `datadog` from
     `datadoghq.com`). For each guess, probe Greenhouse, Lever, Ashby in that
     order.
4. First successful `probe` → `found`. Network errors on every attempt →
   `failed` (retried next run while `attempts < 3`).
5. **Careers-page fallback.** No ATS board found, but one of the step-1 pages
   rendered → run §Careers-page listing parse on it (first rendered page in
   step-1 order). If it yields ≥ 1 job link → `found` with a
   `careers_page` source (`board` = normalised listing URL, `config =
   {"listingUrl": "<url>"}`). If it yields 0 job links, take the one-hop
   choice below and, if a link is chosen, parse that page instead (and use
   it as `listingUrl`). Still nothing → `not_found`.

   One-hop choice: collect up to 40 same-site links from the page's
   rendered Markdown, then one `clef-flash` call with `state` = the
   numbered list `"{i}. {text} → {url}"` and the question:

   ```json
   {
     "open_positions": {
       "type": "choice",
       "instructions": "Which link leads to the page that lists the company's open job positions?",
       "criteria": {
         "link_0": "...",
         "link_1": "...",
         "none": "None of these links lists open positions"
       }
     }
   }
   ```

   where each `link_i` criterion is `"{text} → {url}"`. Accept the chosen
   link if it isn't `none` and its probability ≥ 0.60.

**Crawl (Common Crawl index).** Best-effort, never fails the run. Hosts:
`boards.greenhouse.io`, `job-boards.greenhouse.io`, `jobs.lever.co`,
`jobs.ashbyhq.com`. Use the newest collection from
`https://index.commoncrawl.org/collinfo.json`. Per host, query
`{cdx-api}?url={host}/*&output=json&fl=url&page={n}` (first call with
`showNumPages=true` stores `num_pages`), resuming from `discovery_cursor`.
Process at most **2 pages per host per run**. From each URL take the first
path segment as the board (same ignore list as above, must match
`^[A-Za-z0-9_.-]+$`), dedupe, and insert `discovery_candidate` rows
`origin = 'crawl'`, `input = '<platform>:<board>'`, `INSERT OR IGNORE`.
When a newer collection appears, start new cursors for it. The index
returned 504s during design (2026-11-15), so every crawl call is wrapped:
on error, log + record nothing + move on; the cursor is not advanced.

Crawl candidates skip steps 1–3 and go straight to `probe`.

**Creating the source.** On `found`: if `(platform, board)` already exists
→ candidate `duplicate` with `source_id` = existing. Otherwise insert
`company` (name = probe `companyName` ?? title-cased board with `-`/`_` →
space; slug = slugify(name), append `-2`, `-3`… on collision;
`homepage_url = https://{d}` for manual, null for crawl) and `source`
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
internship/apprenticeship/graduate patterns, don't drop it. Everything else
is stored as `pending`.

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

Let `pLevel = probabilities[level.choice]`, `pTech = is_tech.noul`.

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
on. The classify loop stops after **25 steps** (500 jobs) per run; the rest
wait for the next run.

## Extraction (`extract.ts`)

For each job that became `active` or `review` in a classify step, in the
same step, call `@cf/cloudflare/clairic` (`model: "clairic"`,
`reference_date` = posted_at ?? first_seen_at as `YYYY-MM-DD`, same `state`)
with `fields` exactly:

```json
{
  "min_years_experience": {
    "type": "number",
    "decimals": 0,
    "instructions": "Minimum years of professional work experience required. Null if not stated."
  },
  "salary_min": {
    "type": "number",
    "decimals": 0,
    "instructions": "Lowest stated pay amount for this role, as a plain number. Null if pay is not stated."
  },
  "salary_max": {
    "type": "number",
    "decimals": 0,
    "instructions": "Highest stated pay amount for this role, as a plain number. Same as the lowest if only one amount is given. Null if pay is not stated."
  },
  "application_deadline": {
    "type": "date",
    "instructions": "Last date applications are accepted. Null if not stated."
  },
  "graduation_year": {
    "type": "number",
    "decimals": 0,
    "instructions": "Year candidates are expected to graduate. Null if not stated."
  }
}
```

Use a value only when it is non-null and its `confidence ≥ 0.80`, then apply
these checks (failing values are dropped, not the job):

- `min_years_experience` ∈ [0, 15]. If ≥ **3** → job becomes `rejected` /
  `experience` (overrides the decision step).
- Salary: persist `salary_min`, `salary_max`, `salary_currency`,
  `salary_period` only if min and max are present, `0 < min ≤ max`,
  `max ≤ 20 × min`, currency ∉ {`other`, `none`} with probability ≥ 0.70,
  and period ≠ `none` with probability ≥ 0.70. Otherwise all four null.
- `application_deadline`: must be after `posted_at ?? first_seen_at` and
  within 365 days of it → set `valid_through` only if it is null.
- `graduation_year` ∈ [current year − 1, current year + 4].

Set `extracted_at`. Any Clairic error → log, leave fields null, continue
(never throws the step). Tokens from every model call are summed into
`ingest_run.ai_input_tokens` via the step's returned counts.

## Feed diff and retirement

**Shrink guard** (in `ingestSource`, before upsert): if `last_fetched ≥ 10`
and this fetch returned fewer than 20 % of `last_fetched` listings, or
returned 0 while the source has ≥ 1 `active` job → throw
`"feed shrank from X to Y"` (treated as a failed fetch: no diff). On success
set `last_fetched`.

**Missing from feed.** Jobs of the source in `active` or `review` not seen
in a successful fetch get `missed_runs + 1` and are retired
`missing_from_feed` when `missed_runs` reaches the threshold: **1 for JSON
platforms** (greenhouse, lever, ashby, amazon_jobs — their feeds are
complete), **2 for `careers_page`** (rendered pages vary between loads —
the real run saw a 6-link listing render with 5 links minutes later).
`pending` and `rejected` jobs not seen are set `retired` /
`missing_from_feed` at the same threshold, so they leave the queue.

**Expire** — `valid_through < now` → `expired`. **No age-based expiry.** (The
90-day rule was removed after the real run: Palantir keeps evergreen Lever
postings with old `createdAt`, so 68 open jobs were retired, reactivated by
the next feed, and retired again every run.) On upsert, an `expired` job is
reactivated only if its `valid_through` is null or in the future.

**Link + page check** — up to 400 `active` jobs selected once (nulls first by
`last_checked_at`), slices of 40 per step:

1. GET `apply_url` with `redirect: "manual"`, follow at most 3 redirects
   manually (resolving relative `Location`), 10 s timeout per hop.
2. 404 or 410 at any hop → retire `link_dead`.
3. Final 2xx with `text/html` → get the page text with **Browser Run
   `markdown`** on the final URL (rendered, so JS-built pages such as Ashby
   job pages have content); if that call errors, fall back to
   `htmlToText(body)`. Use the first 6000 chars. If the text is **< 200
   characters**, just stamp `last_checked_at`. Otherwise call `clef-flash`
   with that text as `state` and one question:

   ```json
   {
     "open": {
       "type": "noul",
       "instructions": "Is this page a specific job posting that is still open and accepting applications? Answer no for careers home pages, search pages, 'job not found' or 'no longer accepting applications' pages."
     }
   }
   ```

   `open.noul ≤ 0.15` → retire `closed_page`; else stamp `last_checked_at`.

4. Any other status / network error / model error → stamp (status) or leave
   untouched (errors), as today.

**Page-check circuit breaker:** if a link-check slice would retire more than
**25 %** of its jobs as `closed_page`, apply none of that slice's
`closed_page` retirements and record the slice in `ingest_run.error`
(`"closed_page breaker tripped on slice n"`). `link_dead` is unaffected.

## Workflow (`IngestWorkflow`)

Schedule: `0 6 * * 1` (Mondays 06:00 UTC). Params `{ trigger }`. Steps:

1. `start` — insert `ingest_run`.
2. `discover:crawl:<host>` — one step per host, best-effort (caught).
3. `discover:<n>` — probe queued candidates (≤ 10 steps × 15).
4. `load sources` — enabled sources + `no_junior_roles` sources due for retry
   (re-enabled as trial).
5. `ingest:<sourceId>` — per source (retries 3): fetch → shrink guard →
   pre-filter → upsert (new/changed → `pending`) → feed diff.
6. `classify:<n>` — ≤ 25 steps × 20 pending jobs: decision + extraction.
7. `trial` — trial evaluation for sources ingested this run.
8. `expire`.
9. `linkcheck:select`, `linkcheck:<n>` — link + page check, breaker.
10. `finish` — totals (incl. `classified`, `rejected`, `review`,
    `discovered`, `ai_input_tokens`, `browser_ms`), status `succeeded` / `partial` /
    `failed`.

Step outputs stay small (counts/ids only). Default limit is 10,000 steps per
instance (Workers Paid); the caps above keep a run well under 1,000.

The AI binding is passed into `classify.ts`/`extract.ts`/`retire.ts` as an
argument typed by a small interface in `ai.ts` (`decide(model, state,
questions)`, `extract(state, fields, referenceDate)`) — the test seam, like
`fetcher`. Tests pass a hand-written fake; no module mocking.

## Dashboard / API / MCP (`apps/web`)

- **Discovery page** (`/discovery`): textarea to paste domains → creates
  manual candidates; table of candidates (input, origin, status, platform,
  board, linked source, error), filter by status. Service + session route
  `POST /api/discovery` (body `{ domains: string[] }`, max 500, each a valid
  hostname) and `GET /api/discovery`; mirrored in `/api/v1` and MCP
  (`discovery_add`, `discovery_list`). Admin-only like the rest.
- **Jobs page**: status filter gains `pending | review | rejected`; default
  stays `active`. Job detail shows `classified_by`, confidence,
  `review_reason`/`reject_reason`, and the extracted fields. Actions:
  **Approve** (review/rejected → active, needs a level picked, sets
  `classified_by = 'admin'`) and **Reject** (→ rejected / `admin`). Admin
  decisions are sticky across content changes. API/MCP: `jobs_approve`,
  `jobs_reject`.
- **Sources page**: show `origin`, `trial`, `disabled_reason`.
- **Runs page**: show the new totals including `ai_input_tokens` and
  `browser_ms`.
- **Sources page**: `careers_page` sources show their listing URL; the add
  source form accepts platform `careers_page` with a listing URL.

## Site (`apps/site`)

- Only `active` jobs are public (already true — re-check queries handle the
  new statuses).
- `JobPosting.baseSalary` when salary fields are present:
  `{ "@type": "MonetaryAmount", currency, value: { "@type":
  "QuantitativeValue", minValue, maxValue, unitText: salary_period } }`.
- Job page stub: show salary (formatted with `Intl.NumberFormat`, currency,
  "/ year" etc.) and "Grad year" when present.

## Browser Run (`browser.ts`)

Browser Run is the primitive for **reading web pages** (discovery, page
check, careers-page sources). Platform JSON feeds and the Common Crawl index
stay on plain `fetch` — they are APIs, and a browser would only add cost and
lose their stable ids.

- Binding `BROWSER` on the jobs worker (runtime type `BrowserRun`). Calls:
  `env.BROWSER.quickAction("links", { url })` and
  `env.BROWSER.quickAction("markdown", { url })`; each returns a `Response`
  whose JSON is `{ success, result }` (`links` → `string[]` of absolute URLs,
  `markdown` → `string`).
- `browser.ts` exposes a seam like `ai.ts`:
  `interface Browser { links(url): Promise<string[]>; markdown(url):
  Promise<string> }`, built from the binding. Tests pass a hand-written fake.
- Each call: 30 s timeout (`AbortSignal.timeout` around the call); on HTTP
  429 retry up to 2 times after 2 s and 6 s; any other failure throws.
  Sum the `X-Browser-Ms-Used` response header into the step's returned
  counts → `ingest_run.browser_ms` (new integer column, default 0).
- Calls are sequential (no parallel fan-out) to stay inside rate limits.

## Careers-page sources (`platforms/careers-page.ts`)

New platform `careers_page` (add to the `source.platform` enum) for
companies with no supported job board. `board` = the listing URL normalised
(lower-case host, no query/fragment, no trailing slash); `config =
{"listingUrl": string}`. The adapter receives `{ fetcher, browser, ai }`
(extend the adapter context; the JSON platforms ignore `browser`/`ai`).

**Listing parse** (used by discovery step 5 and by every ingest):

1. `browser.markdown(listingUrl)`. Extract Markdown links `[text](url)`;
   resolve relative URLs against the listing URL; drop `mailto:`, `tel:`,
   `#` anchors, links with empty text, and links whose host is not the
   listing's registrable domain or a known job host (`myworkdayjobs.com`,
   `greenhouse.io`, `lever.co`, `ashbyhq.com`, `smartrecruiters.com`,
   `workable.com`, `recruitee.com`, `personio.de`, `personio.com`). Dedupe by
   normalised URL, keep the first 200.
2. In batches of up to 60 links, one `clef-flash` call per batch: `state` =
   `"Links from the careers page {listingUrl}:\n"` + numbered list
   `"{i}. {text} → {url}"`, and one `noul` question per link, id `l{i}`:
   `"instructions": "Is link {i} a link to one individual job posting (not a category, search, team, location or general careers page)?"`.
3. A link with `noul ≥ 0.70` is a job link.

**Ingest** for a `careers_page` source:

- The job links from the listing parse are the feed: `externalId` =
  normalised job URL, `title` = link text cleaned: if it contains an HTML
  heading (`<h1>`–`<h6>`) use that heading's text, else the text before the
  first HTML tag or line break; then strip any remaining tags, decode
  entities, collapse whitespace, trim (real run: Revolut/Shopify link text
  was `"<h2>Support Specialist</h2>Remote: Philippines"`). `applyUrl` = job
  URL. Feed diff and the shrink guard apply as for any source.
- For job links not yet stored (new), fetch details: `browser.markdown(url)`
  → `descriptionHtml` = `markdownToHtml(md)` (a small pure function in
  `html.ts`: HTML-escape everything, blank-line-separated blocks → `<p>`,
  consecutive lines starting `- `/`* ` → `<ul><li>`, lines starting `#`… →
  `<h3>`; no raw HTML passes through). Before conversion, strip a leading
  YAML front-matter block (`---` … `---`) that Browser Run's Markdown may
  start with. Then one `clairic` call on the Markdown with fields
  `{"location": {"type": "text", "instructions": "Where the job is based, as
  written on the page"}}` → `locationRaw` (value with confidence ≥ 0.80,
  else `""`). `postedAt` stays null (first_seen_at is used). (A
  `posted_date` field was removed after the real run: with no date on the
  page Clairic returned the reference date — today — at ≥ 0.80 confidence.)
- At most **30 new job pages per careers-page source per run**; links beyond
  that are left out of this run's upsert and **excluded from the feed diff**
  (they are not "missing", just not fetched yet). Existing jobs whose link is
  still listed are only re-seen (no page fetch).
- From there the job follows the normal path: pre-filter → `pending` →
  classify → extract.
- Ingest step timeout for careers-page sources: 10 minutes.

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
