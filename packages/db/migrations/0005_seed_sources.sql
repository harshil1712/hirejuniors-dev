-- Seed companies + sources for the ingest pipeline (fixed ids, idempotent).
INSERT OR IGNORE INTO company (id, slug, name, homepage_url, logo_url, created_at, updated_at)
VALUES
  ('cmp_cloudflare001', 'cloudflare', 'Cloudflare', 'https://www.cloudflare.com', NULL, 0, 0),
  ('cmp_amazon00000001', 'amazon', 'Amazon', 'https://www.amazon.jobs', NULL, 0, 0);
--> statement-breakpoint
INSERT OR IGNORE INTO source (id, company_id, platform, board, config, include_all, enabled, origin, trial, disabled_reason, last_fetched, last_run_at, last_status, last_error, created_at, updated_at)
VALUES
  ('src_cf_university001', 'cmp_cloudflare001', 'greenhouse', 'cloudflare', '{"departmentIds":[70480]}', 1, 1, 'seed', 0, NULL, NULL, NULL, NULL, NULL, 0, 0),
  ('src_amz_students0001', 'cmp_amazon00000001', 'amazon_jobs', 'amazon', '{"query":"sort=recent&category%5B%5D=software-development&category%5B%5D=operations-it-support-engineering&category%5B%5D=project-program-product-management-technical&category%5B%5D=solutions-architect&category%5B%5D=machine-learning-science&category%5B%5D=systems-quality-security-engineering&category%5B%5D=hardware-development&category%5B%5D=data-science&category%5B%5D=research-science&business_category%5B%5D=studentprograms&radius=24km&facets%5B%5D=normalized_country_code&facets%5B%5D=normalized_state_name&facets%5B%5D=normalized_city_name&facets%5B%5D=location&facets%5B%5D=business_category&facets%5B%5D=category&facets%5B%5D=schedule_type_id&facets%5B%5D=employee_class&facets%5B%5D=normalized_location&facets%5B%5D=job_function_id&facets%5B%5D=is_manager&facets%5B%5D=is_intern&offset=0&result_limit=50&sort=recent&latitude=&longitude=&loc_group_id=&loc_query=&base_query=&city=&country=&region=&county=&query_options=&"}', 1, 1, 'seed', 0, NULL, NULL, NULL, NULL, NULL, 0, 0);
