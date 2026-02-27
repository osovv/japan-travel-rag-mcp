// FILE: src/server/index.ts
// VERSION: 2.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Bootstrap runtime dependencies, construct FastMCP server, and start MCP HTTP stream transport on /mcp.
//   SCOPE: Load config/logger, initialize OAuth proxy and upstream proxy dependencies, construct FastMCP runtime with admin handler binding, start FastMCP httpStream transport, and manage graceful shutdown.
//   DEPENDS: M-CONFIG, M-LOGGER, M-AUTH-PROXY, M-ADMIN-UI, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY, M-FASTMCP-RUNTIME
//   LINKS: M-SERVER, M-CONFIG, M-LOGGER, M-AUTH-PROXY, M-ADMIN-UI, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY, M-FASTMCP-RUNTIME
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ServerStartError - Typed startup failure error with SERVER_START_ERROR code.
//   stopRuntime - Stop FastMCP runtime with deterministic logs.
//   installGracefulShutdownHandlers - Register SIGINT/SIGTERM handlers with idempotent shutdown guard.
//   main - Application entrypoint that initializes dependencies and starts FastMCP httpStream runtime at /mcp.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v2.0.0 - Finalized M-SERVER boot path on OAuthProxy runtime architecture by removing legacy DB/mcp-auth dependencies and keeping FastMCP graceful shutdown lifecycle.
// END_CHANGE_SUMMARY

import { type FastMCP } from "fastmcp";
import { handleAdminRequest } from "../admin/ui-routes";
import { createOauthProxy } from "../auth/oauth-proxy";
import { loadConfig } from "../config/index";
import { createTgChatRagClient } from "../integrations/tg-chat-rag-client";
import { createLogger } from "../logger/index";
import type { Logger } from "../logger/index";
import { createFastMcpRuntime } from "../runtime/fastmcp-runtime";
import { createToolProxyService } from "../tools/proxy-service";

type ShutdownTarget = {
  fastMcpServer: FastMCP | null;
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

// START_CONTRACT: stopRuntime
//   PURPOSE: Stop FastMCP runtime in deterministic order with idempotent target clearing.
//   INPUTS: { shutdownTarget: ShutdownTarget - Mutable runtime handle, logger: Logger - Server logger, reason: ShutdownReason - Shutdown trigger label }
//   OUTPUTS: { Promise<void> - Resolves after stop attempts complete }
//   SIDE_EFFECTS: [Calls FastMCP.stop(), mutates shutdownTarget handles to null, emits structured logs]
//   LINKS: [M-SERVER, M-FASTMCP-RUNTIME, M-LOGGER]
// END_CONTRACT: stopRuntime
async function stopRuntime(
  shutdownTarget: ShutdownTarget,
  logger: Logger,
  reason: ShutdownReason,
): Promise<void> {
  // START_BLOCK_STOP_FASTMCP_RUNTIME_M_SERVER_101
  const serverToStop = shutdownTarget.fastMcpServer;

  shutdownTarget.fastMcpServer = null;

  if (serverToStop !== null) {
    try {
      await serverToStop.stop();
      logger.info(
        "Stopped FastMCP runtime.",
        "stopRuntime",
        "STOP_FASTMCP_RUNTIME",
        { reason },
      );
    } catch (error: unknown) {
      logger.error(
        "Failed while stopping FastMCP runtime.",
        "stopRuntime",
        "STOP_FASTMCP_RUNTIME",
        {
          reason,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
  // END_BLOCK_STOP_FASTMCP_RUNTIME_M_SERVER_101
}

// START_CONTRACT: installGracefulShutdownHandlers
//   PURPOSE: Register SIGINT and SIGTERM handlers that shut down FastMCP runtime exactly once.
//   INPUTS: { shutdownTarget: ShutdownTarget - Mutable runtime handle, logger: Logger - Server logger }
//   OUTPUTS: { void - Signal handlers are installed on process }
//   SIDE_EFFECTS: [Registers process signal listeners, triggers async shutdown flow, emits structured logs]
//   LINKS: [M-SERVER, M-FASTMCP-RUNTIME, M-LOGGER]
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

    shutdownPromise = stopRuntime(shutdownTarget, logger, reason)
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
//   OUTPUTS: { Promise<FastMCP> - Started FastMCP runtime instance }
//   SIDE_EFFECTS: [Reads env config, initializes oauth proxy metadata and upstream dependencies, opens network listeners, registers process signal handlers, emits logs]
//   LINKS: [M-SERVER, M-CONFIG, M-LOGGER, M-AUTH-PROXY, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY, M-FASTMCP-RUNTIME, M-ADMIN-UI]
// END_CONTRACT: main
export async function main(): Promise<FastMCP> {
  const shutdownTarget: ShutdownTarget = {
    fastMcpServer: null,
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

    const tgClient = createTgChatRagClient(config, logger.child({ component: "tgChatRagClient" }));
    const proxyService = createToolProxyService(
      config,
      logger.child({ component: "toolProxyService" }),
      tgClient,
    );
    const oauthProxyContext = createOauthProxy({
      config,
      logger: logger.child({ component: "oauthProxy" }),
    });

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
      oauthProxyContext,
      proxyService,
      adminHandler,
    });
    shutdownTarget.fastMcpServer = fastMcpServer;

    await fastMcpServer.start({
      transportType: "httpStream",
      httpStream: {
        host: "0.0.0.0",
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
      await stopRuntime(shutdownTarget, logger, "STARTUP_FAILURE");
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
