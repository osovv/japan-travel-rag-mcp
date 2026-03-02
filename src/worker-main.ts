// FILE: src/worker-main.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Bootstrap ingestion dependencies and run a scheduler loop for curated sites ingestion jobs.
//   SCOPE: Load config/logger, initialize database client, bootstrap sites schema, create Spider/Voyage/repository/orchestrator, and run a 5-minute ticker that passes all active sources to the ingestion orchestrator.
//   DEPENDS: M-CONFIG, M-LOGGER, M-DB, M-SITE-SOURCES, M-SPIDER-CLOUD-CLIENT, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-SITES-INGESTION
//   LINKS: M-WORKER-ENTRYPOINT, M-CONFIG, M-LOGGER, M-DB, M-SITE-SOURCES, M-SPIDER-CLOUD-CLIENT, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-SITES-INGESTION
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   WorkerStartError - Typed startup failure error with WORKER_START_ERROR code.
//   TICK_INTERVAL_MS - Scheduler tick interval constant (300_000 ms = 5 minutes).
//   main - Worker entrypoint that bootstraps dependencies, installs shutdown handlers, and runs the scheduler loop.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial implementation of worker entrypoint with scheduler loop and graceful shutdown.
// END_CHANGE_SUMMARY

import type { Pool } from "pg";
import { loadConfig } from "./config/index";
import { createDb } from "./db/index";
import { bootstrapSitesSchema } from "./db/sites-bootstrap";
import { createSpiderCloudClient } from "./integrations/spider-cloud-client";
import { createVoyageProxyClient } from "./integrations/voyage-proxy-client";
import { createLogger } from "./logger/index";
import type { Logger } from "./logger/index";
import { createSitesIndexRepository } from "./sites/search/repository";
import {
  createIngestionOrchestrator,
  type IngestionOrchestrator,
  type SourceForIngestion,
} from "./sites/ingestion/orchestrator";
import { getSiteSources } from "./tools/site-sources";
import type { SiteSourcesResponse } from "./tools/site-sources";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// START_BLOCK_DEFINE_ERROR_CLASS_M_WORKER_ENTRYPOINT_001
export class WorkerStartError extends Error {
  public readonly code = "WORKER_START_ERROR" as const;
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "WorkerStartError";
    this.details = details;
  }
}
// END_BLOCK_DEFINE_ERROR_CLASS_M_WORKER_ENTRYPOINT_001

// START_BLOCK_DEFINE_TICK_INTERVAL_M_WORKER_ENTRYPOINT_002
export const TICK_INTERVAL_MS = 300_000;
// END_BLOCK_DEFINE_TICK_INTERVAL_M_WORKER_ENTRYPOINT_002

type ShutdownTarget = {
  dbPool: Pool | null;
};

type ShutdownReason = "SIGINT" | "SIGTERM" | "STARTUP_FAILURE";

