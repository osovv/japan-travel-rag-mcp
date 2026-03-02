// FILE: src/admin/sites-page.tsx
// VERSION: 1.4.0
// START_MODULE_CONTRACT
//   PURPOSE: Query curated site source data with per-source index statistics and recent crawl job summaries for the Sites Management admin page, and render HTML views for the sites list and source create/edit forms.
//   SCOPE: Define page data types (SiteSourceRow, CrawlJobRow, SitesPageData), fetch aggregated stats via Drizzle raw SQL, return structured page model, and render server-side HTML for sites management UI.
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
//   CreateSourceInputSchema - Zod schema for creating a new site source.
//   UpdateSourceInputSchema - Zod schema for partial-updating a site source (source_id excluded).
//   handleCreateSource - Validate input and INSERT a new site source row.
//   handleUpdateSource - Validate input and UPDATE an existing site source row.
//   handleDeleteSource - CASCADE delete a source and all dependent rows in FK order.
//   handlePurgeSourceIndex - Delete embeddings and chunks for a source while keeping pages and source row.
//   handleToggleSourceStatus - Toggle a source status between active and paused.
//   escapeHtml - Escape user-controlled text for safe HTML rendering (XSS prevention).
//   renderSitesContent - Render the main sites management page with sources table, actions, and recent crawl jobs.
//   renderSourceForm - Render create/edit form for a site source with Zod validation error display.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.4.0 - Group site sources by country_code in collapsible accordion sections; add country_code to SiteSourceRow, SQL query, CreateSourceInputSchema, and create/edit form.
//   v1.3.0 - Add handlePurgeSourceIndex function and Purge & Recrawl button to sites management UI.
//   v1.1.0 - Add CRUD operations (handleCreateSource, handleUpdateSource, handleDeleteSource, handleToggleSourceStatus) with Zod validation schemas.
//   v1.0.0 - Initial creation with data layer types and fetchSitesPageData for M-ADMIN-SITES.
// END_CHANGE_SUMMARY

import * as Html from "@kitajs/html";
import { z } from "zod";
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
  country_code: string;
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
    country_code: String(row.country_code ?? ""),
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
        ss.country_code,
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
        SELECT MAX(sp4.fetched_at) AS last_crawl_at
        FROM site_pages sp4
        WHERE sp4.source_id = ss.source_id
      ) crawl_stats ON true
      ORDER BY ss.country_code ASC, ss.tier ASC, ss.name ASC
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

// START_BLOCK_DEFINE_CREATE_SOURCE_INPUT_SCHEMA_M_ADMIN_SITES_013
export const CreateSourceInputSchema = z.object({
  source_id: z
    .string()
    .min(3, "source_id must be at least 3 characters")
    .max(50, "source_id must be at most 50 characters")
    .regex(/^[a-z0-9_]+$/, "source_id must be lowercase alphanumeric with underscores only"),
  country_code: z
    .string()
    .min(2, "country_code must be at least 2 characters")
    .max(10, "country_code must be at most 10 characters")
    .regex(/^[a-z]+$/, "country_code must be lowercase letters only"),
  name: z
    .string()
    .min(1, "name is required")
    .max(200, "name must be at most 200 characters"),
  domain: z
    .string()
    .min(1, "domain is required")
    .max(500, "domain must be at most 500 characters"),
  tier: z
    .number()
    .int("tier must be an integer")
    .min(0, "tier must be 0, 1, or 2")
    .max(2, "tier must be 0, 1, or 2"),
  language: z
    .string()
    .min(1, "language is required")
    .max(20, "language must be at most 20 characters"),
  focus: z
    .string()
    .min(1, "focus is required")
    .max(500, "focus must be at most 500 characters"),
  crawl_interval_minutes: z
    .number()
    .int("crawl_interval_minutes must be an integer")
    .min(60, "crawl_interval_minutes must be at least 60"),
  max_pages: z
    .number()
    .int("max_pages must be an integer")
    .min(1, "max_pages must be at least 1")
    .max(1000, "max_pages must be at most 1000"),
});
// END_BLOCK_DEFINE_CREATE_SOURCE_INPUT_SCHEMA_M_ADMIN_SITES_013

