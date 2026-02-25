// FILE: src/db/index.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Create and expose Drizzle PostgreSQL database client from DATABASE_URL runtime configuration.
//   SCOPE: Validate runtime database URL input, initialize pg Pool and Drizzle database handle, perform fail-fast connectivity probe, and return typed DB resources.
//   DEPENDS: M-CONFIG, M-LOGGER
//   LINKS: M-DB, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   DbClient - Typed Drizzle database and pg Pool handles used by repository modules.
//   DbConnectionError - Typed database bootstrap error with DB_CONNECTION_ERROR code.
//   createDb - Validate configuration, initialize pg + Drizzle, and verify database connectivity.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Migrated M-DB runtime integration from Bun SQL to pg Pool + Drizzle node-postgres with fail-fast probe.
// END_CHANGE_SUMMARY

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";

type DbConnectionErrorDetails = {
  target?: string;
  cause?: string;
  field?: string;
};

export type DbClient = {
  db: NodePgDatabase;
  pool: Pool;
};

export class DbConnectionError extends Error {
  public readonly code = "DB_CONNECTION_ERROR" as const;
  public readonly details?: DbConnectionErrorDetails;

  public constructor(message: string, details?: DbConnectionErrorDetails) {
    super(message);
    this.name = "DbConnectionError";
    this.details = details;
  }
}

// START_CONTRACT: redactDatabaseCredentials
//   PURPOSE: Remove credential-like fragments from error text before logging or throwing.
//   INPUTS: { text: string - Untrusted runtime error text }
//   OUTPUTS: { string - Redacted diagnostic text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-DB]
// END_CONTRACT: redactDatabaseCredentials
function redactDatabaseCredentials(text: string): string {
  // START_BLOCK_REDACT_CREDENTIALS_FROM_DIAGNOSTIC_TEXT_M_DB_001
  const normalizedText = text.trim();
  if (!normalizedText) {
    return "unknown";
  }

  return normalizedText
    .replace(/(postgres(?:ql)?:\/\/)([^@\s/]+):[^@\s/]*@/gi, "$1<redacted>@")
    .replace(/(postgres(?:ql)?:\/\/)([^@\s/]+)@/gi, "$1<redacted>@")
    .replace(/([?&](?:password|pass|pwd|token)=)[^&\s]+/gi, "$1<redacted>");
  // END_BLOCK_REDACT_CREDENTIALS_FROM_DIAGNOSTIC_TEXT_M_DB_001
}

// START_CONTRACT: buildSafeDatabaseTarget
//   PURPOSE: Build a credential-safe database target description for logs and errors.
//   INPUTS: { databaseUrl: URL - Parsed DATABASE_URL value }
//   OUTPUTS: { string - Sanitized endpoint descriptor without credentials }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-DB]
// END_CONTRACT: buildSafeDatabaseTarget
function buildSafeDatabaseTarget(databaseUrl: URL): string {
  // START_BLOCK_BUILD_CREDENTIAL_SAFE_DATABASE_TARGET_M_DB_002
  const host = databaseUrl.hostname.trim() ? databaseUrl.hostname : "localhost";
  const portSegment = databaseUrl.port ? `:${databaseUrl.port}` : "";
  const databasePath = databaseUrl.pathname && databaseUrl.pathname !== "/" ? databaseUrl.pathname : "/(default)";
  return `${databaseUrl.protocol}//${host}${portSegment}${databasePath}`;
  // END_BLOCK_BUILD_CREDENTIAL_SAFE_DATABASE_TARGET_M_DB_002
}

// START_CONTRACT: parseDatabaseUrl
//   PURPOSE: Validate DATABASE_URL presence, URL shape, and accepted Postgres scheme.
//   INPUTS: { databaseUrl: string - Runtime DATABASE_URL string from AppConfig }
//   OUTPUTS: { URL - Parsed and validated URL instance }
//   SIDE_EFFECTS: [Throws DbConnectionError for invalid inputs]
//   LINKS: [M-DB, M-CONFIG]
// END_CONTRACT: parseDatabaseUrl
function parseDatabaseUrl(databaseUrl: string): URL {
  // START_BLOCK_VALIDATE_DATABASE_URL_INPUT_M_DB_003
  const normalizedDatabaseUrl = databaseUrl.trim();
  if (!normalizedDatabaseUrl) {
    throw new DbConnectionError("DATABASE_URL is required for database initialization.", {
      field: "databaseUrl",
    });
  }
  // END_BLOCK_VALIDATE_DATABASE_URL_INPUT_M_DB_003

  // START_BLOCK_PARSE_AND_VALIDATE_DATABASE_URL_SCHEME_M_DB_004
  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(normalizedDatabaseUrl);
  } catch {
    throw new DbConnectionError("DATABASE_URL must be a parseable URL.", {
      field: "databaseUrl",
    });
  }

  const protocol = parsedDatabaseUrl.protocol;
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    throw new DbConnectionError("DATABASE_URL must use postgres:// or postgresql:// scheme.", {
      field: "databaseUrl",
    });
  }

  return parsedDatabaseUrl;
  // END_BLOCK_PARSE_AND_VALIDATE_DATABASE_URL_SCHEME_M_DB_004
}

