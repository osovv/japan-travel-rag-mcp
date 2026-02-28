// FILE: src/usage/tracker.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Track per-user MCP tool call counts in PostgreSQL and expose query interface for portal display.
//   SCOPE: Define Drizzle schema for usage_counters table, provide atomic UPSERT recording with fire-and-forget semantics, and expose per-user stats query.
//   DEPENDS: M-DB, M-LOGGER
//   LINKS: M-USAGE-TRACKER, M-DB, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   usageCountersTable - Drizzle pg-core schema: usage_counters(user_id, tool_name, call_count, last_called_at) with composite PK.
//   UsageTracker - Usage tracking interface for tool call recording and stats queries.
//   UserUsageStats - Per-user usage statistics payload for portal rendering.
//   UsageTrackerError - Typed usage tracker error with USAGE_TRACKER_ERROR code.
//   createUsageTracker - Build usage tracker backed by Drizzle PostgreSQL with auto-schema bootstrap.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation from development plan for M-USAGE-TRACKER.
// END_CHANGE_SUMMARY

import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { Logger } from "../logger/index";

// START_BLOCK_DEFINE_DRIZZLE_SCHEMA_M_USAGE_TRACKER_001
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
// END_BLOCK_DEFINE_DRIZZLE_SCHEMA_M_USAGE_TRACKER_001

// START_BLOCK_DEFINE_TYPES_M_USAGE_TRACKER_002
export type UserUsageStats = {
  tools: { toolName: string; callCount: number; lastCalledAt: Date | null }[];
  total: number;
};

export type UsageTracker = {
  recordToolCall(userId: string, toolName: string): void;
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
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS usage_counters (
      user_id    TEXT NOT NULL,
      tool_name  TEXT NOT NULL,
      call_count INTEGER NOT NULL DEFAULT 0,
      last_called_at TIMESTAMPTZ,
      PRIMARY KEY (user_id, tool_name)
    )
  `);

  logger.info(
    "usage_counters table bootstrap complete.",
    "bootstrapSchema",
    "BOOTSTRAP_USAGE_COUNTERS_TABLE",
  );
  // END_BLOCK_BOOTSTRAP_USAGE_COUNTERS_TABLE_M_USAGE_TRACKER_004
}

// START_CONTRACT: recordToolCallImpl
//   PURPOSE: Increment per-user per-tool counter via UPSERT; fire-and-forget with warning on failure.
//   INPUTS: { db: NodePgDatabase, logger: Logger, userId: string, toolName: string }
//   OUTPUTS: { void - Fire-and-forget; never throws to callers }
//   SIDE_EFFECTS: [Writes to usage_counters table, logs warning on failure]
//   LINKS: [M-USAGE-TRACKER, M-DB]
// END_CONTRACT: recordToolCallImpl
function recordToolCallImpl(
  db: NodePgDatabase,
  logger: Logger,
  userId: string,
  toolName: string,
): void {
  // START_BLOCK_FIRE_AND_FORGET_UPSERT_M_USAGE_TRACKER_005
  const operation = db
    .insert(usageCountersTable)
    .values({
      userId,
      toolName,
      callCount: 1,
      lastCalledAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [usageCountersTable.userId, usageCountersTable.toolName],
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
        { userId, toolName },
      );
    })
    .catch((error: unknown) => {
      const cause = error instanceof Error ? error.message : String(error);
      logger.warn(
        "Failed to record tool call; continuing without persistence.",
        "recordToolCall",
        "FIRE_AND_FORGET_UPSERT",
        { userId, toolName, cause },
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
    recordToolCall(userId: string, toolName: string): void {
      recordToolCallImpl(db, logger, userId, toolName);
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