// START_BLOCK_DEFINE_UPDATE_SOURCE_INPUT_SCHEMA_M_ADMIN_SITES_014
export const UpdateSourceInputSchema = z.object({
  name: z
    .string()
    .min(1, "name is required")
    .max(200, "name must be at most 200 characters")
    .optional(),
  domain: z
    .string()
    .min(1, "domain is required")
    .max(500, "domain must be at most 500 characters")
    .optional(),
  tier: z
    .number()
    .int("tier must be an integer")
    .min(0, "tier must be 0, 1, or 2")
    .max(2, "tier must be 0, 1, or 2")
    .optional(),
  language: z
    .string()
    .min(1, "language is required")
    .max(20, "language must be at most 20 characters")
    .optional(),
  focus: z
    .string()
    .min(1, "focus is required")
    .max(500, "focus must be at most 500 characters")
    .optional(),
  crawl_interval_minutes: z
    .number()
    .int("crawl_interval_minutes must be an integer")
    .min(60, "crawl_interval_minutes must be at least 60")
    .optional(),
  max_pages: z
    .number()
    .int("max_pages must be an integer")
    .min(1, "max_pages must be at least 1")
    .max(1000, "max_pages must be at most 1000")
    .optional(),
});
// END_BLOCK_DEFINE_UPDATE_SOURCE_INPUT_SCHEMA_M_ADMIN_SITES_014

// START_BLOCK_DEFINE_FORMAT_ZOD_ERRORS_HELPER_M_ADMIN_SITES_015
function formatZodErrors(
  issues: z.ZodIssue[],
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = issue.path.length > 0 ? String(issue.path[0]) : "_root";
    if (!errors[field]) {
      errors[field] = [];
    }
    errors[field].push(issue.message);
  }
  return errors;
}
// END_BLOCK_DEFINE_FORMAT_ZOD_ERRORS_HELPER_M_ADMIN_SITES_015

// START_CONTRACT: handleCreateSource
//   PURPOSE: Validate input with CreateSourceInputSchema and INSERT a new row into site_sources.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, logger: Logger - Structured logger, input: unknown - Raw create payload }
//   OUTPUTS: { Promise<{ success: boolean; sourceId?: string; errors?: Record<string, string[]> }> }
//   SIDE_EFFECTS: [INSERT into site_sources; emits structured logs]
//   LINKS: [M-ADMIN-SITES, M-DB, M-LOGGER]
// END_CONTRACT: handleCreateSource
export async function handleCreateSource(
  db: NodePgDatabase,
  logger: Logger,
  input: unknown,
): Promise<{ success: boolean; sourceId?: string; errors?: Record<string, string[]> }> {
  // START_BLOCK_VALIDATE_AND_INSERT_NEW_SOURCE_M_ADMIN_SITES_016
  const parsed = CreateSourceInputSchema.safeParse(input);

  if (!parsed.success) {
    const errors = formatZodErrors(parsed.error.issues);
    logger.warn(
      "Create source validation failed.",
      "handleCreateSource",
      "VALIDATE_AND_INSERT_NEW_SOURCE",
      { errors },
    );
    return { success: false, errors };
  }

  const data = parsed.data;

  try {
    await db.execute(sql`
      INSERT INTO site_sources (
        source_id, country_code, name, domain, tier, language, focus,
        crawl_interval_minutes, max_pages
      ) VALUES (
        ${data.source_id},
        ${data.country_code},
        ${data.name},
        ${data.domain},
        ${data.tier},
        ${data.language},
        ${data.focus},
        ${data.crawl_interval_minutes},
        ${data.max_pages}
      )
    `);

    logger.info(
      "Created new site source.",
      "handleCreateSource",
      "VALIDATE_AND_INSERT_NEW_SOURCE",
      { sourceId: data.source_id },
    );

    return { success: true, sourceId: data.source_id };
  } catch (error: unknown) {
    const sitesError = toAdminSitesError(
      error,
      "Failed to create site source.",
      { operation: "handleCreateSource", sourceId: data.source_id },
    );

    logger.error(
      "Failed to create site source.",
      "handleCreateSource",
      "VALIDATE_AND_INSERT_NEW_SOURCE",
      { code: sitesError.code, cause: sitesError.details?.cause ?? sitesError.message },
    );

    throw sitesError;
  }
  // END_BLOCK_VALIDATE_AND_INSERT_NEW_SOURCE_M_ADMIN_SITES_016
}

