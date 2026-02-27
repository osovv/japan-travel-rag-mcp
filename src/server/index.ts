// FILE: src/server/index.ts
// VERSION: 1.9.1
// START_MODULE_CONTRACT
//   PURPOSE: Bootstrap runtime dependencies, construct FastMCP server, and start MCP HTTP stream transport on /mcp.
//   SCOPE: Load config/logger, initialize DB and upstream proxy dependencies, initialize MCP auth context, construct FastMCP runtime with admin handler binding, start FastMCP httpStream transport, and manage graceful shutdown.
//   DEPENDS: M-CONFIG, M-LOGGER, M-DB, M-ADMIN-AUTH, M-ADMIN-UI, M-MCP-AUTH-PROVIDER, M-MCP-AUTH-ADAPTER, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY, M-FASTMCP-RUNTIME
//   LINKS: M-SERVER, M-CONFIG, M-LOGGER, M-DB, M-ADMIN-AUTH, M-ADMIN-UI, M-MCP-AUTH-PROVIDER, M-MCP-AUTH-ADAPTER, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY, M-FASTMCP-RUNTIME
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ServerStartError - Typed startup failure error with SERVER_START_ERROR code.
//   stopRuntimeAndDb - Stop FastMCP runtime and close DB pool with deterministic logs.
//   installGracefulShutdownHandlers - Register SIGINT/SIGTERM handlers with idempotent shutdown guard.
//   main - Application entrypoint that initializes dependencies and starts FastMCP httpStream runtime at /mcp.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.9.1 - Removed legacy transport/guard runtime path references and aligned module dependency contract with FastMCP adapter architecture.
// END_CHANGE_SUMMARY

import type { FastMCP } from "fastmcp";
import { handleAdminRequest } from "../admin/ui-routes";
import type { McpAuthSession } from "../auth/mcp-auth-adapter";
import { initMcpAuth } from "../auth/mcp-auth-provider";
import { loadConfig } from "../config/index";
import { createDb } from "../db/index";
import type { DbClient } from "../db/index";
import { createTgChatRagClient } from "../integrations/tg-chat-rag-client";
import { createLogger } from "../logger/index";
import type { Logger } from "../logger/index";
import { createFastMcpRuntime } from "../runtime/fastmcp-runtime";
import { createToolProxyService } from "../tools/proxy-service";

type ShutdownTarget = {
  fastMcpServer: FastMCP<McpAuthSession> | null;
  dbClient: DbClient | null;
};

type ShutdownReason = "SIGINT" | "SIGTERM" | "STARTUP_FAILURE";

export class ServerStartError extends Error {
  public readonly code = "SERVER_START_ERROR" as const;
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ServerStartError";
    this.details = details;
  }
}

