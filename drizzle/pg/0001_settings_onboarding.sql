CREATE TABLE IF NOT EXISTS "app_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"onboarding_step" integer DEFAULT 0 NOT NULL,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"activated" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "app_config_singleton_check" CHECK ("app_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "config_secrets" (
	"name" text PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "local_admin" (
	"id" integer PRIMARY KEY NOT NULL,
	"salt" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "local_admin_singleton_check" CHECK ("local_admin"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"invalidated_at" bigint
);
