// FILE: src/db/schema.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Unified Drizzle pgTable schemas for the entire application: API keys, curated site indexing pipeline, and usage tracking.
//   SCOPE: Pure schema definitions and inferred types; no runtime SQL execution.
//   DEPENDS: (none — schema-only module)
//   LINKS: M-DB, M-API-KEY-REPOSITORY, M-SITE-SOURCES, M-USAGE-TRACKER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   apiKeysTable - API key persistence table for Bearer authentication (id PK, key_hash, label, expiry/revocation timestamps).
//   siteSourcesTable - Curated site source registry (source_id PK, tier, domain, crawl config).
//   sitePagesTable - Fetched pages linked to a source (page_id PK, source_id FK).
//   siteChunksTable - Text chunks derived from pages (chunk_id PK, page_id FK).
//   siteChunkEmbeddingsTable - Embedding vectors for chunks (chunk_id PK+FK, pgvector column).
//   siteCrawlJobsTable - Crawl job tracking (crawl_job_id PK, source_id FK).
//   usageCountersTable - Per-user per-tool call counters with composite PK.
//   SiteSource (type) - Inferred insert/select types for site_sources.
//   SitePage (type) - Inferred insert/select types for site_pages.
//   SiteChunk (type) - Inferred insert/select types for site_chunks.
//   SiteChunkEmbedding (type) - Inferred insert/select types for site_chunk_embeddings.
//   SiteCrawlJob (type) - Inferred insert/select types for site_crawl_jobs.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Consolidated from api-key-repository.ts, sites-schema.ts, and tracker.ts into unified schema. Replaced custom vector type with built-in drizzle-orm/pg-core vector.
// END_CHANGE_SUMMARY

import { integer, pgTable, primaryKey, text, timestamp, vector } from "drizzle-orm/pg-core";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

// ─── API Keys ───────────────────────────────────────────────────────────────

export const apiKeysTable = pgTable("api_keys", {
  id: text("id").primaryKey(),
  key_hash: text("key_hash").notNull().unique(),
  key_prefix: text("key_prefix").notNull(),
  label: text("label").notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  revoked_at: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

// ─── Site Sources ───────────────────────────────────────────────────────────

export const siteSourcesTable = pgTable("site_sources", {
  sourceId: text("source_id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  tier: integer("tier").notNull(),
  language: text("language").notNull(),
  focus: text("focus").notNull(),
  status: text("status").notNull().default("active"),
  crawlIntervalMinutes: integer("crawl_interval_minutes").notNull(),
  maxPages: integer("max_pages").notNull(),
});

// ─── Site Pages ─────────────────────────────────────────────────────────────

export const sitePagesTable = pgTable("site_pages", {
  pageId: text("page_id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => siteSourcesTable.sourceId),
  url: text("url").notNull(),
  canonicalUrl: text("canonical_url").unique(),
  title: text("title"),
  textHash: text("text_hash"),
  httpStatus: integer("http_status"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  lastModified: text("last_modified"),
  etag: text("etag"),
});

// ─── Site Chunks ────────────────────────────────────────────────────────────

export const siteChunksTable = pgTable("site_chunks", {
  chunkId: text("chunk_id").primaryKey(),
  pageId: text("page_id")
    .notNull()
    .references(() => sitePagesTable.pageId),
  chunkIndex: integer("chunk_index").notNull(),
  chunkText: text("chunk_text").notNull(),
  charCount: integer("char_count").notNull(),
  tokenEstimate: integer("token_estimate").notNull(),
  contentHash: text("content_hash").notNull(),
  chunkingVersion: text("chunking_version").notNull(),
  indexVersion: text("index_version").notNull(),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
});

// ─── Site Chunk Embeddings ──────────────────────────────────────────────────

export const siteChunkEmbeddingsTable = pgTable("site_chunk_embeddings", {
  chunkId: text("chunk_id")
    .primaryKey()
    .references(() => siteChunksTable.chunkId, { onDelete: "cascade" }),
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  embeddingModel: text("embedding_model").notNull(),
  embeddingVersion: text("embedding_version").notNull(),
  indexVersion: text("index_version").notNull(),
  embeddedAt: timestamp("embedded_at", { withTimezone: true }).notNull(),
});

// ─── Site Crawl Jobs ────────────────────────────────────────────────────────

export const siteCrawlJobsTable = pgTable("site_crawl_jobs", {
  crawlJobId: text("crawl_job_id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => siteSourcesTable.sourceId),
  provider: text("provider").notNull(),
  providerJobId: text("provider_job_id"),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  pagesFetched: integer("pages_fetched").notNull().default(0),
  error: text("error"),
});

// ─── Usage Counters ─────────────────────────────────────────────────────────

export const usageCountersTable = pgTable(
  "usage_counters",
  {
    userId: text("user_id").notNull(),
    toolName: text("tool_name").notNull(),
    callCount: integer("call_count").notNull().default(0),
    lastCalledAt: timestamp("last_called_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.toolName] })],
);

// ─── Inferred Types ─────────────────────────────────────────────────────────

export type SiteSourceSelect = InferSelectModel<typeof siteSourcesTable>;
export type SiteSourceInsert = InferInsertModel<typeof siteSourcesTable>;

export type SitePageSelect = InferSelectModel<typeof sitePagesTable>;
export type SitePageInsert = InferInsertModel<typeof sitePagesTable>;

export type SiteChunkSelect = InferSelectModel<typeof siteChunksTable>;
export type SiteChunkInsert = InferInsertModel<typeof siteChunksTable>;

export type SiteChunkEmbeddingSelect = InferSelectModel<typeof siteChunkEmbeddingsTable>;
export type SiteChunkEmbeddingInsert = InferInsertModel<typeof siteChunkEmbeddingsTable>;

export type SiteCrawlJobSelect = InferSelectModel<typeof siteCrawlJobsTable>;
export type SiteCrawlJobInsert = InferInsertModel<typeof siteCrawlJobsTable>;
