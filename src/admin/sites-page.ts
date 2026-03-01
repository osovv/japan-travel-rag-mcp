// FILE: src/admin/sites-page.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Query curated site source data with per-source index statistics and recent crawl job summaries for the Sites Management admin page.
//   SCOPE: Define page data types (SiteSourceRow, CrawlJobRow, SitesPageData), fetch aggregated stats via Drizzle raw SQL, and return structured page model.
//   DEPENDS: M-DB, M-LOGGER
//   LINKS: M-ADMIN-SITES, M-DB, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SiteSourceRow (type) - Source metadata + aggregated stats: source_id, name, domain, tier, language, focus, status, crawl config, page/chunk/embedding counts, last_crawl_at.
//   CrawlJobRow (type) - Recent crawl job summary: crawl_job_id, source_id, status, timestamps, pages_fetched, error.
//   SitesPageData (type) - Full page data model with sources array and recentCrawlJobs array.
//   AdminSitesError - Typed admin sites failure with ADMIN_SITES_ERROR code.
//   fetchSitesPageData - Query all site sources with aggregated index stats and recent crawl jobs.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial creation with data layer types and fetchSitesPageData for M-ADMIN-SITES.
// END_CHANGE_SUMMARY

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "../logger/index";

const RECENT_CRAWL_JOBS_LIMIT = 20;

// START_BLOCK_DEFINE_SITE_SOURCE_ROW_TYPE_M_ADMIN_SITES_001
export type SiteSourceRow = {
  source_id: string;
  name: string;
  domain: string;
  tier: number;
  language: string;
  focus: string;
  status: string;
  crawl_interval_minutes: number;
  max_pages: number;
  page_count: number;
  chunk_count: number;
  embedding_count: number;
  last_crawl_at: Date | null;
};
// END_BLOCK_DEFINE_SITE_SOURCE_ROW_TYPE_M_ADMIN_SITES_001

// START_BLOCK_DEFINE_CRAWL_JOB_ROW_TYPE_M_ADMIN_SITES_002
export type CrawlJobRow = {
  crawl_job_id: string;
  source_id: string;
  status: string;
  started_at: Date | null;
  finished_at: Date | null;
  pages_fetched: number;
  error: string | null;
};
// END_BLOCK_DEFINE_CRAWL_JOB_ROW_TYPE_M_ADMIN_SITES_002

// START_BLOCK_DEFINE_SITES_PAGE_DATA_TYPE_M_ADMIN_SITES_003
export type SitesPageData = {
  sources: SiteSourceRow[];
  recentCrawlJobs: CrawlJobRow[];
};
// END_BLOCK_DEFINE_SITES_PAGE_DATA_TYPE_M_ADMIN_SITES_003

// START_BLOCK_DEFINE_ADMIN_SITES_ERROR_CLASS_M_ADMIN_SITES_004
export class AdminSitesError extends Error {
  public readonly code = "ADMIN_SITES_ERROR" as const;
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AdminSitesError";
    this.details = details;
  }
}
// END_BLOCK_DEFINE_ADMIN_SITES_ERROR_CLASS_M_ADMIN_SITES_004

// START_CONTRACT: toAdminSitesError
//   PURPOSE: Normalize unknown runtime failures into AdminSitesError with safe diagnostics.
//   INPUTS: { error: unknown - Caught runtime failure, message: string - Stable error message, details: Record<string, unknown> | undefined - Optional context }
//   OUTPUTS: { AdminSitesError - Typed admin sites error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-SITES]
// END_CONTRACT: toAdminSitesError
function toAdminSitesError(
  error: unknown,
  message: string,
  details?: Record<string, unknown>,
): AdminSitesError {
  // START_BLOCK_NORMALIZE_UNKNOWN_FAILURE_TO_ADMIN_SITES_ERROR_M_ADMIN_SITES_005
  if (error instanceof AdminSitesError) {
    return error;
  }

  const cause = error instanceof Error ? error.message : String(error);
  return new AdminSitesError(message, {
    ...details,
    cause,
  });
  // END_BLOCK_NORMALIZE_UNKNOWN_FAILURE_TO_ADMIN_SITES_ERROR_M_ADMIN_SITES_005
}

