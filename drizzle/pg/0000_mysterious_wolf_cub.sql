CREATE TABLE IF NOT EXISTS "allowlist" (
	"domain" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"added_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"at" bigint NOT NULL,
	"actor" text NOT NULL,
	"domain_id" integer,
	"event" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blocklist_fetch_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "blocklist_fetch_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"at" bigint NOT NULL,
	"ip" text NOT NULL,
	"user_agent" text,
	"status" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "curated_domains" (
	"domain" text NOT NULL,
	"source_list" text NOT NULL,
	CONSTRAINT "curated_domains_domain_source_list_pk" PRIMARY KEY("domain","source_list")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "curated_lists" (
	"name" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"last_fetched" bigint,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domains" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "domains_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"domain" text NOT NULL,
	"first_seen" bigint NOT NULL,
	"last_seen" bigint NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'observed' NOT NULL,
	"score" double precision,
	"decided_at" bigint,
	"decision_note" text,
	CONSTRAINT "domains_domain_unique" UNIQUE("domain"),
	CONSTRAINT "domains_state_check" CHECK (state in ('observed', 'assessing', 'pending_review', 'auto_cleared', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingest_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"cursor" text,
	"last_ingest_at" bigint,
	"first_run_done" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_rate_state" (
	"source" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"last_refill" bigint NOT NULL,
	"day_count" integer DEFAULT 0 NOT NULL,
	"day_start" bigint NOT NULL,
	"month_count" integer DEFAULT 0 NOT NULL,
	"month_start" bigint NOT NULL,
	"last_call_at" bigint,
	"paused_until" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verdicts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "verdicts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"domain_id" integer NOT NULL,
	"source" text NOT NULL,
	"verdict" text NOT NULL,
	"confidence" double precision NOT NULL,
	"category" text,
	"detail" text,
	"raw" jsonb NOT NULL,
	"assessed_at" bigint NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" double precision,
	CONSTRAINT "verdicts_source_check" CHECK (source in ('curated_list', 'metadefender', 'ai', 'virustotal')),
	CONSTRAINT "verdicts_verdict_check" CHECK (verdict in ('block', 'allow', 'unsure', 'error'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verdicts_domain_source_uniq" ON "verdicts" USING btree ("domain_id","source");