// FILE: src/usage/tracker.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Track per-user per-country MCP tool call counts in PostgreSQL and expose query interface for portal display.
//   SCOPE: Define Drizzle schema for usage_counters table, provide atomic UPSERT recording with fire-and-forget semantics, and expose per-user stats query.
//   DEPENDS: M-DB, M-LOGGER
//   LINKS: M-USAGE-TRACKER, M-DB, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   usageCountersTable - Drizzle pg-core schema: usage_counters(user_id, tool_name, country_code, call_count, last_called_at) with composite PK.
//   UsageTracker - Usage tracking interface for tool call recording (with countryCode) and stats queries.
//   UserUsageStats - Per-user usage statistics payload for portal rendering.
//   UsageTrackerError - Typed usage tracker error with USAGE_TRACKER_ERROR code.
//   createUsageTracker - Build usage tracker backed by Drizzle PostgreSQL with auto-schema bootstrap.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Added countryCode parameter to recordToolCall and updated bootstrap schema with country_code column and composite PK migration.
// END_CHANGE_SUMMARY

import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "../logger/index";
import { usageCountersTable } from "../db/schema";

export { usageCountersTable };

// START_BLOCK_DEFINE_TYPES_M_USAGE_TRACKER_002
export type UserUsageStats = {
  tools: { toolName: string; callCount: number; lastCalledAt: Date | null }[];
  total: number;
};

export type UsageTracker = {
  recordToolCall(userId: string, toolName: string, countryCode: string): void;
  getUserStats(userId: string): Promise<UserUsageStats>;
};
// END_BLOCK_DEFINE_TYPES_M_USAGE_TRACKER_002

// START_BLOCK_DEFINE_ERROR_CLASS_M_USAGE_TRACKER_003
export class UsageTrackerError extends Error {
  public readonly code = "USAGE_TRACKER_ERROR" as const;

  public constructor(message: string) {
    super(message);
    this.name = "UsageTrackerError";
  }
}
// END_BLOCK_DEFINE_ERROR_CLASS_M_USAGE_TRACKER_003

// START_CONTRACT: bootstrapSchema
//   PURPOSE: Ensure the usage_counters table exists using raw SQL CREATE TABLE IF NOT EXISTS.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, logger: Logger - Module logger }
//   OUTPUTS: { Promise<void> }
//   SIDE_EFFECTS: [Creates usage_counters table if not present, logs bootstrap status]
//   LINKS: [M-USAGE-TRACKER, M-DB]
// END_CONTRACT: bootstrapSchema
async function bootstrapSchema(db: NodePgDatabase, logger: Logger): Promise<void> {
  // START_BLOCK_BOOTSTRAP_USAGE_COUNTERS_TABLE_M_USAGE_TRACKER_004
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS usage_counters (
        user_id    TEXT NOT NULL,
        tool_name  TEXT NOT NULL,
        country_code TEXT NOT NULL DEFAULT 'jp',
        call_count INTEGER NOT NULL DEFAULT 0,
        last_called_at TIMESTAMPTZ,
        PRIMARY KEY (user_id, tool_name, country_code)
      )
    `);

    // Migrate existing tables: add country_code column and recreate PK if needed.
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'usage_counters' AND column_name = 'country_code'
        ) THEN
          ALTER TABLE usage_counters ADD COLUMN country_code TEXT NOT NULL DEFAULT 'jp';
          ALTER TABLE usage_counters DROP CONSTRAINT IF EXISTS usage_counters_pkey;
          ALTER TABLE usage_counters ADD PRIMARY KEY (user_id, tool_name, country_code);
        END IF;
      END $$
    `);

    logger.info(
      "usage_counters table bootstrap complete.",
      "bootstrapSchema",
      "BOOTSTRAP_USAGE_COUNTERS_TABLE",
    );
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new UsageTrackerError(`Schema bootstrap failed: ${cause}`);
  }
  // END_BLOCK_BOOTSTRAP_USAGE_COUNTERS_TABLE_M_USAGE_TRACKER_004
}

