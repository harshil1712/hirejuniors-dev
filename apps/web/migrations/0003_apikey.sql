-- API key plugin table (mirrors the generated apikey table in
-- src/auth-schema.ts; hand-maintained, see README).
CREATE TABLE apikey (id text PRIMARY KEY, config_id text NOT NULL DEFAULT 'default', name text, start text, reference_id text NOT NULL, prefix text, key text NOT NULL, refill_interval integer, refill_amount integer, last_refill_at integer, enabled integer DEFAULT 1, rate_limit_enabled integer DEFAULT 1, rate_limit_time_window integer DEFAULT 86400000, rate_limit_max integer DEFAULT 10, request_count integer DEFAULT 0, remaining integer, last_request integer, expires_at integer, created_at integer NOT NULL, updated_at integer NOT NULL, permissions text, metadata text);
--> statement-breakpoint
CREATE INDEX apikey_configId_idx ON apikey (config_id);
--> statement-breakpoint
CREATE INDEX apikey_referenceId_idx ON apikey (reference_id);
--> statement-breakpoint
CREATE INDEX apikey_key_idx ON apikey (key);
