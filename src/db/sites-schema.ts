// FILE: src/db/sites-schema.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Define Drizzle pgTable schemas for curated site indexing pipeline: sources, pages, chunks, embeddings, and crawl jobs.
//   SCOPE: Pure schema definitions and inferred types; no runtime SQL execution.
//   DEPENDS: (none — schema-only module)
//   LINKS: M-DB, M-SITE-SOURCES
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   vector - Custom Drizzle column type for pgvector vector(N) columns.
//   siteSourcesTable - Curated site source registry (source_id PK, tier, domain, crawl config).
//   sitePagesTable - Fetched pages linked to a source (page_id PK, source_id FK).
//   siteChunksTable - Text chunks derived from pages (chunk_id PK, page_id FK).
//   siteChunkEmbeddingsTable - Embedding vectors for chunks (chunk_id PK+FK, pgvector column).
//   siteCrawlJobsTable - Crawl job tracking (crawl_job_id PK, source_id FK).
//   SiteSource (type) - Inferred insert/select types for site_sources.
//   SitePage (type) - Inferred insert/select types for site_pages.
//   SiteChunk (type) - Inferred insert/select types for site_chunks.
//   SiteChunkEmbedding (type) - Inferred insert/select types for site_chunk_embeddings.
//   SiteCrawlJob (type) - Inferred insert/select types for site_crawl_jobs.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial creation with 5 table definitions and pgvector custom type for curated sites index.
// END_CHANGE_SUMMARY

import { customType, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

// START_BLOCK_DEFINE_PGVECTOR_CUSTOM_TYPE_M_DB_SITES_001
// START_CONTRACT: vector
//   PURPOSE: Define a custom Drizzle column type mapping to pgvector's vector(N) SQL type.
//   INPUTS: { dimensions: number - Vector dimensionality for the SQL type declaration }
//   OUTPUTS: { customType column builder for use in pgTable definitions }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-DB]
// END_CONTRACT: vector
export const vector = (dimensions: number) =>
  customType<{ data: number[]; driverParam: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: string): number[] {
      // pgvector returns '[1,2,3]' format
      return value
        .slice(1, -1)
        .split(",")
        .map(Number);
    },
  });
// END_BLOCK_DEFINE_PGVECTOR_CUSTOM_TYPE_M_DB_SITES_001

// START_BLOCK_DEFINE_SITE_SOURCES_TABLE_M_DB_SITES_002
// START_CONTRACT: siteSourcesTable
//   PURPOSE: Curated site source registry table — one row per crawl target site.
//   INPUTS: (none — table definition)
//   OUTPUTS: pgTable schema for site_sources
//   SIDE_EFFECTS: [none]
//   LINKS: [M-DB, M-SITE-SOURCES]
// END_CONTRACT: siteSourcesTable
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
// END_BLOCK_DEFINE_SITE_SOURCES_TABLE_M_DB_SITES_002

// START_BLOCK_DEFINE_SITE_PAGES_TABLE_M_DB_SITES_003
// START_CONTRACT: sitePagesTable
//   PURPOSE: Fetched page records linked to a curated source.
//   INPUTS: (none — table definition)
//   OUTPUTS: pgTable schema for site_pages
//   SIDE_EFFECTS: [none]
//   LINKS: [M-DB]
// END_CONTRACT: sitePagesTable
export const sitePagesTable = pgTable("site_pages", {
  pageId: text("page_id").primaryKey(),
  sourceId: text("source_id")
    .notNull()
    .references(() => siteSourcesTable.sourceId),
  url: text("url").notNull(),
  canonicalUrl: text("canonical_url"),
  title: text("title"),
  textHash: text("text_hash"),
  httpStatus: integer("http_status"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  lastModified: text("last_modified"),
  etag: text("etag"),
});
// END_BLOCK_DEFINE_SITE_PAGES_TABLE_M_DB_SITES_003

// START_BLOCK_DEFINE_SITE_CHUNKS_TABLE_M_DB_SITES_004
// START_CONTRACT: siteChunksTable
//   PURPOSE: Text chunks derived from fetched pages for embedding and retrieval.
//   INPUTS: (none — table definition)
//   OUTPUTS: pgTable schema for site_chunks
//   SIDE_EFFECTS: [none]
//   LINKS: [M-DB]
// END_CONTRACT: siteChunksTable
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
// END_BLOCK_DEFINE_SITE_CHUNKS_TABLE_M_DB_SITES_004

// START_BLOCK_DEFINE_SITE_CHUNK_EMBEDDINGS_TABLE_M_DB_SITES_005
// START_CONTRACT: siteChunkEmbeddingsTable
//   PURPOSE: Embedding vectors for site chunks, using pgvector for similarity search.
//   INPUTS: (none — table definition)
//   OUTPUTS: pgTable schema for site_chunk_embeddings
//   SIDE_EFFECTS: [none]
//   LINKS: [M-DB]
// END_CONTRACT: siteChunkEmbeddingsTable
export const siteChunkEmbeddingsTable = pgTable("site_chunk_embeddings", {
  chunkId: text("chunk_id")
    .primaryKey()
    .references(() => siteChunksTable.chunkId, { onDelete: "cascade" }),
  embedding: vector(1024)("embedding").notNull(),
  embeddingModel: text("embedding_model").notNull(),
  embeddingVersion: text("embedding_version").notNull(),
  indexVersion: text("index_version").notNull(),
  embeddedAt: timestamp("embedded_at", { withTimezone: true }).notNull(),
});
// END_BLOCK_DEFINE_SITE_CHUNK_EMBEDDINGS_TABLE_M_DB_SITES_005

// START_BLOCK_DEFINE_SITE_CRAWL_JOBS_TABLE_M_DB_SITES_006
// START_CONTRACT: siteCrawlJobsTable
//   PURPOSE: Crawl job tracking for site ingestion orchestration.
//   INPUTS: (none — table definition)
//   OUTPUTS: pgTable schema for site_crawl_jobs
//   SIDE_EFFECTS: [none]
//   LINKS: [M-DB]
// END_CONTRACT: siteCrawlJobsTable
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
// END_BLOCK_DEFINE_SITE_CRAWL_JOBS_TABLE_M_DB_SITES_006

// START_BLOCK_DEFINE_INFERRED_TYPES_M_DB_SITES_007
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
// END_BLOCK_DEFINE_INFERRED_TYPES_M_DB_SITES_007
