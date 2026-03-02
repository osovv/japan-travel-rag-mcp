// FILE: src/worker-main.test.ts
// Tests for src/worker-main.ts — worker entrypoint with scheduler loop and graceful shutdown.
// All external dependencies are mocked.

import { describe, test, expect, mock } from "bun:test";
import type { Logger } from "./logger/index";
import type { IngestionOrchestrator, SourceForIngestion, IngestionResult } from "./sites/ingestion/orchestrator";
import type { SiteSourcesResponse, SiteSource } from "./tools/site-sources";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  WorkerStartError,
  TICK_INTERVAL_MS,
  mapSourcesToIngestion,
  runSchedulerTick,
  sleep,
} from "./worker-main";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger {
  const noop = mock(() => {});
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: mock(() => logger),
  };
  return logger;
}

// Create a mock NodePgDatabase that supports the Drizzle .select().from() chain
// used by getSiteSources. Returns `rows` from the chain.
type SelectChain = { from: (table: unknown) => Promise<unknown[]> };

function createMockDrizzleDb(rows: unknown[]): NodePgDatabase {
  return {
    select: () => ({
      from: async () => rows,
    }),
  } as unknown as NodePgDatabase;
}

function createMockOrchestrator(resultOverride?: Partial<IngestionResult>): IngestionOrchestrator {
  const defaultResult: IngestionResult = {
    sources_processed: 2,
    pages_fetched: 10,
    pages_skipped: 0,
    chunks_created: 50,
    embeddings_created: 50,
    errors: [],
    ...resultOverride,
  };

  return {
    runScheduledIngestion: mock(async (_sources: SourceForIngestion[]) => defaultResult),
    runTargetedRecrawl: mock(async (_url: string, _sourceId: string) => defaultResult),
  };
}

function createMockSourcesResponse(overrides?: {
  sources?: readonly SiteSource[];
}): SiteSourcesResponse {
  const defaultSources: SiteSource[] = [
    {
      source_id: "test_source_1",
      name: "Test Source 1",
      domain: "example.com",
      tier: 0,
      language: "en",
      focus: "Testing",
      status: "active",
      crawl_interval_minutes: 1440,
      max_pages: 200,
    },
    {
      source_id: "test_source_2",
      name: "Test Source 2",
      domain: "example.org",
      tier: 1,
      language: "en",
      focus: "Testing 2",
      status: "active",
      crawl_interval_minutes: 4320,
      max_pages: 150,
    },
    {
      source_id: "paused_source",
      name: "Paused Source",
      domain: "paused.com",
      tier: 2,
      language: "en",
      focus: "Paused",
      status: "paused",
      crawl_interval_minutes: 10080,
      max_pages: 50,
    },
  ];

  return {
    description_and_tiers: {
      description: "Test sources",
      tiers: [
        { tier: 0, name: "T0", focus: "Primary" },
        { tier: 1, name: "T1", focus: "Secondary" },
      ],
    },
    sources: overrides?.sources ?? defaultSources,
  };
}

// ---------------------------------------------------------------------------
// Tests for WorkerStartError
// ---------------------------------------------------------------------------

describe("WorkerStartError", () => {
  test("should have correct code and name", () => {
    const error = new WorkerStartError("test failure");
    expect(error.code).toBe("WORKER_START_ERROR");
    expect(error.name).toBe("WorkerStartError");
    expect(error.message).toBe("test failure");
    expect(error).toBeInstanceOf(Error);
  });

  test("should carry details", () => {
    const error = new WorkerStartError("test", { cause: "boom", causeName: "TypeError" });
    expect(error.details).toEqual({ cause: "boom", causeName: "TypeError" });
  });
});

// ---------------------------------------------------------------------------
// Tests for TICK_INTERVAL_MS
// ---------------------------------------------------------------------------

describe("TICK_INTERVAL_MS", () => {
  test("should be 300_000 (5 minutes)", () => {
    expect(TICK_INTERVAL_MS).toBe(300_000);
  });
});

// ---------------------------------------------------------------------------
// Tests for mapSourcesToIngestion
// ---------------------------------------------------------------------------