// START_CONTRACT: parseDateOrNull
//   PURPOSE: Safely convert a database date-like value to Date or null.
//   INPUTS: { value: unknown - Raw column value from SQL result }
//   OUTPUTS: { Date | null - Parsed Date or null }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-SITES]
// END_CONTRACT: parseDateOrNull
function parseDateOrNull(value: unknown): Date | null {
  // START_BLOCK_PARSE_DATE_OR_NULL_FROM_SQL_RESULT_M_ADMIN_SITES_006
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
  // END_BLOCK_PARSE_DATE_OR_NULL_FROM_SQL_RESULT_M_ADMIN_SITES_006
}

// START_CONTRACT: parseIntOrZero
//   PURPOSE: Safely convert a database numeric value to integer, defaulting to zero.
//   INPUTS: { value: unknown - Raw column value from SQL result }
//   OUTPUTS: { number - Parsed integer or 0 }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-SITES]
// END_CONTRACT: parseIntOrZero
function parseIntOrZero(value: unknown): number {
  // START_BLOCK_PARSE_INT_OR_ZERO_FROM_SQL_RESULT_M_ADMIN_SITES_007
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.floor(value) : 0;
  }

  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
  // END_BLOCK_PARSE_INT_OR_ZERO_FROM_SQL_RESULT_M_ADMIN_SITES_007
}

// START_CONTRACT: mapSourceRow
//   PURPOSE: Map a raw SQL result row to SiteSourceRow with type-safe parsing of aggregated fields.
//   INPUTS: { row: Record<string, unknown> - Raw row from aggregate query }
//   OUTPUTS: { SiteSourceRow - Typed source row with stats }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-SITES]
// END_CONTRACT: mapSourceRow
function mapSourceRow(row: Record<string, unknown>): SiteSourceRow {
  // START_BLOCK_MAP_RAW_ROW_TO_SITE_SOURCE_ROW_M_ADMIN_SITES_008
  return {
    source_id: String(row.source_id ?? ""),
    name: String(row.name ?? ""),
    domain: String(row.domain ?? ""),
    tier: parseIntOrZero(row.tier),
    language: String(row.language ?? ""),
    focus: String(row.focus ?? ""),
    status: String(row.status ?? ""),
    crawl_interval_minutes: parseIntOrZero(row.crawl_interval_minutes),
    max_pages: parseIntOrZero(row.max_pages),
    page_count: parseIntOrZero(row.page_count),
    chunk_count: parseIntOrZero(row.chunk_count),
    embedding_count: parseIntOrZero(row.embedding_count),
    last_crawl_at: parseDateOrNull(row.last_crawl_at),
  };
  // END_BLOCK_MAP_RAW_ROW_TO_SITE_SOURCE_ROW_M_ADMIN_SITES_008
}

// START_CONTRACT: mapCrawlJobRow
//   PURPOSE: Map a raw SQL result row to CrawlJobRow with type-safe parsing.
//   INPUTS: { row: Record<string, unknown> - Raw row from crawl jobs query }
//   OUTPUTS: { CrawlJobRow - Typed crawl job row }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-SITES]
// END_CONTRACT: mapCrawlJobRow
function mapCrawlJobRow(row: Record<string, unknown>): CrawlJobRow {
  // START_BLOCK_MAP_RAW_ROW_TO_CRAWL_JOB_ROW_M_ADMIN_SITES_009
  return {
    crawl_job_id: String(row.crawl_job_id ?? ""),
    source_id: String(row.source_id ?? ""),
    status: String(row.status ?? ""),
    started_at: parseDateOrNull(row.started_at),
    finished_at: parseDateOrNull(row.finished_at),
    pages_fetched: parseIntOrZero(row.pages_fetched),
    error: row.error === null || row.error === undefined ? null : String(row.error),
  };
  // END_BLOCK_MAP_RAW_ROW_TO_CRAWL_JOB_ROW_M_ADMIN_SITES_009
}

