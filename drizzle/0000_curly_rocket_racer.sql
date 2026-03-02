CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"label" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "country_settings" (
	"country_code" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_token_store" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_chunk_embeddings" (
	"chunk_id" text PRIMARY KEY NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_version" text NOT NULL,
	"index_version" text NOT NULL,
	"embedded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_chunks" (
	"chunk_id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"char_count" integer NOT NULL,
	"token_estimate" integer NOT NULL,
	"content_hash" text NOT NULL,
	"chunking_version" text NOT NULL,
	"index_version" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_crawl_jobs" (
	"crawl_job_id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_job_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_pages" (
	"page_id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text,
	"title" text,
	"text_hash" text,
	"http_status" integer,
	"fetched_at" timestamp with time zone,
	"last_modified" text,
	"etag" text,
	CONSTRAINT "site_pages_canonical_url_unique" UNIQUE("canonical_url")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_sources" (
	"source_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"tier" integer NOT NULL,
	"language" text NOT NULL,
	"focus" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"crawl_interval_minutes" integer NOT NULL,
	"max_pages" integer NOT NULL,
	"country_code" text DEFAULT 'jp' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_counters" (
	"user_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"country_code" text DEFAULT 'jp' NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"last_called_at" timestamp with time zone,
	CONSTRAINT "usage_counters_user_id_tool_name_country_code_pk" PRIMARY KEY("user_id","tool_name","country_code")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "site_chunk_embeddings" ADD CONSTRAINT "site_chunk_embeddings_chunk_id_site_chunks_chunk_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."site_chunks"("chunk_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "site_chunks" ADD CONSTRAINT "site_chunks_page_id_site_pages_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."site_pages"("page_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "site_crawl_jobs" ADD CONSTRAINT "site_crawl_jobs_source_id_site_sources_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."site_sources"("source_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_source_id_site_sources_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."site_sources"("source_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