// START_CONTRACT: handleUpdateSource
//   PURPOSE: Validate input with UpdateSourceInputSchema and UPDATE an existing site_sources row.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, logger: Logger - Structured logger, sourceId: string - Immutable source identifier, input: unknown - Raw update payload }
//   OUTPUTS: { Promise<{ success: boolean; errors?: Record<string, string[]> }> }
//   SIDE_EFFECTS: [UPDATE site_sources; emits structured logs]
//   LINKS: [M-ADMIN-SITES, M-DB, M-LOGGER]
// END_CONTRACT: handleUpdateSource
export async function handleUpdateSource(
  db: NodePgDatabase,
  logger: Logger,
  sourceId: string,
  input: unknown,
): Promise<{ success: boolean; errors?: Record<string, string[]> }> {
  // START_BLOCK_VALIDATE_AND_UPDATE_SOURCE_M_ADMIN_SITES_017
  const parsed = UpdateSourceInputSchema.safeParse(input);

  if (!parsed.success) {
    const errors = formatZodErrors(parsed.error.issues);
    logger.warn(
      "Update source validation failed.",
      "handleUpdateSource",
      "VALIDATE_AND_UPDATE_SOURCE",
      { errors, sourceId },
    );
    return { success: false, errors };
  }

  const data = parsed.data;
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined) {
    setClauses.push("name");
    values.push(data.name);
  }
  if (data.domain !== undefined) {
    setClauses.push("domain");
    values.push(data.domain);
  }
  if (data.tier !== undefined) {
    setClauses.push("tier");
    values.push(data.tier);
  }
  if (data.language !== undefined) {
    setClauses.push("language");
    values.push(data.language);
  }
  if (data.focus !== undefined) {
    setClauses.push("focus");
    values.push(data.focus);
  }
  if (data.crawl_interval_minutes !== undefined) {
    setClauses.push("crawl_interval_minutes");
    values.push(data.crawl_interval_minutes);
  }
  if (data.max_pages !== undefined) {
    setClauses.push("max_pages");
    values.push(data.max_pages);
  }

  if (setClauses.length === 0) {
    logger.info(
      "No fields to update.",
      "handleUpdateSource",
      "VALIDATE_AND_UPDATE_SOURCE",
      { sourceId },
    );
    return { success: true };
  }

  try {
    const setFragment = setClauses.map((col, i) => {
      const val = values[i];
      return sql`${sql.raw(col)} = ${val}`;
    });

    const query = sql`UPDATE site_sources SET ${sql.join(setFragment, sql`, `)} WHERE source_id = ${sourceId}`;
    await db.execute(query);

    logger.info(
      "Updated site source.",
      "handleUpdateSource",
      "VALIDATE_AND_UPDATE_SOURCE",
      { sourceId, updatedFields: setClauses },
    );

    return { success: true };
  } catch (error: unknown) {
    const sitesError = toAdminSitesError(
      error,
      "Failed to update site source.",
      { operation: "handleUpdateSource", sourceId },
    );

    logger.error(
      "Failed to update site source.",
      "handleUpdateSource",
      "VALIDATE_AND_UPDATE_SOURCE",
      { code: sitesError.code, cause: sitesError.details?.cause ?? sitesError.message },
    );

    throw sitesError;
  }
  // END_BLOCK_VALIDATE_AND_UPDATE_SOURCE_M_ADMIN_SITES_017
}

