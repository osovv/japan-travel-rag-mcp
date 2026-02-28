// FILE: src/usage/tracker.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify M-USAGE-TRACKER contract: fire-and-forget recording, stats query shape, and factory return type.
//   SCOPE: Unit test createUsageTracker, recordToolCall (never-throw guarantee), and getUserStats (correct shape) using mocked DB.
//   DEPENDS: M-USAGE-TRACKER, M-LOGGER
//   LINKS: M-USAGE-TRACKER, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Provide logger fixture that keeps tests focused on behavior.
//   createMockDb - Build a minimal mock NodePgDatabase that captures operations.
//   UsageTrackerTests - Contract tests for factory, recording, and stats query.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation from development plan for M-USAGE-TRACKER tests.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "../logger/index";
import { createUsageTracker, UsageTrackerError, type UsageTracker, type UserUsageStats } from "./tracker";

// START_CONTRACT: createNoopLogger
//   PURPOSE: Provide a logger fixture that satisfies Logger interface without side effects.
//   INPUTS: { none }
//   OUTPUTS: { Logger - No-op logger implementation }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_BUILD_NOOP_LOGGER_FIXTURE_M_USAGE_TRACKER_TEST_001
  const noop = (): void => {};
  let loggerRef: Logger;
  loggerRef = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => loggerRef,
  };
  return loggerRef;
  // END_BLOCK_BUILD_NOOP_LOGGER_FIXTURE_M_USAGE_TRACKER_TEST_001
}

// START_CONTRACT: createMockDb
//   PURPOSE: Build a minimal mock NodePgDatabase that supports execute, insert, and select chains.
//   INPUTS: { overrides: optional behavior overrides for insert and select }
//   OUTPUTS: { NodePgDatabase-compatible mock }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-USAGE-TRACKER, M-DB]
// END_CONTRACT: createMockDb
function createMockDb(overrides?: {
  executeError?: Error;
  insertError?: Error;
  selectRows?: Array<{ toolName: string; callCount: number; lastCalledAt: Date | null }>;
  selectError?: Error;
}): NodePgDatabase {
  // START_BLOCK_BUILD_MOCK_DB_FIXTURE_M_USAGE_TRACKER_TEST_002
  const insertChain = {
    values: () => ({
      onConflictDoUpdate: () => {
        if (overrides?.insertError) {
          return Promise.reject(overrides.insertError);
        }
        return Promise.resolve();
      },
    }),
  };

  const selectChain = {
    from: () => ({
      where: () => {
        if (overrides?.selectError) {
          return Promise.reject(overrides.selectError);
        }
        return Promise.resolve(overrides?.selectRows ?? []);
      },
    }),
  };

  const mock = {
    execute: () => {
      if (overrides?.executeError) {
        return Promise.reject(overrides.executeError);
      }
      return Promise.resolve({});
    },
    insert: () => insertChain,
    select: () => selectChain,
  } as unknown as NodePgDatabase;

  return mock;
  // END_BLOCK_BUILD_MOCK_DB_FIXTURE_M_USAGE_TRACKER_TEST_002
}

