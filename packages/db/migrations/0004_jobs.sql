-- Jobs ingest pipeline tables (mirrors packages/db/src/schema.ts;
-- hand-maintained, see README).
CREATE TABLE company (
  id text PRIMARY KEY,
  slug text NOT NULL,
  name text NOT NULL,
  homepage_url text,
  logo_url text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX company_slug_idx ON company (slug);
--> statement-breakpoint
CREATE TABLE source (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  platform text NOT NULL,
  board text NOT NULL,
  config text NOT NULL DEFAULT '{}',
  include_all integer NOT NULL DEFAULT 0,
  enabled integer NOT NULL DEFAULT 1,
  origin text NOT NULL DEFAULT 'manual',
  trial integer NOT NULL DEFAULT 0,
  disabled_reason text,
  last_fetched integer,
  last_run_at integer,
  last_status text,
  last_error text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX source_platform_board_idx ON source (platform, board);
--> statement-breakpoint
CREATE TABLE job (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  level text,
  employment_type text,
  workplace text,
  location_raw text NOT NULL,
  city text,
  region text,
  country_code text,
  description_html text,
  description_text text NOT NULL,
  apply_url text NOT NULL,
  posted_at integer,
  source_updated_at integer,
  valid_through integer,
  status text NOT NULL DEFAULT 'pending',
  retired_at integer,
  retire_reason text,
  content_hash text NOT NULL,
  classified_at integer,
  classified_by text,
  classifier_confidence real,
  reject_reason text,
  review_reason text,
  salary_min integer,
  salary_max integer,
  salary_currency text,
  salary_period text,
  extracted_at integer,
  first_seen_at integer NOT NULL,
  last_seen_at integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX job_slug_idx ON job (slug);
--> statement-breakpoint
CREATE UNIQUE INDEX job_source_external_idx ON job (source_id, external_id);
--> statement-breakpoint
CREATE INDEX job_status_posted_idx ON job (status, posted_at DESC);
--> statement-breakpoint
CREATE INDEX job_status_country_idx ON job (status, country_code);
--> statement-breakpoint
CREATE INDEX job_status_level_idx ON job (status, level);
--> statement-breakpoint
CREATE INDEX job_company_status_idx ON job (company_id, status);
--> statement-breakpoint
CREATE INDEX job_status_classified_idx ON job (status, classified_at);
--> statement-breakpoint
CREATE TABLE ingest_run (
  id text PRIMARY KEY,
  trigger text NOT NULL,
  workflow_instance_id text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  started_at integer NOT NULL,
  finished_at integer,
  fetched integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  reactivated integer NOT NULL DEFAULT 0,
  retired integer NOT NULL DEFAULT 0,
  classified integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  review integer NOT NULL DEFAULT 0,
  discovered integer NOT NULL DEFAULT 0,
  ai_input_tokens integer NOT NULL DEFAULT 0,
  ai_output_tokens integer NOT NULL DEFAULT 0,
  browser_ms integer NOT NULL DEFAULT 0,
  error text
);
--> statement-breakpoint
CREATE TABLE source_run (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES ingest_run(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  status text NOT NULL,
  fetched integer NOT NULL DEFAULT 0,
  kept integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  reactivated integer NOT NULL DEFAULT 0,
  retired integer NOT NULL DEFAULT 0,
  error text,
  started_at integer NOT NULL,
  finished_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE discovery_candidate (
  id text PRIMARY KEY,
  origin text NOT NULL,
  input text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  platform text,
  board text,
  source_id text REFERENCES source(id) ON DELETE SET NULL,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX discovery_candidate_input_idx ON discovery_candidate (input);
--> statement-breakpoint