// START_CONTRACT: handleDeleteSource
//   PURPOSE: CASCADE delete a source and all dependent rows in FK order: site_chunk_embeddings, site_chunks, site_pages, site_crawl_jobs, site_sources.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, logger: Logger - Structured logger, sourceId: string - Source to delete }
//   OUTPUTS: { Promise<void> }
//   SIDE_EFFECTS: [DELETE rows from site_chunk_embeddings, site_chunks, site_pages, site_crawl_jobs, site_sources; emits structured logs]
//   LINKS: [M-ADMIN-SITES, M-DB, M-LOGGER]
// END_CONTRACT: handleDeleteSource
export async function handleDeleteSource(
  db: NodePgDatabase,
  logger: Logger,
  sourceId: string,
): Promise<void> {
  // START_BLOCK_CASCADE_DELETE_SOURCE_M_ADMIN_SITES_018
  try {
    logger.info(
      "Starting cascade delete for source.",
      "handleDeleteSource",
      "CASCADE_DELETE_SOURCE",
      { sourceId },
    );

    // Step 1: Delete embeddings (references chunks -> pages -> source)
    await db.execute(sql`
      DELETE FROM site_chunk_embeddings
      WHERE chunk_id IN (
        SELECT sc.chunk_id FROM site_chunks sc
        INNER JOIN site_pages sp ON sp.page_id = sc.page_id
        WHERE sp.source_id = ${sourceId}
      )
    `);
    logger.info(
      "Deleted site_chunk_embeddings for source.",
      "handleDeleteSource",
      "CASCADE_DELETE_SOURCE",
      { sourceId, step: "site_chunk_embeddings" },
    );

    // Step 2: Delete chunks (references pages -> source)
    await db.execute(sql`
      DELETE FROM site_chunks
      WHERE page_id IN (
        SELECT sp.page_id FROM site_pages sp
        WHERE sp.source_id = ${sourceId}
      )
    `);
    logger.info(
      "Deleted site_chunks for source.",
      "handleDeleteSource",
      "CASCADE_DELETE_SOURCE",
      { sourceId, step: "site_chunks" },
    );

    // Step 3: Delete pages (references source)
    await db.execute(sql`
      DELETE FROM site_pages WHERE source_id = ${sourceId}
    `);
    logger.info(
      "Deleted site_pages for source.",
      "handleDeleteSource",
      "CASCADE_DELETE_SOURCE",
      { sourceId, step: "site_pages" },
    );

    // Step 4: Delete crawl jobs (references source)
    await db.execute(sql`
      DELETE FROM site_crawl_jobs WHERE source_id = ${sourceId}
    `);
    logger.info(
      "Deleted site_crawl_jobs for source.",
      "handleDeleteSource",
      "CASCADE_DELETE_SOURCE",
      { sourceId, step: "site_crawl_jobs" },
    );

    // Step 5: Delete the source itself
    await db.execute(sql`
      DELETE FROM site_sources WHERE source_id = ${sourceId}
    `);
    logger.info(
      "Deleted site_sources row. Cascade delete complete.",
      "handleDeleteSource",
      "CASCADE_DELETE_SOURCE",
      { sourceId, step: "site_sources" },
    );
  } catch (error: unknown) {
    const sitesError = toAdminSitesError(
      error,
      "Failed to cascade delete site source.",
      { operation: "handleDeleteSource", sourceId },
    );

    logger.error(
      "Failed to cascade delete site source.",
      "handleDeleteSource",
      "CASCADE_DELETE_SOURCE",
      { code: sitesError.code, cause: sitesError.details?.cause ?? sitesError.message },
    );

    throw sitesError;
  }
  // END_BLOCK_CASCADE_DELETE_SOURCE_M_ADMIN_SITES_018
}

// START_CONTRACT: handlePurgeSourceIndex
//   PURPOSE: Delete all embeddings and chunks for a source while keeping pages and the source row intact. Used before a recrawl to purge stale index data.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, logger: Logger - Structured logger, sourceId: string - Source to purge }
//   OUTPUTS: { Promise<void> }
//   SIDE_EFFECTS: [DELETE rows from site_chunk_embeddings and site_chunks for the given source; emits structured logs]
//   LINKS: [M-ADMIN-SITES, M-DB, M-LOGGER]
// END_CONTRACT: handlePurgeSourceIndex
export async function handlePurgeSourceIndex(
  db: NodePgDatabase,
  logger: Logger,
  sourceId: string,
): Promise<void> {
  // START_BLOCK_PURGE_SOURCE_INDEX_M_ADMIN_SITES_025
  try {
    logger.info(
      "Starting index purge for source.",
      "handlePurgeSourceIndex",
      "PURGE_SOURCE_INDEX",
      { sourceId },
    );

    // Step 1: Delete embeddings (references chunks -> pages -> source)
    await db.execute(sql`
      DELETE FROM site_chunk_embeddings
      WHERE chunk_id IN (
        SELECT sc.chunk_id FROM site_chunks sc
        INNER JOIN site_pages sp ON sp.page_id = sc.page_id
        WHERE sp.source_id = ${sourceId}
      )
    `);
    logger.info(
      "Deleted site_chunk_embeddings for source.",
      "handlePurgeSourceIndex",
      "PURGE_SOURCE_INDEX",
      { sourceId, step: "site_chunk_embeddings" },
    );

    // Step 2: Delete chunks (references pages -> source)
    await db.execute(sql`
      DELETE FROM site_chunks
      WHERE page_id IN (
        SELECT sp.page_id FROM site_pages sp
        WHERE sp.source_id = ${sourceId}
      )
    `);
    logger.info(
      "Deleted site_chunks for source. Purge complete.",
      "handlePurgeSourceIndex",
      "PURGE_SOURCE_INDEX",
      { sourceId, step: "site_chunks" },
    );
  } catch (error: unknown) {
    const sitesError = toAdminSitesError(
      error,
      "Failed to purge source index.",
      { operation: "handlePurgeSourceIndex", sourceId },
    );

    logger.error(
      "Failed to purge source index.",
      "handlePurgeSourceIndex",
      "PURGE_SOURCE_INDEX",
      { code: sitesError.code, cause: sitesError.details?.cause ?? sitesError.message },
    );

    throw sitesError;
  }
  // END_BLOCK_PURGE_SOURCE_INDEX_M_ADMIN_SITES_025
}