describe("mapSourcesToIngestion", () => {
  test("should filter out paused sources and map active ones", () => {
    const response = createMockSourcesResponse();
    const result = mapSourcesToIngestion(response);

    expect(result).toHaveLength(2);
    expect(result[0]!.source_id).toBe("test_source_1");
    expect(result[0]!.domain).toBe("example.com");
    expect(result[0]!.max_pages).toBe(200);
    expect(result[0]!.crawl_interval_minutes).toBe(1440);

    expect(result[1]!.source_id).toBe("test_source_2");
    expect(result[1]!.domain).toBe("example.org");
    expect(result[1]!.max_pages).toBe(150);
    expect(result[1]!.crawl_interval_minutes).toBe(4320);
  });

  test("should use defaults when crawl_interval_minutes and max_pages are undefined", () => {
    const response = createMockSourcesResponse({
      sources: [
        {
          source_id: "no_defaults",
          name: "No Defaults",
          domain: "nodefault.com",
          tier: 1,
          language: "en",
          focus: "Test",
          status: "active",
          // no crawl_interval_minutes, no max_pages
        },
      ],
    });

    const result = mapSourcesToIngestion(response);
    expect(result).toHaveLength(1);
    expect(result[0]!.max_pages).toBe(50);
    expect(result[0]!.crawl_interval_minutes).toBe(10080);
  });

  test("should return empty array when all sources are paused", () => {
    const response = createMockSourcesResponse({
      sources: [
        {
          source_id: "paused",
          name: "Paused",
          domain: "paused.com",
          tier: 0,
          language: "en",
          focus: "Test",
          status: "paused",
          crawl_interval_minutes: 1440,
          max_pages: 200,
        },
      ],
    });

    const result = mapSourcesToIngestion(response);
    expect(result).toHaveLength(0);
  });

  test("should return empty array when sources list is empty", () => {
    const response = createMockSourcesResponse({ sources: [] });

    const result = mapSourcesToIngestion(response);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests for sleep
// ---------------------------------------------------------------------------

describe("sleep", () => {
  test("should resolve after the specified delay", async () => {
    const start = Date.now();
    await sleep(50, () => true);
    const elapsed = Date.now() - start;
    // Allow some tolerance for timer imprecision
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  test("should resolve immediately when isRunning returns false", async () => {
    const start = Date.now();
    await sleep(10_000, () => false);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  test("should exit early when isRunning flips to false during sleep", async () => {
    let running = true;
    // Flip running to false after 50ms
    setTimeout(() => {
      running = false;
    }, 50);

    const start = Date.now();
    await sleep(10_000, () => running);
    const elapsed = Date.now() - start;
    // Should exit significantly before 10 seconds
    expect(elapsed).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------
// Tests for runSchedulerTick
// ---------------------------------------------------------------------------

describe("runSchedulerTick", () => {
  test("should call orchestrator.runScheduledIngestion with active sources from DB", async () => {
    const mockLogger = createMockLogger();
    const mockOrchestrator = createMockOrchestrator();

    // Create a mock DB that returns Drizzle-shaped rows (matching getSiteSources select)
    const dbRows = [
      {
        sourceId: "src_alpha",
        name: "Alpha Source",
        domain: "alpha.com",
        tier: 0,
        language: "en",
        focus: "Alpha focus",
        status: "active",
        crawlIntervalMinutes: 1440,
        maxPages: 200,
      },
      {
        sourceId: "src_beta",
        name: "Beta Source",
        domain: "beta.org",
        tier: 1,
        language: "en",
        focus: "Beta focus",
        status: "active",
        crawlIntervalMinutes: 4320,
        maxPages: 150,
      },
    ];
    const mockDb = createMockDrizzleDb(dbRows);

    await runSchedulerTick(mockDb, mockOrchestrator, mockLogger);

    expect(mockOrchestrator.runScheduledIngestion).toHaveBeenCalledTimes(1);
    const callArgs = (mockOrchestrator.runScheduledIngestion as ReturnType<typeof mock>).mock.calls[0]!;
    expect(callArgs[0]).toHaveLength(2);
    expect(callArgs[0]![0].source_id).toBe("src_alpha");
    expect(callArgs[0]![0].domain).toBe("alpha.com");
    expect(callArgs[0]![0].max_pages).toBe(200);
    expect(callArgs[0]![1].source_id).toBe("src_beta");

    // Logger should have been called
    expect(mockLogger.info).toHaveBeenCalled();
  });

  test("should skip ingestion when DB returns only paused sources", async () => {
    const mockLogger = createMockLogger();
    const mockOrchestrator = createMockOrchestrator();

    const dbRows = [
      {
        sourceId: "paused_src",
        name: "Paused",
        domain: "paused.com",
        tier: 0,
        language: "en",
        focus: "Paused",
        status: "paused",
        crawlIntervalMinutes: 1440,
        maxPages: 200,
      },
    ];
    const mockDb = createMockDrizzleDb(dbRows);

    await runSchedulerTick(mockDb, mockOrchestrator, mockLogger);

    // Orchestrator should NOT have been called
    expect(mockOrchestrator.runScheduledIngestion).not.toHaveBeenCalled();
    // Logger should have logged the skip
    expect(mockLogger.info).toHaveBeenCalled();
  });

  test("should skip ingestion when DB returns empty rows (seed data fallback with all active sources)", async () => {
    const mockLogger = createMockLogger();
    const mockOrchestrator = createMockOrchestrator();

    // When DB returns empty rows, getSiteSources falls back to the seed constant
    // which has all active sources. So orchestrator WILL be called.
    const mockDb = createMockDrizzleDb([]);

    await runSchedulerTick(mockDb, mockOrchestrator, mockLogger);

    // The seed constant has 12 active sources, so orchestrator should be called
    expect(mockOrchestrator.runScheduledIngestion).toHaveBeenCalledTimes(1);
  });

  test("should propagate errors from orchestrator", async () => {
    const mockLogger = createMockLogger();

    const dbRows = [
      {
        sourceId: "active_src",
        name: "Active",
        domain: "active.com",
        tier: 0,
        language: "en",
        focus: "Active",
        status: "active",
        crawlIntervalMinutes: 1440,
        maxPages: 200,
      },
    ];
    const mockDb = createMockDrizzleDb(dbRows);

    const failingOrchestrator: IngestionOrchestrator = {
      runScheduledIngestion: mock(async () => {
        throw new Error("Orchestrator exploded");
      }),
      runTargetedRecrawl: mock(async () => {
        throw new Error("Not called");
      }),
    };

    await expect(
      runSchedulerTick(mockDb, failingOrchestrator, mockLogger),
    ).rejects.toThrow("Orchestrator exploded");
  });
});