// START_CONTRACT: recordToolCallImpl
//   PURPOSE: Increment per-user per-tool per-country counter via UPSERT; fire-and-forget with warning on failure.
//   INPUTS: { db: NodePgDatabase, logger: Logger, userId: string, toolName: string, countryCode: string }
//   OUTPUTS: { void - Fire-and-forget; never throws to callers }
//   SIDE_EFFECTS: [Writes to usage_counters table, logs warning on failure]
//   LINKS: [M-USAGE-TRACKER, M-DB]
// END_CONTRACT: recordToolCallImpl
function recordToolCallImpl(
  db: NodePgDatabase,
  logger: Logger,
  userId: string,
  toolName: string,
  countryCode: string,
): void {
  // START_BLOCK_FIRE_AND_FORGET_UPSERT_M_USAGE_TRACKER_005
  const operation = db
    .insert(usageCountersTable)
    .values({
      userId,
      toolName,
      countryCode,
      callCount: 1,
      lastCalledAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [usageCountersTable.userId, usageCountersTable.toolName, usageCountersTable.countryCode],
      set: {
        callCount: sql`${usageCountersTable.callCount} + 1`,
        lastCalledAt: new Date(),
      },
    })
    .then(() => {
      logger.debug(
        "Tool call recorded.",
        "recordToolCall",
        "FIRE_AND_FORGET_UPSERT",
        { userId, toolName, countryCode },
      );
    })
    .catch((error: unknown) => {
      const cause = error instanceof Error ? error.message : String(error);
      logger.warn(
        "Failed to record tool call; continuing without persistence.",
        "recordToolCall",
        "FIRE_AND_FORGET_UPSERT",
        { userId, toolName, countryCode, cause },
      );
    });

  // Suppress unhandled rejection for the fire-and-forget promise.
  void operation;
  // END_BLOCK_FIRE_AND_FORGET_UPSERT_M_USAGE_TRACKER_005
}

// START_CONTRACT: getUserStatsImpl
//   PURPOSE: Query all per-tool counters and total for a given user ID.
//   INPUTS: { db: NodePgDatabase, userId: string }
//   OUTPUTS: { Promise<UserUsageStats> - Per-user usage statistics payload }
//   SIDE_EFFECTS: [Reads from usage_counters table; CAN throw on database failure]
//   LINKS: [M-USAGE-TRACKER, M-DB]
// END_CONTRACT: getUserStatsImpl
async function getUserStatsImpl(db: NodePgDatabase, userId: string): Promise<UserUsageStats> {
  // START_BLOCK_QUERY_USER_STATS_M_USAGE_TRACKER_006
  try {
    const rows = await db
      .select({
        toolName: usageCountersTable.toolName,
        callCount: usageCountersTable.callCount,
        lastCalledAt: usageCountersTable.lastCalledAt,
      })
      .from(usageCountersTable)
      .where(eq(usageCountersTable.userId, userId));

    const tools = rows.map((row) => ({
      toolName: row.toolName,
      callCount: row.callCount,
      lastCalledAt: row.lastCalledAt,
    }));

    const total = tools.reduce((sum, tool) => sum + tool.callCount, 0);

    return { tools, total };
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new UsageTrackerError(`Stats query failed for user ${userId}: ${cause}`);
  }
  // END_BLOCK_QUERY_USER_STATS_M_USAGE_TRACKER_006
}

// START_CONTRACT: createUsageTracker
//   PURPOSE: Build usage tracker backed by Drizzle PostgreSQL with auto-schema bootstrap.
//   INPUTS: { deps: { db: NodePgDatabase, logger: Logger } }
//   OUTPUTS: { Promise<UsageTracker> - Usage tracking interface }
//   SIDE_EFFECTS: [Bootstraps usage_counters table if not present]
//   LINKS: [M-USAGE-TRACKER, M-DB, M-LOGGER]
// END_CONTRACT: createUsageTracker
export async function createUsageTracker(deps: {
  db: NodePgDatabase;
  logger: Logger;
}): Promise<UsageTracker> {
  // START_BLOCK_BOOTSTRAP_AND_BUILD_TRACKER_M_USAGE_TRACKER_007
  const { db, logger } = deps;

  await bootstrapSchema(db, logger);

  const tracker: UsageTracker = {
    recordToolCall(userId: string, toolName: string, countryCode: string): void {
      recordToolCallImpl(db, logger, userId, toolName, countryCode);
    },

    async getUserStats(userId: string): Promise<UserUsageStats> {
      return getUserStatsImpl(db, userId);
    },
  };

  logger.info(
    "UsageTracker initialized successfully.",
    "createUsageTracker",
    "BOOTSTRAP_AND_BUILD_TRACKER",
  );

  return tracker;
  // END_BLOCK_BOOTSTRAP_AND_BUILD_TRACKER_M_USAGE_TRACKER_007
}