// START_CONTRACT: handleToggleSourceStatus
//   PURPOSE: Toggle a site source status between "active" and "paused".
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, logger: Logger - Structured logger, sourceId: string - Source to update, newStatus: "active" | "paused" - Target status }
//   OUTPUTS: { Promise<void> }
//   SIDE_EFFECTS: [UPDATE site_sources SET status; emits structured logs]
//   LINKS: [M-ADMIN-SITES, M-DB, M-LOGGER]
// END_CONTRACT: handleToggleSourceStatus
export async function handleToggleSourceStatus(
  db: NodePgDatabase,
  logger: Logger,
  sourceId: string,
  newStatus: "active" | "paused",
): Promise<void> {
  // START_BLOCK_TOGGLE_SOURCE_STATUS_M_ADMIN_SITES_019
  try {
    await db.execute(sql`
      UPDATE site_sources SET status = ${newStatus} WHERE source_id = ${sourceId}
    `);

    logger.info(
      "Toggled source status.",
      "handleToggleSourceStatus",
      "TOGGLE_SOURCE_STATUS",
      { sourceId, newStatus },
    );
  } catch (error: unknown) {
    const sitesError = toAdminSitesError(
      error,
      "Failed to toggle source status.",
      { operation: "handleToggleSourceStatus", sourceId, newStatus },
    );

    logger.error(
      "Failed to toggle source status.",
      "handleToggleSourceStatus",
      "TOGGLE_SOURCE_STATUS",
      { code: sitesError.code, cause: sitesError.details?.cause ?? sitesError.message },
    );

    throw sitesError;
  }
  // END_BLOCK_TOGGLE_SOURCE_STATUS_M_ADMIN_SITES_019
}

// START_BLOCK_DEFINE_FORMAT_DATE_HELPER_M_ADMIN_SITES_021
function formatDate(date: Date | null): string {
  if (date === null) {
    return "--";
  }
  return date.toISOString().replace("T", " ").slice(0, 19);
}
// END_BLOCK_DEFINE_FORMAT_DATE_HELPER_M_ADMIN_SITES_021

// START_BLOCK_DEFINE_SITES_PAGE_STYLES_M_ADMIN_SITES_022
function SitesPageStyles(): string {
  return (
    <style>{`
      .badge { display:inline-block; font-size:0.78rem; font-weight:600; padding:0.15rem 0.55rem; border-radius:999px; }
      .badge-active { background:#dcfce7; color:#166534; }
      .badge-paused { background:#f1f5f9; color:#475569; }
      .badge-completed { background:#dcfce7; color:#166534; }
      .badge-running { background:#dbeafe; color:#1e40af; }
      .badge-failed { background:#fef2f2; color:#991b1b; }
      .badge-pending { background:#fefce8; color:#854d0e; }
      .btn { display:inline-block; font-size:0.82rem; font-weight:600; padding:0.35rem 0.7rem; border-radius:0.4rem; border:1px solid transparent; cursor:pointer; text-decoration:none; text-align:center; font-family:inherit; line-height:1.4; }
      .btn-accent { background:var(--accent); color:#fff; }
      .btn-accent:hover { opacity:0.9; }
      .btn-warning { background:#f59e0b; color:#fff; }
      .btn-warning:hover { opacity:0.9; }
      .btn-danger { background:var(--danger, #991b1b); color:#fff; }
      .btn-danger:hover { opacity:0.9; }
      .btn-outline { background:transparent; border-color:var(--line); color:var(--fg); }
      .btn-outline:hover { background:#f8fafc; }
      .btn-sm { font-size:0.75rem; padding:0.25rem 0.5rem; }
      .actions-cell { display:flex; gap:0.35rem; align-items:center; flex-wrap:nowrap; }
      .actions-cell form { margin:0; }
      .form-group { display:grid; gap:0.3rem; margin-bottom:0.85rem; }
      .form-group label { font-weight:600; font-size:0.88rem; }
      .form-group input, .form-group select { width:100%; padding:0.55rem 0.65rem; border:1px solid var(--line); border-radius:0.4rem; font:inherit; background:#fff; }
      .form-group input:focus, .form-group select:focus { outline:2px solid var(--accent); outline-offset:1px; }
      .form-group input[readonly] { background:#f1f5f9; color:#64748b; cursor:not-allowed; }
      .field-error { color:var(--danger, #991b1b); font-size:0.82rem; }
      .form-actions { display:flex; gap:0.5rem; margin-top:0.5rem; }
      .crawl-error-cell { max-width:20rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.82rem; color:var(--danger, #991b1b); }
      .country-group { border:1px solid var(--line, #e2e8f0); border-radius:0.5rem; overflow:hidden; }
      .country-group summary { cursor:pointer; padding:0.65rem 1rem; background:#f8fafc; font-weight:600; font-size:0.95rem; display:flex; align-items:center; gap:0.5rem; user-select:none; list-style:none; }
      .country-group summary::-webkit-details-marker { display:none; }
      .country-group summary::before { content:"\\25B6"; font-size:0.7rem; transition:transform 0.15s; display:inline-block; }
      .country-group[open] summary::before { transform:rotate(90deg); }
      .country-group summary .country-stats { font-weight:400; font-size:0.82rem; color:#64748b; margin-left:auto; }
      .country-group .country-body { padding:0; }
      .country-group .country-body .diag-table { border:none; border-radius:0; }
      .country-code-label { text-transform:uppercase; letter-spacing:0.05em; }
    `}</style>
  ) as string;
}
// END_BLOCK_DEFINE_SITES_PAGE_STYLES_M_ADMIN_SITES_022