describe("M-USAGE-TRACKER", () => {
  describe("createUsageTracker", () => {
    it("returns a UsageTracker with recordToolCall and getUserStats methods", async () => {
      // START_BLOCK_VERIFY_FACTORY_RETURN_SHAPE_M_USAGE_TRACKER_TEST_003
      const db = createMockDb();
      const logger = createNoopLogger();

      const tracker = await createUsageTracker({ db, logger });

      expect(tracker).toBeDefined();
      expect(typeof tracker.recordToolCall).toBe("function");
      expect(typeof tracker.getUserStats).toBe("function");
      // END_BLOCK_VERIFY_FACTORY_RETURN_SHAPE_M_USAGE_TRACKER_TEST_003
    });

    it("throws when schema bootstrap fails", async () => {
      // START_BLOCK_VERIFY_BOOTSTRAP_FAILURE_PROPAGATION_M_USAGE_TRACKER_TEST_004
      const db = createMockDb({ executeError: new Error("connection refused") });
      const logger = createNoopLogger();

      let thrown: unknown;
      try {
        await createUsageTracker({ db, logger });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(UsageTrackerError);
      expect((thrown as UsageTrackerError).message).toBe("Schema bootstrap failed: connection refused");
      // END_BLOCK_VERIFY_BOOTSTRAP_FAILURE_PROPAGATION_M_USAGE_TRACKER_TEST_004
    });
  });

  describe("recordToolCall", () => {
    it("never throws even when the database insert fails", async () => {
      // START_BLOCK_VERIFY_FIRE_AND_FORGET_NEVER_THROWS_M_USAGE_TRACKER_TEST_005
      const db = createMockDb({ insertError: new Error("disk full") });
      const logger = createNoopLogger();

      const tracker = await createUsageTracker({ db, logger });

      // recordToolCall must not throw — it is fire-and-forget
      expect(() => {
        tracker.recordToolCall("user-001", "search_messages");
      }).not.toThrow();

      // Allow the internal promise to settle
      await new Promise((resolve) => setTimeout(resolve, 50));
      // END_BLOCK_VERIFY_FIRE_AND_FORGET_NEVER_THROWS_M_USAGE_TRACKER_TEST_005
    });

    it("never throws even when called with empty arguments", async () => {
      // START_BLOCK_VERIFY_FIRE_AND_FORGET_EMPTY_ARGS_M_USAGE_TRACKER_TEST_006
      const db = createMockDb();
      const logger = createNoopLogger();

      const tracker = await createUsageTracker({ db, logger });

      expect(() => {
        tracker.recordToolCall("", "");
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 50));
      // END_BLOCK_VERIFY_FIRE_AND_FORGET_EMPTY_ARGS_M_USAGE_TRACKER_TEST_006
    });

    it("completes successfully when the database insert succeeds", async () => {
      // START_BLOCK_VERIFY_SUCCESSFUL_RECORDING_M_USAGE_TRACKER_TEST_007
      const db = createMockDb();
      const logger = createNoopLogger();

      const tracker = await createUsageTracker({ db, logger });

      expect(() => {
        tracker.recordToolCall("user-002", "get_message_context");
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 50));
      // END_BLOCK_VERIFY_SUCCESSFUL_RECORDING_M_USAGE_TRACKER_TEST_007
    });
  });

  describe("getUserStats", () => {
    it("returns correct structure with tools and total", async () => {
      // START_BLOCK_VERIFY_STATS_RESPONSE_SHAPE_M_USAGE_TRACKER_TEST_008
      const lastCalled = new Date("2026-02-28T10:00:00Z");
      const db = createMockDb({
        selectRows: [
          { toolName: "search_messages", callCount: 5, lastCalledAt: lastCalled },
          { toolName: "get_message_context", callCount: 3, lastCalledAt: null },
        ],
      });
      const logger = createNoopLogger();

      const tracker = await createUsageTracker({ db, logger });
      const stats: UserUsageStats = await tracker.getUserStats("user-001");

      expect(stats.tools).toHaveLength(2);
      expect(stats.tools[0]).toEqual({
        toolName: "search_messages",
        callCount: 5,
        lastCalledAt: lastCalled,
      });
      expect(stats.tools[1]).toEqual({
        toolName: "get_message_context",
        callCount: 3,
        lastCalledAt: null,
      });
      expect(stats.total).toBe(8);
      // END_BLOCK_VERIFY_STATS_RESPONSE_SHAPE_M_USAGE_TRACKER_TEST_008
    });

    it("returns empty tools array and zero total for unknown user", async () => {
      // START_BLOCK_VERIFY_EMPTY_STATS_FOR_UNKNOWN_USER_M_USAGE_TRACKER_TEST_009
      const db = createMockDb({ selectRows: [] });
      const logger = createNoopLogger();

      const tracker = await createUsageTracker({ db, logger });
      const stats = await tracker.getUserStats("nonexistent-user");

      expect(stats.tools).toEqual([]);
      expect(stats.total).toBe(0);
      // END_BLOCK_VERIFY_EMPTY_STATS_FOR_UNKNOWN_USER_M_USAGE_TRACKER_TEST_009
    });

    it("throws when the database query fails", async () => {
      // START_BLOCK_VERIFY_STATS_QUERY_CAN_THROW_M_USAGE_TRACKER_TEST_010
      const db = createMockDb({ selectError: new Error("query timeout") });
      const logger = createNoopLogger();

      const tracker = await createUsageTracker({ db, logger });

      let thrown: unknown;
      try {
        await tracker.getUserStats("user-001");
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(UsageTrackerError);
      expect((thrown as UsageTrackerError).message).toBe("Stats query failed for user user-001: query timeout");
      // END_BLOCK_VERIFY_STATS_QUERY_CAN_THROW_M_USAGE_TRACKER_TEST_010
    });
  });
});
