CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIME) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIME) NOT NULL,
	`homepage_url` text NOT NULL,
	`logo` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `name_idx` ON `companies` (`name`);--> statement-breakpoint
CREATE TABLE `jobs` (
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
	`created_at` text DEFAULT (CURRENT_TIME) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIME) NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`company_id` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_listing_id_unique` ON `jobs` (`listing_id`);--> statement-breakpoint
CREATE INDEX `title_idx` ON `jobs` (`title`) WHERE archived = 0;--> statement-breakpoint
CREATE INDEX `country_idx` ON `jobs` (`country_code`) WHERE archived = 0;--> statement-breakpoint
CREATE INDEX `job_type_idx` ON `jobs` (`job_type`) WHERE archived = 0;--> statement-breakpoint
CREATE INDEX `archived_idx` ON `jobs` (`archived`);