function SourceRow({ s }: { s: SiteSourceRow }): string {
  const statusClass = s.status === "active" ? "badge-active" : "badge-paused";
  const toggleTarget = s.status === "active" ? "paused" : "active";
  const toggleLabel = s.status === "active" ? "Pause" : "Resume";
  const sid = Html.escapeHtml(s.source_id);

  return (
    <tr>
      <td><code>{sid}</code></td>
      <td safe>{s.name}</td>
      <td safe>{s.domain}</td>
      <td>{String(s.tier)}</td>
      <td safe>{s.language}</td>
      <td><span class={`badge ${statusClass}`} safe>{s.status}</span></td>
      <td>{String(s.page_count)}</td>
      <td>{String(s.chunk_count)}</td>
      <td>{String(s.embedding_count)}</td>
      <td>{formatDate(s.last_crawl_at)}</td>
      <td>
        <div class="actions-cell">
          <a href={`/admin/sites/${sid}/edit`} class="btn btn-accent btn-sm">Edit</a>
          <form method="post" action={`/admin/sites/${sid}/toggle`}>
            <input type="hidden" name="status" value={toggleTarget} />
            <button type="submit" class="btn btn-warning btn-sm">{toggleLabel}</button>
          </form>
          <form method="post" action={`/admin/sites/${sid}/purge`} onsubmit={`return confirm('Purge all chunks and embeddings for ${sid}? The worker will re-crawl on next tick.')`}>
            <button type="submit" class="btn btn-warning btn-sm">{"Purge & Recrawl"}</button>
          </form>
          <form method="post" action={`/admin/sites/${sid}/delete`} onsubmit={`return confirm('Delete source ${sid} and ALL its pages, chunks, and embeddings? This cannot be undone.')`}>
            <button type="submit" class="btn btn-danger btn-sm">Delete</button>
          </form>
        </div>
      </td>
    </tr>
  ) as string;
}

function CountryAccordion({ cc, sources }: { cc: string; sources: SiteSourceRow[] }): string {
  const totalPages = sources.reduce((sum, s) => sum + s.page_count, 0);
  const totalChunks = sources.reduce((sum, s) => sum + s.chunk_count, 0);
  const totalEmbeddings = sources.reduce((sum, s) => sum + s.embedding_count, 0);

  return (
    <details class="country-group" open>
      <summary>
        <span class="country-code-label" safe>{cc}</span>
        <span class="country-stats">
          {`${sources.length} source${sources.length !== 1 ? "s" : ""} \u00B7 ${totalPages} pages \u00B7 ${totalChunks} chunks \u00B7 ${totalEmbeddings} embeddings`}
        </span>
      </summary>
      <div class="country-body">
        <div class="table-wrap">
          <table class="diag-table">
            <thead>
              <tr>
                <th>Source ID</th>
                <th>Name</th>
                <th>Domain</th>
                <th>Tier</th>
                <th>Language</th>
                <th>Status</th>
                <th>Pages</th>
                <th>Chunks</th>
                <th>Embeddings</th>
                <th>Last Crawl</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => <SourceRow s={s} />)}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  ) as string;
}

