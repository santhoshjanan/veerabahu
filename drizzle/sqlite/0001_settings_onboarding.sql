CREATE TABLE `app_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`config` text NOT NULL,
	`onboarding_step` integer DEFAULT 0 NOT NULL,
	`onboarding_complete` integer DEFAULT false NOT NULL,
	`activated` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `config_secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `local_admin` (
	`id` integer PRIMARY KEY NOT NULL,
	`salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`invalidated_at` integer
);