// START_CONTRACT: fetchSitesPageData
//   PURPOSE: Query all site sources with aggregated index stats (page_count, chunk_count, embedding_count, last_crawl_at) and recent crawl jobs for the admin sites management page.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, logger: Logger - Structured logger }
//   OUTPUTS: { Promise<SitesPageData> - Page data model with sources and recentCrawlJobs }
//   SIDE_EFFECTS: [Executes SQL queries against site_sources, site_pages, site_chunks, site_chunk_embeddings, and site_crawl_jobs tables; emits structured logs]
//   LINKS: [M-ADMIN-SITES, M-DB, M-LOGGER]
// END_CONTRACT: fetchSitesPageData
export async function fetchSitesPageData(
  db: NodePgDatabase,
  logger: Logger,
): Promise<SitesPageData> {
  // START_BLOCK_QUERY_SITE_SOURCES_WITH_AGGREGATED_STATS_M_ADMIN_SITES_010
  try {
    logger.info(
      "Fetching site sources with aggregated index stats.",
      "fetchSitesPageData",
      "QUERY_SITE_SOURCES_WITH_AGGREGATED_STATS",
    );

    const sourcesResult = await db.execute(sql`
      SELECT
        ss.source_id,
        ss.name,
        ss.domain,
        ss.tier,
        ss.language,
        ss.focus,
        ss.status,
        ss.crawl_interval_minutes,
        ss.max_pages,
        COALESCE(page_stats.page_count, 0) AS page_count,
        COALESCE(chunk_stats.chunk_count, 0) AS chunk_count,
        COALESCE(emb_stats.embedding_count, 0) AS embedding_count,
        crawl_stats.last_crawl_at
      FROM site_sources ss
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS page_count
        FROM site_pages sp
        WHERE sp.source_id = ss.source_id
      ) page_stats ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS chunk_count
        FROM site_chunks sc
        INNER JOIN site_pages sp2 ON sp2.page_id = sc.page_id
        WHERE sp2.source_id = ss.source_id
      ) chunk_stats ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS embedding_count
        FROM site_chunk_embeddings sce
        INNER JOIN site_chunks sc2 ON sc2.chunk_id = sce.chunk_id
        INNER JOIN site_pages sp3 ON sp3.page_id = sc2.page_id
        WHERE sp3.source_id = ss.source_id
      ) emb_stats ON true
      LEFT JOIN LATERAL (
        SELECT MAX(scj.finished_at) AS last_crawl_at
        FROM site_crawl_jobs scj
        WHERE scj.source_id = ss.source_id
          AND scj.status = 'completed'
      ) crawl_stats ON true
      ORDER BY ss.tier ASC, ss.name ASC
    `);

    const sources = sourcesResult.rows.map((row) =>
      mapSourceRow(row as Record<string, unknown>),
    );

    logger.info(
      "Fetched site sources with aggregated stats.",
      "fetchSitesPageData",
      "QUERY_SITE_SOURCES_WITH_AGGREGATED_STATS",
      { sourceCount: sources.length },
    );
    // END_BLOCK_QUERY_SITE_SOURCES_WITH_AGGREGATED_STATS_M_ADMIN_SITES_010

    // START_BLOCK_QUERY_RECENT_CRAWL_JOBS_M_ADMIN_SITES_011
    logger.info(
      "Fetching recent crawl jobs.",
      "fetchSitesPageData",
      "QUERY_RECENT_CRAWL_JOBS",
    );

    const crawlJobsResult = await db.execute(sql`
      SELECT
        crawl_job_id,
        source_id,
        status,
        started_at,
        finished_at,
        pages_fetched,
        error
      FROM site_crawl_jobs
      ORDER BY started_at DESC NULLS LAST
      LIMIT ${RECENT_CRAWL_JOBS_LIMIT}
    `);

    const recentCrawlJobs = crawlJobsResult.rows.map((row) =>
      mapCrawlJobRow(row as Record<string, unknown>),
    );

    logger.info(
      "Fetched recent crawl jobs.",
      "fetchSitesPageData",
      "QUERY_RECENT_CRAWL_JOBS",
      { crawlJobCount: recentCrawlJobs.length },
    );

    return { sources, recentCrawlJobs };
    // END_BLOCK_QUERY_RECENT_CRAWL_JOBS_M_ADMIN_SITES_011
  } catch (error: unknown) {
    // START_BLOCK_HANDLE_FETCH_SITES_PAGE_DATA_FAILURE_M_ADMIN_SITES_012
    const sitesError = toAdminSitesError(
      error,
      "Failed to fetch sites page data.",
      { operation: "fetchSitesPageData" },
    );

    logger.error(
      "Failed to fetch sites page data.",
      "fetchSitesPageData",
      "HANDLE_FETCH_SITES_PAGE_DATA_FAILURE",
      {
        code: sitesError.code,
        cause: sitesError.details?.cause ?? sitesError.message,
      },
    );

    throw sitesError;
    // END_BLOCK_HANDLE_FETCH_SITES_PAGE_DATA_FAILURE_M_ADMIN_SITES_012
  }
}
