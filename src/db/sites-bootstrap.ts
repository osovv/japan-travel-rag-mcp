// FILE: src/db/sites-bootstrap.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Bootstrap curated sites index schema and seed site_sources from frozen seed data.
//   SCOPE: Enable pgvector extension, create all five site index tables via raw SQL, ensure required unique indexes, and upsert seed sources.
//   DEPENDS: M-DB, M-LOGGER, M-SITE-SOURCES
//   LINKS: M-DB, M-SITE-SOURCES
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SitesBootstrapError - Typed error for sites schema bootstrap failures.
//   bootstrapSitesSchema - Create tables and seed site_sources from SITE_SOURCES_RESPONSE.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Ensure unique index on site_pages(canonical_url) so repository ON CONFLICT upserts are valid in bootstrap-only environments.
// END_CHANGE_SUMMARY

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "../logger/index";
import { SITE_SOURCES_RESPONSE } from "../tools/site-sources";

// START_BLOCK_DEFINE_ERROR_CLASS_M_DB_SITES_BOOTSTRAP_001
export class SitesBootstrapError extends Error {
  public readonly code = "SITES_BOOTSTRAP_ERROR" as const;

  public constructor(message: string) {
    super(message);
    this.name = "SitesBootstrapError";
  }
}
// END_BLOCK_DEFINE_ERROR_CLASS_M_DB_SITES_BOOTSTRAP_001

