CREATE TABLE `allowlist` (
	`domain` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`actor` text NOT NULL,
	`domain_id` integer,
	`event` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blocklist_fetch_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`ip` text NOT NULL,
	`user_agent` text,
	`status` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `curated_domains` (
	`domain` text NOT NULL,
	`source_list` text NOT NULL,
	PRIMARY KEY(`domain`, `source_list`)
);
--> statement-breakpoint
CREATE TABLE `curated_lists` (
	`name` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`last_fetched` integer,
	`entry_count` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `domains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'observed' NOT NULL,
	`score` real,
	`decided_at` integer,
	`decision_note` text,
	CONSTRAINT "domains_state_check" CHECK(state in ('observed', 'assessing', 'pending_review', 'auto_cleared', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_domain_unique` ON `domains` (`domain`);--> statement-breakpoint
CREATE TABLE `ingest_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`cursor` text,
	`last_ingest_at` integer,
	`first_run_done` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_rate_state` (
	`source` text PRIMARY KEY NOT NULL,
	`tokens` real NOT NULL,
	`last_refill` integer NOT NULL,
	`day_count` integer DEFAULT 0 NOT NULL,
	`day_start` integer NOT NULL,
	`month_count` integer DEFAULT 0 NOT NULL,
	`month_start` integer NOT NULL,
	`last_call_at` integer,
	`paused_until` integer
);
--> statement-breakpoint
CREATE TABLE `verdicts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain_id` integer NOT NULL,
	`source` text NOT NULL,
	`verdict` text NOT NULL,
	`confidence` real NOT NULL,
	`category` text,
	`detail` text,
	`raw` text NOT NULL,
	`assessed_at` integer NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "verdicts_source_check" CHECK(source in ('curated_list', 'metadefender', 'ai', 'virustotal')),
	CONSTRAINT "verdicts_verdict_check" CHECK(verdict in ('block', 'allow', 'unsure', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verdicts_domain_source_uniq` ON `verdicts` (`domain_id`,`source`);