// START_CONTRACT: stopWorker
//   PURPOSE: Close database pool with deterministic logging.
//   INPUTS: { shutdownTarget: ShutdownTarget - Mutable runtime handle, logger: Logger - Worker logger, reason: ShutdownReason - Shutdown trigger label }
//   OUTPUTS: { Promise<void> - Resolves after stop attempts complete }
//   SIDE_EFFECTS: [Closes database pool, mutates shutdownTarget handles to null, emits structured logs]
//   LINKS: [M-WORKER-ENTRYPOINT, M-DB, M-LOGGER]
// END_CONTRACT: stopWorker
async function stopWorker(
  shutdownTarget: ShutdownTarget,
  logger: Logger,
  reason: ShutdownReason,
): Promise<void> {
  // START_BLOCK_CLOSE_DATABASE_POOL_M_WORKER_ENTRYPOINT_003
  const poolToClose = shutdownTarget.dbPool;

  shutdownTarget.dbPool = null;

  if (poolToClose !== null) {
    try {
      await poolToClose.end();
      logger.info(
        "Closed database connection pool.",
        "stopWorker",
        "CLOSE_DATABASE_POOL",
        { reason },
      );
    } catch (error: unknown) {
      logger.error(
        "Failed while closing database connection pool.",
        "stopWorker",
        "CLOSE_DATABASE_POOL",
        {
          reason,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
  // END_BLOCK_CLOSE_DATABASE_POOL_M_WORKER_ENTRYPOINT_003
}

// START_CONTRACT: mapSourcesToIngestion
//   PURPOSE: Filter active sources and map SiteSourcesResponse to SourceForIngestion[].
//   INPUTS: { response: SiteSourcesResponse - DB-backed sources response }
//   OUTPUTS: { SourceForIngestion[] - Sources ready for ingestion }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-WORKER-ENTRYPOINT, M-SITE-SOURCES, M-SITES-INGESTION]
// END_CONTRACT: mapSourcesToIngestion
export function mapSourcesToIngestion(response: SiteSourcesResponse): SourceForIngestion[] {
  // START_BLOCK_MAP_ACTIVE_SOURCES_M_WORKER_ENTRYPOINT_004
  return response.sources
    .filter((s) => s.status === "active")
    .map((s) => ({
      source_id: s.source_id,
      domain: s.domain,
      max_pages: s.max_pages ?? 50,
      crawl_interval_minutes: s.crawl_interval_minutes ?? 10080,
    }));
  // END_BLOCK_MAP_ACTIVE_SOURCES_M_WORKER_ENTRYPOINT_004
}

// START_CONTRACT: runSchedulerTick
//   PURPOSE: Execute a single scheduler tick: read sources, filter active, run orchestrator.
//   INPUTS: { db: NodePgDatabase - Drizzle handle, orchestrator: IngestionOrchestrator - Orchestrator instance, logger: Logger - Worker logger }
//   OUTPUTS: { Promise<void> }
//   SIDE_EFFECTS: [Reads DB, runs ingestion pipeline, emits structured logs]
//   LINKS: [M-WORKER-ENTRYPOINT, M-SITE-SOURCES, M-SITES-INGESTION, M-LOGGER]
// END_CONTRACT: runSchedulerTick
export async function runSchedulerTick(
  db: NodePgDatabase,
  orchestrator: IngestionOrchestrator,
  logger: Logger,
): Promise<void> {
  // START_BLOCK_EXECUTE_SCHEDULER_TICK_M_WORKER_ENTRYPOINT_005
  const functionName = "runSchedulerTick";

  const sourcesResponse = await getSiteSources(db, logger, "jp");
  const activeSources = mapSourcesToIngestion(sourcesResponse);

  if (activeSources.length === 0) {
    logger.info(
      "No active sources found; skipping ingestion tick.",
      functionName,
      "SCHEDULER_TICK_NO_SOURCES",
    );
    return;
  }

  logger.info(
    `Scheduler tick: running ingestion for ${activeSources.length} active sources.`,
    functionName,
    "SCHEDULER_TICK_START",
    { sourceCount: activeSources.length },
  );

  const result = await orchestrator.runScheduledIngestion(activeSources);

  logger.info(
    `Scheduler tick complete. Sources: ${result.sources_processed}, pages: ${result.pages_fetched}, chunks: ${result.chunks_created}, embeddings: ${result.embeddings_created}, errors: ${result.errors.length}.`,
    functionName,
    "SCHEDULER_TICK_COMPLETE",
    {
      sourcesProcessed: result.sources_processed,
      pagesFetched: result.pages_fetched,
      chunksCreated: result.chunks_created,
      embeddingsCreated: result.embeddings_created,
      errorCount: result.errors.length,
    },
  );
  // END_BLOCK_EXECUTE_SCHEDULER_TICK_M_WORKER_ENTRYPOINT_005
}

// START_CONTRACT: sleep
//   PURPOSE: Promise-based delay that resolves or rejects based on a running flag, enabling graceful shutdown.
//   INPUTS: { ms: number - Delay in milliseconds, isRunning: () => boolean - Function returning current running state }
//   OUTPUTS: { Promise<void> - Resolves after delay or when running flag is false }
//   SIDE_EFFECTS: [Sets a timer]
//   LINKS: [M-WORKER-ENTRYPOINT]
// END_CONTRACT: sleep
export function sleep(ms: number, isRunning: () => boolean): Promise<void> {
  // START_BLOCK_INTERRUPTIBLE_SLEEP_M_WORKER_ENTRYPOINT_006
  return new Promise((resolve) => {
    if (!isRunning()) {
      resolve();
      return;
    }

    const checkInterval = Math.min(ms, 1000);
    let elapsed = 0;

    const timer = setInterval(() => {
      elapsed += checkInterval;
      if (elapsed >= ms || !isRunning()) {
        clearInterval(timer);
        resolve();
      }
    }, checkInterval);
  });
  // END_BLOCK_INTERRUPTIBLE_SLEEP_M_WORKER_ENTRYPOINT_006
}

// START_CONTRACT: main
//   PURPOSE: Bootstrap all worker dependencies and run the scheduler loop.
//   INPUTS: {}
//   OUTPUTS: { Promise<void> - Resolves when worker shuts down }
//   SIDE_EFFECTS: [Reads env config, initializes database client, bootstraps sites schema, creates integration clients, registers process signal handlers, runs scheduler loop, emits logs]
//   LINKS: [M-WORKER-ENTRYPOINT, M-CONFIG, M-LOGGER, M-DB, M-SITE-SOURCES, M-SPIDER-CLOUD-CLIENT, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-SITES-INGESTION]
// END_CONTRACT: main
export async function main(): Promise<void> {
  const shutdownTarget: ShutdownTarget = {
    dbPool: null,
  };
  let logger: Logger | null = null;
  let running = true;

  // START_BLOCK_BOOTSTRAP_WORKER_DEPENDENCIES_M_WORKER_ENTRYPOINT_007
  try {
    const config = loadConfig();
    logger = createLogger(config, "WorkerMain");

    logger.info(
      "Loaded runtime config and logger; initializing worker dependencies.",
      "main",
      "BOOTSTRAP_WORKER_DEPENDENCIES",
    );

    // Step 3: Create DB client
    const dbClient = await createDb(config, logger.child({ component: "db" }));
    shutdownTarget.dbPool = dbClient.pool;

    // Step 4: Bootstrap sites schema
    await bootstrapSitesSchema(dbClient.db, logger.child({ component: "sitesBootstrap" }));

    // Step 5: Create Spider client
    const spiderClient = createSpiderCloudClient(config, logger.child({ component: "spiderClient" }));

    // Step 6: Create Voyage client
    const voyageClient = createVoyageProxyClient(config, logger.child({ component: "voyageClient" }));

    // Step 7: Create repository
    const repository = createSitesIndexRepository(dbClient.db, logger.child({ component: "sitesIndexRepository" }));

    // Step 8: Create orchestrator
    const orchestrator = createIngestionOrchestrator({
      spiderClient,
      voyageClient,
      repository,
      logger: logger.child({ component: "ingestionOrchestrator" }),
    });

    // Step 9: Read initial sources from DB
    const initialSources = await getSiteSources(dbClient.db, logger.child({ component: "siteSources" }), "jp");
    const initialActive = mapSourcesToIngestion(initialSources);

    logger.info(
      `Worker bootstrap complete. Found ${initialActive.length} active sources.`,
      "main",
      "BOOTSTRAP_WORKER_DEPENDENCIES",
      { activeSourceCount: initialActive.length },
    );

    // START_BLOCK_INSTALL_GRACEFUL_SHUTDOWN_HANDLERS_M_WORKER_ENTRYPOINT_008
    let shutdownPromise: Promise<void> | null = null;

    const requestShutdown = (reason: Extract<ShutdownReason, "SIGINT" | "SIGTERM">): void => {
      if (shutdownPromise !== null) {
        logger!.warn(
          "Ignored duplicate shutdown signal because shutdown is already running.",
          "requestShutdown",
          "GRACEFUL_SHUTDOWN",
          { reason },
        );
        return;
      }

      running = false;

      logger!.warn(
        "Received shutdown signal; stopping worker.",
        "requestShutdown",
        "GRACEFUL_SHUTDOWN",
        { reason },
      );

      shutdownPromise = stopWorker(shutdownTarget, logger!, reason)
        .then(() => {
          logger!.info(
            "Graceful shutdown finished.",
            "requestShutdown",
            "GRACEFUL_SHUTDOWN",
            { reason },
          );
        })
        .catch((error: unknown) => {
          logger!.error(
            "Graceful shutdown encountered an unexpected failure.",
            "requestShutdown",
            "GRACEFUL_SHUTDOWN",
            {
              reason,
              cause: error instanceof Error ? error.message : String(error),
            },
          );
        });
    };

    process.once("SIGINT", () => {
      requestShutdown("SIGINT");
    });

    process.once("SIGTERM", () => {
      requestShutdown("SIGTERM");
    });
    // END_BLOCK_INSTALL_GRACEFUL_SHUTDOWN_HANDLERS_M_WORKER_ENTRYPOINT_008

    // START_BLOCK_RUN_SCHEDULER_LOOP_M_WORKER_ENTRYPOINT_009
    logger.info(
      `Starting scheduler loop with ${TICK_INTERVAL_MS}ms tick interval.`,
      "main",
      "SCHEDULER_LOOP_START",
      { tickIntervalMs: TICK_INTERVAL_MS },
    );

    while (running) {
      try {
        await runSchedulerTick(dbClient.db, orchestrator, logger);
      } catch (tickError: unknown) {
        const cause = tickError instanceof Error ? tickError.message : String(tickError);
        logger.error(
          `Scheduler tick failed: ${cause}. Continuing to next tick.`,
          "main",
          "SCHEDULER_TICK_ERROR",
          { cause },
        );
      }

      await sleep(TICK_INTERVAL_MS, () => running);
    }

    logger.info(
      "Scheduler loop exited.",
      "main",
      "SCHEDULER_LOOP_EXIT",
    );
    // END_BLOCK_RUN_SCHEDULER_LOOP_M_WORKER_ENTRYPOINT_009

    // Ensure shutdown completes
    if (shutdownPromise !== null) {
      await shutdownPromise;
    } else {
      await stopWorker(shutdownTarget, logger, "STARTUP_FAILURE");
    }
  } catch (error: unknown) {
    // END_BLOCK_BOOTSTRAP_WORKER_DEPENDENCIES_M_WORKER_ENTRYPOINT_007
    // START_BLOCK_MAP_STARTUP_FAILURE_TO_WORKER_START_ERROR_M_WORKER_ENTRYPOINT_010
    if (logger !== null) {
      await stopWorker(shutdownTarget, logger, "STARTUP_FAILURE");
    } else {
      if (shutdownTarget.dbPool !== null) {
        try {
          await shutdownTarget.dbPool.end();
        } catch {
          // Best-effort cleanup during startup failure mapping.
        } finally {
          shutdownTarget.dbPool = null;
        }
      }
    }

    if (error instanceof WorkerStartError) {
      throw error;
    }

    const cause = error instanceof Error ? error.message : String(error);
    const causeName = error instanceof Error ? error.name : "UnknownError";
    throw new WorkerStartError(`Worker startup failed: ${causeName}: ${cause}`, {
      cause,
      causeName,
    });
    // END_BLOCK_MAP_STARTUP_FAILURE_TO_WORKER_START_ERROR_M_WORKER_ENTRYPOINT_010
  }
}

main().catch((error: unknown) => {
  console.error("Worker failed to start:", error);
  process.exit(1);
});