// START_CONTRACT: bootstrapSitesSchema
//   PURPOSE: Enable pgvector, create all five curated-sites tables, ensure required indexes, and seed site_sources from frozen constant.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, logger: Logger - Module logger }
//   OUTPUTS: { Promise<void> }
//   SIDE_EFFECTS: [Creates pgvector extension, creates 5 tables if not present, ensures unique index on site_pages(canonical_url), upserts seed data, logs progress]
//   LINKS: [M-DB, M-SITE-SOURCES, M-LOGGER]
// END_CONTRACT: bootstrapSitesSchema
export async function bootstrapSitesSchema(db: NodePgDatabase, logger: Logger): Promise<void> {
  try {
    // START_BLOCK_ENABLE_PGVECTOR_EXTENSION_M_DB_SITES_BOOTSTRAP_002
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    logger.info(
      "pgvector extension ensured.",
      "bootstrapSitesSchema",
      "ENABLE_PGVECTOR_EXTENSION",
    );
    // END_BLOCK_ENABLE_PGVECTOR_EXTENSION_M_DB_SITES_BOOTSTRAP_002

    // START_BLOCK_CREATE_SITE_SOURCES_TABLE_M_DB_SITES_BOOTSTRAP_003
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS site_sources (
        source_id             TEXT PRIMARY KEY,
        name                  TEXT NOT NULL,
        domain                TEXT NOT NULL,
        tier                  INTEGER NOT NULL,
        language              TEXT NOT NULL,
        focus                 TEXT NOT NULL,
        status                TEXT NOT NULL DEFAULT 'active',
        crawl_interval_minutes INTEGER NOT NULL,
        max_pages             INTEGER NOT NULL
      )
    `);
    logger.info(
      "site_sources table ensured.",
      "bootstrapSitesSchema",
      "CREATE_SITE_SOURCES_TABLE",
    );
    // END_BLOCK_CREATE_SITE_SOURCES_TABLE_M_DB_SITES_BOOTSTRAP_003

    // START_BLOCK_CREATE_SITE_PAGES_TABLE_M_DB_SITES_BOOTSTRAP_004
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS site_pages (
        page_id        TEXT PRIMARY KEY,
        source_id      TEXT NOT NULL REFERENCES site_sources(source_id),
        url            TEXT NOT NULL,
        canonical_url  TEXT,
        title          TEXT,
        text_hash      TEXT,
        http_status    INTEGER,
        fetched_at     TIMESTAMPTZ,
        last_modified  TEXT,
        etag           TEXT
      )
    `);
    logger.info(
      "site_pages table ensured.",
      "bootstrapSitesSchema",
      "CREATE_SITE_PAGES_TABLE",
    );
    // END_BLOCK_CREATE_SITE_PAGES_TABLE_M_DB_SITES_BOOTSTRAP_004

    // START_BLOCK_ENSURE_SITE_PAGES_CANONICAL_URL_UNIQUE_INDEX_M_DB_SITES_BOOTSTRAP_010
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS site_pages_canonical_url_unique_idx
      ON site_pages (canonical_url)
    `);
    logger.info(
      "site_pages canonical_url unique index ensured.",
      "bootstrapSitesSchema",
      "CREATE_SITE_PAGES_CANONICAL_URL_UNIQUE_INDEX",
    );
    // END_BLOCK_ENSURE_SITE_PAGES_CANONICAL_URL_UNIQUE_INDEX_M_DB_SITES_BOOTSTRAP_010

    // START_BLOCK_CREATE_SITE_CHUNKS_TABLE_M_DB_SITES_BOOTSTRAP_005
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS site_chunks (
        chunk_id         TEXT PRIMARY KEY,
        page_id          TEXT NOT NULL REFERENCES site_pages(page_id),
        chunk_index      INTEGER NOT NULL,
        chunk_text       TEXT NOT NULL,
        char_count       INTEGER NOT NULL,
        token_estimate   INTEGER NOT NULL,
        content_hash     TEXT NOT NULL,
        chunking_version TEXT NOT NULL,
        index_version    TEXT NOT NULL,
        start_offset     INTEGER NOT NULL,
        end_offset       INTEGER NOT NULL
      )
    `);
    logger.info(
      "site_chunks table ensured.",
      "bootstrapSitesSchema",
      "CREATE_SITE_CHUNKS_TABLE",
    );
    // END_BLOCK_CREATE_SITE_CHUNKS_TABLE_M_DB_SITES_BOOTSTRAP_005

    // START_BLOCK_CREATE_SITE_CHUNK_EMBEDDINGS_TABLE_M_DB_SITES_BOOTSTRAP_006
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS site_chunk_embeddings (
        chunk_id          TEXT PRIMARY KEY REFERENCES site_chunks(chunk_id) ON DELETE CASCADE,
        embedding         vector(1024) NOT NULL,
        embedding_model   TEXT NOT NULL,
        embedding_version TEXT NOT NULL,
        index_version     TEXT NOT NULL,
        embedded_at       TIMESTAMPTZ NOT NULL
      )
    `);
    logger.info(
      "site_chunk_embeddings table ensured.",
      "bootstrapSitesSchema",
      "CREATE_SITE_CHUNK_EMBEDDINGS_TABLE",
    );
    // END_BLOCK_CREATE_SITE_CHUNK_EMBEDDINGS_TABLE_M_DB_SITES_BOOTSTRAP_006

    // START_BLOCK_CREATE_SITE_CRAWL_JOBS_TABLE_M_DB_SITES_BOOTSTRAP_007
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS site_crawl_jobs (
        crawl_job_id   TEXT PRIMARY KEY,
        source_id      TEXT NOT NULL REFERENCES site_sources(source_id),
        provider       TEXT NOT NULL,
        provider_job_id TEXT,
        status         TEXT NOT NULL DEFAULT 'pending',
        started_at     TIMESTAMPTZ,
        finished_at    TIMESTAMPTZ,
        pages_fetched  INTEGER NOT NULL DEFAULT 0,
        error          TEXT
      )
    `);
    logger.info(
      "site_crawl_jobs table ensured.",
      "bootstrapSitesSchema",
      "CREATE_SITE_CRAWL_JOBS_TABLE",
    );
    // END_BLOCK_CREATE_SITE_CRAWL_JOBS_TABLE_M_DB_SITES_BOOTSTRAP_007

    // START_BLOCK_CREATE_OAUTH_TOKEN_STORE_TABLE_M_DB_SITES_BOOTSTRAP_011
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS oauth_token_store (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        expires_at TIMESTAMPTZ
      )
    `);
    logger.info(
      "oauth_token_store table ensured.",
      "bootstrapSitesSchema",
      "CREATE_OAUTH_TOKEN_STORE_TABLE",
    );
    // END_BLOCK_CREATE_OAUTH_TOKEN_STORE_TABLE_M_DB_SITES_BOOTSTRAP_011

    // START_BLOCK_SEED_SITE_SOURCES_M_DB_SITES_BOOTSTRAP_008
    for (const source of SITE_SOURCES_RESPONSE.sources) {
      await db.execute(sql`
        INSERT INTO site_sources (source_id, name, domain, tier, language, focus, status, crawl_interval_minutes, max_pages)
        VALUES (
          ${source.source_id},
          ${source.name},
          ${source.domain},
          ${source.tier},
          ${source.language},
          ${source.focus},
          ${source.status},
          ${getDefaultCrawlInterval(source.tier)},
          ${getDefaultMaxPages(source.tier)}
        )
        ON CONFLICT (source_id) DO UPDATE SET
          name     = EXCLUDED.name,
          domain   = EXCLUDED.domain,
          tier     = EXCLUDED.tier,
          language = EXCLUDED.language,
          focus    = EXCLUDED.focus
      `);
    }
    logger.info(
      `Seeded ${SITE_SOURCES_RESPONSE.sources.length} site sources.`,
      "bootstrapSitesSchema",
      "SEED_SITE_SOURCES",
    );
    // END_BLOCK_SEED_SITE_SOURCES_M_DB_SITES_BOOTSTRAP_008

    logger.info(
      "Sites schema bootstrap complete.",
      "bootstrapSitesSchema",
      "BOOTSTRAP_COMPLETE",
    );
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new SitesBootstrapError(`Sites schema bootstrap failed: ${cause}`);
  }
}

// START_BLOCK_DEFAULT_CRAWL_CONFIG_HELPERS_M_DB_SITES_BOOTSTRAP_009
// START_CONTRACT: getDefaultCrawlInterval
//   PURPOSE: Return default crawl interval in minutes based on source tier.
//   INPUTS: { tier: number }
//   OUTPUTS: { number - Minutes between crawls }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-DB, M-SITE-SOURCES]
// END_CONTRACT: getDefaultCrawlInterval
export function getDefaultCrawlInterval(tier: number): number {
  switch (tier) {
    case 0:
      return 1440; // daily
    case 1:
      return 4320; // every 3 days
    case 2:
      return 10080; // weekly
    default:
      return 10080;
  }
}

// START_CONTRACT: getDefaultMaxPages
//   PURPOSE: Return default max pages limit based on source tier.
//   INPUTS: { tier: number }
//   OUTPUTS: { number - Maximum pages to crawl }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-DB, M-SITE-SOURCES]
// END_CONTRACT: getDefaultMaxPages
export function getDefaultMaxPages(tier: number): number {
  switch (tier) {
    case 0:
      return 200;
    case 1:
      return 150;
    case 2:
      return 50;
    default:
      return 50;
  }
}
// END_BLOCK_DEFAULT_CRAWL_CONFIG_HELPERS_M_DB_SITES_BOOTSTRAP_009