function CrawlJobRow({ j }: { j: CrawlJobRow }): string {
  const jobStatusClass =
    j.status === "completed"
      ? "badge-completed"
      : j.status === "running"
        ? "badge-running"
        : j.status === "failed"
          ? "badge-failed"
          : "badge-pending";

  return (
    <tr>
      <td><code safe>{j.crawl_job_id}</code></td>
      <td><code safe>{j.source_id}</code></td>
      <td><span class={`badge ${jobStatusClass}`} safe>{j.status}</span></td>
      <td>{formatDate(j.started_at)}</td>
      <td>{formatDate(j.finished_at)}</td>
      <td>{String(j.pages_fetched)}</td>
      <td>
        {j.error !== null
          ? <span class="crawl-error-cell" title={Html.escapeHtml(j.error)} safe>{j.error}</span>
          : "--"}
      </td>
    </tr>
  ) as string;
}

// START_CONTRACT: SitesContent
//   PURPOSE: Render the main sites management page content with sources grouped by country_code in collapsible accordion sections, each containing a sources table, followed by a recent crawl jobs table and an Add Source button.
//   INPUTS: { data: SitesPageData - Page data model with sources and recentCrawlJobs arrays }
//   OUTPUTS: { string - HTML content fragment for the sites management page }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-SITES]
// END_CONTRACT: SitesContent
export function SitesContent(data: SitesPageData): string {
  // START_BLOCK_RENDER_SITES_MANAGEMENT_PAGE_CONTENT_M_ADMIN_SITES_023

  // Group sources by country_code preserving query order
  const grouped = new Map<string, SiteSourceRow[]>();
  for (const s of data.sources) {
    const cc = s.country_code || "unknown";
    const list = grouped.get(cc);
    if (list) {
      list.push(s);
    } else {
      grouped.set(cc, [s]);
    }
  }

  return (
    <>
      <SitesPageStyles />
      <section id="sites-management" class="stack">
        <section class="card">
          <h2>Sites Management</h2>
          <p class="muted">{`Manage curated site sources grouped by country. ${data.sources.length} total source${data.sources.length !== 1 ? "s" : ""} across ${grouped.size} countr${grouped.size !== 1 ? "ies" : "y"}.`}</p>
        </section>
        <section class="card">
          {grouped.size > 0
            ? <div class="stack">
                {Array.from(grouped.entries()).map(([cc, sources]) => (
                  <CountryAccordion cc={cc} sources={sources} />
                ))}
              </div>
            : <p class="muted" style="text-align:center;">No site sources configured.</p>}
          <div style="margin-top:0.75rem;">
            <a href="/admin/sites/new" class="btn btn-accent">Add Source</a>
          </div>
        </section>
        <section class="card table-wrap">
          <h3>Recent Crawl Jobs</h3>
          <table class="diag-table">
            <thead>
              <tr>
                <th>Crawl Job ID</th>
                <th>Source ID</th>
                <th>Status</th>
                <th>Started At</th>
                <th>Finished At</th>
                <th>Pages Fetched</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {data.recentCrawlJobs.length > 0
                ? data.recentCrawlJobs.map((j) => <CrawlJobRow j={j} />)
                : <tr><td colspan="7" class="muted" style="text-align:center;">No crawl jobs recorded.</td></tr>}
            </tbody>
          </table>
        </section>
      </section>
    </>
  ) as string;
  // END_BLOCK_RENDER_SITES_MANAGEMENT_PAGE_CONTENT_M_ADMIN_SITES_023
}

function FieldErrors({ errors, field }: { errors?: Record<string, string[]>; field: string }): string {
  if (!errors || !errors[field]) return "";
  return (<>{errors[field].map((msg) => <p class="field-error" safe>{msg}</p>)}</>) as string;
}