// START_CONTRACT: stopRuntimeAndDb
//   PURPOSE: Stop FastMCP runtime and close DB pool in deterministic order with idempotent target clearing.
//   INPUTS: { shutdownTarget: ShutdownTarget - Mutable runtime/db handles, logger: Logger - Server logger, reason: ShutdownReason - Shutdown trigger label }
//   OUTPUTS: { Promise<void> - Resolves after stop/close attempts complete }
//   SIDE_EFFECTS: [Calls FastMCP.stop(), closes pg pool, mutates shutdownTarget handles to null, emits structured logs]
//   LINKS: [M-SERVER, M-FASTMCP-RUNTIME, M-DB, M-LOGGER]
// END_CONTRACT: stopRuntimeAndDb
async function stopRuntimeAndDb(
  shutdownTarget: ShutdownTarget,
  logger: Logger,
  reason: ShutdownReason,
): Promise<void> {
  // START_BLOCK_STOP_FASTMCP_RUNTIME_AND_CLOSE_DB_POOL_M_SERVER_101
  const serverToStop = shutdownTarget.fastMcpServer;
  const dbClientToClose = shutdownTarget.dbClient;

  shutdownTarget.fastMcpServer = null;
  shutdownTarget.dbClient = null;

  if (serverToStop !== null) {
    try {
      await serverToStop.stop();
      logger.info(
        "Stopped FastMCP runtime.",
        "stopRuntimeAndDb",
        "STOP_FASTMCP_RUNTIME_AND_CLOSE_DB_POOL",
        { reason },
      );
    } catch (error: unknown) {
      logger.error(
        "Failed while stopping FastMCP runtime.",
        "stopRuntimeAndDb",
        "STOP_FASTMCP_RUNTIME_AND_CLOSE_DB_POOL",
        {
          reason,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  if (dbClientToClose !== null) {
    try {
      await dbClientToClose.pool.end();
      logger.info(
        "Closed PostgreSQL pool.",
        "stopRuntimeAndDb",
        "STOP_FASTMCP_RUNTIME_AND_CLOSE_DB_POOL",
        { reason },
      );
    } catch (error: unknown) {
      logger.error(
        "Failed while closing PostgreSQL pool.",
        "stopRuntimeAndDb",
        "STOP_FASTMCP_RUNTIME_AND_CLOSE_DB_POOL",
        {
          reason,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
  // END_BLOCK_STOP_FASTMCP_RUNTIME_AND_CLOSE_DB_POOL_M_SERVER_101
}

// START_CONTRACT: installGracefulShutdownHandlers
//   PURPOSE: Register SIGINT and SIGTERM handlers that shut down FastMCP runtime and DB pool exactly once.
//   INPUTS: { shutdownTarget: ShutdownTarget - Mutable runtime/db handles, logger: Logger - Server logger }
//   OUTPUTS: { void - Signal handlers are installed on process }
//   SIDE_EFFECTS: [Registers process signal listeners, triggers async shutdown flow, emits structured logs]
//   LINKS: [M-SERVER, M-FASTMCP-RUNTIME, M-DB, M-LOGGER]
// END_CONTRACT: installGracefulShutdownHandlers
function installGracefulShutdownHandlers(shutdownTarget: ShutdownTarget, logger: Logger): void {
  // START_BLOCK_REGISTER_IDEMPOTENT_PROCESS_SIGNAL_HANDLERS_M_SERVER_102
  let shutdownPromise: Promise<void> | null = null;

  const requestShutdown = (reason: Extract<ShutdownReason, "SIGINT" | "SIGTERM">): void => {
    if (shutdownPromise !== null) {
      logger.warn(
        "Ignored duplicate shutdown signal because shutdown is already running.",
        "installGracefulShutdownHandlers",
        "REGISTER_IDEMPOTENT_PROCESS_SIGNAL_HANDLERS",
        { reason },
      );
      return;
    }

    logger.warn(
      "Received shutdown signal; stopping runtime resources.",
      "installGracefulShutdownHandlers",
      "REGISTER_IDEMPOTENT_PROCESS_SIGNAL_HANDLERS",
      { reason },
    );

    shutdownPromise = stopRuntimeAndDb(shutdownTarget, logger, reason)
      .then(() => {
        logger.info(
          "Graceful shutdown finished.",
          "installGracefulShutdownHandlers",
          "REGISTER_IDEMPOTENT_PROCESS_SIGNAL_HANDLERS",
          { reason },
        );
      })
      .catch((error: unknown) => {
        logger.error(
          "Graceful shutdown encountered an unexpected failure.",
          "installGracefulShutdownHandlers",
          "REGISTER_IDEMPOTENT_PROCESS_SIGNAL_HANDLERS",
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
  // END_BLOCK_REGISTER_IDEMPOTENT_PROCESS_SIGNAL_HANDLERS_M_SERVER_102
}

// START_CONTRACT: main
//   PURPOSE: Bootstrap all runtime dependencies, construct FastMCP runtime, and start MCP httpStream transport.
//   INPUTS: {}
//   OUTPUTS: { Promise<FastMCP<McpAuthSession>> - Started FastMCP runtime instance }
//   SIDE_EFFECTS: [Reads env config, initializes database and auth metadata, opens network listeners, registers process signal handlers, emits logs]
//   LINKS: [M-SERVER, M-CONFIG, M-LOGGER, M-DB, M-MCP-AUTH-PROVIDER, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY, M-FASTMCP-RUNTIME, M-ADMIN-UI]
// END_CONTRACT: main
export async function main(): Promise<FastMCP<McpAuthSession>> {
  const shutdownTarget: ShutdownTarget = {
    fastMcpServer: null,
    dbClient: null,
  };
  let logger: Logger | null = null;

  // START_BLOCK_BOOTSTRAP_FASTMCP_SERVER_RUNTIME_M_SERVER_103
  try {
    const config = loadConfig();
    logger = createLogger(config, "ServerMain");

    logger.info(
      "Loaded runtime config and logger; initializing dependencies.",
      "main",
      "BOOTSTRAP_FASTMCP_SERVER_RUNTIME",
      { port: config.port },
    );

    const dbLogger = logger.child({ component: "db" });
    shutdownTarget.dbClient = await createDb(config, dbLogger);

    const tgClient = createTgChatRagClient(config, logger.child({ component: "tgChatRagClient" }));
    const proxyService = createToolProxyService(
      config,
      logger.child({ component: "toolProxyService" }),
      tgClient,
    );
    const authContext = await initMcpAuth(config, logger.child({ component: "mcpAuthProvider" }));

    const adminDeps = {
      config,
      logger: logger.child({ route: "admin", component: "adminUiRoutes" }),
    };
    const adminHandler = async (request: Request): Promise<Response> => {
      return handleAdminRequest(request, adminDeps);
    };

    const fastMcpServer = createFastMcpRuntime({
      config,
      logger: logger.child({ component: "fastMcpRuntime" }),
      authContext,
      proxyService,
      adminHandler,
    });
    shutdownTarget.fastMcpServer = fastMcpServer;

    await fastMcpServer.start({
      transportType: "httpStream",
      httpStream: {
        port: config.port,
        endpoint: "/mcp",
      },
    });

    installGracefulShutdownHandlers(shutdownTarget, logger);

    logger.info(
      "FastMCP runtime started with HTTP stream transport.",
      "main",
      "BOOTSTRAP_FASTMCP_SERVER_RUNTIME",
      {
        port: config.port,
        endpoint: "/mcp",
      },
    );

    return fastMcpServer;
  } catch (error: unknown) {
    // END_BLOCK_BOOTSTRAP_FASTMCP_SERVER_RUNTIME_M_SERVER_103
    // START_BLOCK_MAP_STARTUP_FAILURE_TO_SERVER_START_ERROR_M_SERVER_104
    if (logger !== null) {
      await stopRuntimeAndDb(shutdownTarget, logger, "STARTUP_FAILURE");
    } else {
      if (shutdownTarget.fastMcpServer !== null) {
        try {
          await shutdownTarget.fastMcpServer.stop();
        } catch {
          // Best-effort cleanup during startup failure mapping.
        } finally {
          shutdownTarget.fastMcpServer = null;
        }
      }

      if (shutdownTarget.dbClient !== null) {
        try {
          await shutdownTarget.dbClient.pool.end();
        } catch {
          // Best-effort cleanup during startup failure mapping.
        } finally {
          shutdownTarget.dbClient = null;
        }
      }
    }

    if (error instanceof ServerStartError) {
      throw error;
    }

    const cause = error instanceof Error ? error.message : String(error);
    const causeName = error instanceof Error ? error.name : "UnknownError";
    throw new ServerStartError(`Server startup failed: ${causeName}: ${cause}`, {
      cause,
      causeName,
    });
    // END_BLOCK_MAP_STARTUP_FAILURE_TO_SERVER_START_ERROR_M_SERVER_104
  }
}
