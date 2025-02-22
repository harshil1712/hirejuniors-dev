PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`homepage_url` text NOT NULL,
	`logo` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_companies`("id", "name", "created_at", "updated_at", "homepage_url", "logo") SELECT "id", "name", "created_at", "updated_at", "homepage_url", "logo" FROM `companies`;--> statement-breakpoint
DROP TABLE `companies`;--> statement-breakpoint
ALTER TABLE `__new_companies` RENAME TO `companies`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `name_idx` ON `companies` (`name`);--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` text NOT NULL,
	`title` text NOT NULL,
	`city` text NOT NULL,
	`country_code` text NOT NULL,
	`description` text NOT NULL,
	`job_type` text NOT NULL,
	`portal_posted_date` text NOT NULL,
	`company_listing_url` text NOT NULL,
	`portal_updated_time` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`company_id` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "listing_id", "title", "city", "country_code", "description", "job_type", "portal_posted_date", "company_listing_url", "portal_updated_time", "created_at", "updated_at", "archived", "company_id") SELECT "id", "listing_id", "title", "city", "country_code", "description", "job_type", "portal_posted_date", "company_listing_url", "portal_updated_time", "created_at", "updated_at", "archived", "company_id" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_listing_id_unique` ON `jobs` (`listing_id`);--> statement-breakpoint
CREATE INDEX `title_idx` ON `jobs` (`title`) WHERE archived = 0;--> statement-breakpoint
CREATE INDEX `country_idx` ON `jobs` (`country_code`) WHERE archived = 0;--> statement-breakpoint
CREATE INDEX `job_type_idx` ON `jobs` (`job_type`) WHERE archived = 0;--> statement-breakpoint
CREATE INDEX `archived_idx` ON `jobs` (`archived`);