// START_CONTRACT: SourceForm
//   PURPOSE: Render create or edit form for a site source with field validation error display and PRG-compatible form actions.
//   INPUTS: { params: { mode: "create" | "edit", source?: SiteSourceRow, errors?: Record<string, string[]> } }
//   OUTPUTS: { string - HTML content fragment for the source create/edit form }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-SITES]
// END_CONTRACT: SourceForm
export function SourceForm(params: {
  mode: "create" | "edit";
  source?: SiteSourceRow;
  errors?: Record<string, string[]>;
}): string {
  // START_BLOCK_RENDER_SOURCE_CREATE_EDIT_FORM_M_ADMIN_SITES_024
  const { mode, source, errors } = params;
  const isEdit = mode === "edit";
  const title = isEdit ? "Edit Source" : "Add New Source";
  const action = isEdit && source
    ? `/admin/sites/${Html.escapeHtml(source.source_id)}/edit`
    : "/admin/sites";

  const val = (field: keyof SiteSourceRow): string => {
    if (source && source[field] !== null && source[field] !== undefined) {
      return Html.escapeHtml(String(source[field]));
    }
    return "";
  };

  const tierOptions = [0, 1, 2].map((t) => {
    const selected = source && source.tier === t;
    return <option value={String(t)} selected={selected || undefined}>{`Tier ${t}`}</option>;
  });

  return (
    <>
      <SitesPageStyles />
      <section id="source-form" class="stack">
        <section class="card">
          <h2 safe>{title}</h2>
          {isEdit && source
            ? <p class="muted">Editing source <code safe>{source.source_id}</code>.</p>
            : <p class="muted">Create a new curated site source for crawling and indexing.</p>}
        </section>
        <section class="card">
          <form method="post" action={action}>
            <div class="form-group">
              <label for="source_id">Source ID</label>
              {isEdit
                ? <input type="text" id="source_id" name="source_id" value={val("source_id")} readonly />
                : <input type="text" id="source_id" name="source_id" value={val("source_id")} required placeholder="e.g. japan_guide" pattern="^[a-z0-9_]+$" minlength="3" maxlength="50" />}
              <FieldErrors errors={errors} field="source_id" />
            </div>

            <div class="form-group">
              <label for="country_code">Country Code</label>
              {isEdit
                ? <input type="text" id="country_code" name="country_code" value={val("country_code")} readonly />
                : <input type="text" id="country_code" name="country_code" value={val("country_code") || "jp"} required placeholder="e.g. jp" pattern="^[a-z]+$" minlength="2" maxlength="10" />}
              <FieldErrors errors={errors} field="country_code" />
            </div>

            <div class="form-group">
              <label for="name">Name</label>
              <input type="text" id="name" name="name" value={val("name")} required maxlength="200" placeholder="e.g. Japan Guide" />
              <FieldErrors errors={errors} field="name" />
            </div>

            <div class="form-group">
              <label for="domain">Domain</label>
              <input type="text" id="domain" name="domain" value={val("domain")} required maxlength="500" placeholder="e.g. https://www.japan-guide.com" />
              <FieldErrors errors={errors} field="domain" />
            </div>

            <div class="form-group">
              <label for="tier">Tier</label>
              <select id="tier" name="tier" required>
                {tierOptions}
              </select>
              <FieldErrors errors={errors} field="tier" />
            </div>

            <div class="form-group">
              <label for="language">Language</label>
              <input type="text" id="language" name="language" value={val("language")} required maxlength="20" placeholder="e.g. en" />
              <FieldErrors errors={errors} field="language" />
            </div>

            <div class="form-group">
              <label for="focus">Focus</label>
              <input type="text" id="focus" name="focus" value={val("focus")} required maxlength="500" placeholder="e.g. General Japan travel information" />
              <FieldErrors errors={errors} field="focus" />
            </div>

            <div class="form-group">
              <label for="crawl_interval_minutes">Crawl Interval (minutes)</label>
              <input type="number" id="crawl_interval_minutes" name="crawl_interval_minutes" value={val("crawl_interval_minutes") || "1440"} required min="60" />
              <FieldErrors errors={errors} field="crawl_interval_minutes" />
            </div>

            <div class="form-group">
              <label for="max_pages">Max Pages</label>
              <input type="number" id="max_pages" name="max_pages" value={val("max_pages") || "100"} required min="1" max="1000" />
              <FieldErrors errors={errors} field="max_pages" />
            </div>

            <div class="form-actions">
              <button type="submit" class="btn btn-accent">{isEdit ? "Save Changes" : "Create Source"}</button>
              <a href="/admin/sites" class="btn btn-outline">Cancel</a>
            </div>
          </form>
        </section>
      </section>
    </>
  ) as string;
  // END_BLOCK_RENDER_SOURCE_CREATE_EDIT_FORM_M_ADMIN_SITES_024
}