// START_CONTRACT: toDbConnectionError
//   PURPOSE: Normalize unknown failures into DbConnectionError with credential-safe details.
//   INPUTS: { error: unknown - Caught runtime failure, safeTarget: string - Sanitized database target description }
//   OUTPUTS: { DbConnectionError - Typed DB connection error for callers }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-DB]
// END_CONTRACT: toDbConnectionError
function toDbConnectionError(error: unknown, safeTarget: string): DbConnectionError {
  // START_BLOCK_NORMALIZE_UNKNOWN_DB_ERRORS_M_DB_005
  if (error instanceof DbConnectionError) {
    return error;
  }

  const rawCause = error instanceof Error ? error.message : String(error);
  const cause = redactDatabaseCredentials(rawCause);

  return new DbConnectionError("Failed to establish database connection.", {
    target: safeTarget,
    cause,
  });
  // END_BLOCK_NORMALIZE_UNKNOWN_DB_ERRORS_M_DB_005
}

// START_CONTRACT: createDb
//   PURPOSE: Create a pg-backed Drizzle PostgreSQL client from AppConfig and verify connectivity with a lightweight probe.
//   INPUTS: { config: AppConfig - Runtime app configuration, logger: Logger - Module logger }
//   OUTPUTS: { Promise<DbClient> - Database client wrapper with Drizzle and pool handles }
//   SIDE_EFFECTS: [Opens DB connection pool, runs connectivity probe query, and emits structured logs]
//   LINKS: [M-DB, M-CONFIG, M-LOGGER]
// END_CONTRACT: createDb
export async function createDb(config: AppConfig, logger: Logger): Promise<DbClient> {
  let safeTarget = "postgresql://<unresolved>";
  let pool: Pool | null = null;

  try {
    // START_BLOCK_VALIDATE_CONFIG_AND_PREPARE_DATABASE_TARGET_M_DB_006
    const parsedDatabaseUrl = parseDatabaseUrl(config.databaseUrl);
    safeTarget = buildSafeDatabaseTarget(parsedDatabaseUrl);

    logger.info(
      "Initializing PostgreSQL client from runtime configuration.",
      "createDb",
      "VALIDATE_CONFIG_AND_PREPARE_DATABASE_TARGET",
      { target: safeTarget },
    );
    // END_BLOCK_VALIDATE_CONFIG_AND_PREPARE_DATABASE_TARGET_M_DB_006

    // START_BLOCK_INITIALIZE_PG_POOL_AND_DRIZZLE_CLIENT_M_DB_007
    pool = new Pool({
      connectionString: parsedDatabaseUrl.toString(),
    });
    const db = drizzle(pool);
    // END_BLOCK_INITIALIZE_PG_POOL_AND_DRIZZLE_CLIENT_M_DB_007

    // START_BLOCK_RUN_CONNECTIVITY_PROBE_QUERY_M_DB_008
    await db.execute(sql`select 1`);
    logger.info("Database connectivity probe succeeded.", "createDb", "RUN_CONNECTIVITY_PROBE_QUERY", {
      target: safeTarget,
    });
    return { db, pool };
    // END_BLOCK_RUN_CONNECTIVITY_PROBE_QUERY_M_DB_008
  } catch (error: unknown) {
    // START_BLOCK_LOG_AND_THROW_CONNECTION_FAILURE_M_DB_009
    if (pool !== null) {
      try {
        await pool.end();
      } catch {
        // Ignore pool shutdown failures while propagating the original bootstrap error.
      }
    }

    const dbError = toDbConnectionError(error, safeTarget);
    logger.error("Database bootstrap failed.", "createDb", "LOG_AND_THROW_CONNECTION_FAILURE", {
      target: dbError.details?.target ?? safeTarget,
      cause: dbError.details?.cause ?? dbError.message,
      code: dbError.code,
    });
    throw dbError;
    // END_BLOCK_LOG_AND_THROW_CONNECTION_FAILURE_M_DB_009
  }
}
