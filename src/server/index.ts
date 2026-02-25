// FILE: src/server/index.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Boot Bun HTTP server, expose /mcp and /healthz, and provide graceful shutdown.
//   SCOPE: Load runtime config, initialize logger/client/proxy/transport dependencies, serve HTTP routes, and handle process shutdown signals.
//   DEPENDS: M-CONFIG, M-LOGGER, M-TRANSPORT
//   LINKS: M-SERVER, M-CONFIG, M-LOGGER, M-TRANSPORT, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ServerStartError - Typed startup failure error with SERVER_START_ERROR code.
//   main - Application entrypoint that initializes dependencies and starts Bun HTTP server.
//   createJsonResponse - Build consistent JSON HTTP responses.
//   installGracefulShutdownHandlers - Register SIGINT/SIGTERM handlers for graceful server shutdown.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation from development plan for M-SERVER.
// END_CHANGE_SUMMARY

import { loadConfig } from "../config/index";
import { createLogger } from "../logger/index";
import type { Logger } from "../logger/index";
import { createTgChatRagClient } from "../integrations/tg-chat-rag-client";
import { createToolProxyService } from "../tools/proxy-service";
import { handleMcpRequest, TransportError } from "../transport/mcp-transport";
import type { McpTransportDependencies } from "../transport/mcp-transport";

export class ServerStartError extends Error {
  public readonly code = "SERVER_START_ERROR" as const;
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ServerStartError";
    this.details = details;
  }
}

// START_CONTRACT: createJsonResponse
//   PURPOSE: Create JSON HTTP responses with consistent content type and payload encoding.
//   INPUTS: { status: number - HTTP status code, payload: Record<string, unknown> - JSON response payload }
//   OUTPUTS: { Response - HTTP response containing JSON body }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SERVER]
// END_CONTRACT: createJsonResponse
function createJsonResponse(status: number, payload: Record<string, unknown>): Response {
  // START_BLOCK_CREATE_JSON_HTTP_RESPONSE_M_SERVER_001
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
  // END_BLOCK_CREATE_JSON_HTTP_RESPONSE_M_SERVER_001
}

// START_CONTRACT: installGracefulShutdownHandlers
//   PURPOSE: Install process signal handlers that stop the Bun HTTP server gracefully.
//   INPUTS: { server: Bun.Server - Running Bun server instance, logger: Logger - Base server logger }
//   OUTPUTS: { void - Handlers are registered on process }
//   SIDE_EFFECTS: [Registers SIGINT and SIGTERM listeners and stops server on first signal]
//   LINKS: [M-SERVER, M-LOGGER]
// END_CONTRACT: installGracefulShutdownHandlers
function installGracefulShutdownHandlers(server: Bun.Server<unknown>, logger: Logger): void {
  // START_BLOCK_REGISTER_PROCESS_SIGNAL_SHUTDOWN_HANDLERS_M_SERVER_002
  let shuttingDown = false;

  const stopServer = (signal: "SIGINT" | "SIGTERM"): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.warn(
      "Received shutdown signal; stopping HTTP server.",
      "main",
      "REGISTER_PROCESS_SIGNAL_SHUTDOWN_HANDLERS",
      { signal },
    );

    try {
      server.stop(true);
      logger.info(
        "HTTP server stopped gracefully.",
        "main",
        "REGISTER_PROCESS_SIGNAL_SHUTDOWN_HANDLERS",
        { signal },
      );
    } catch (error: unknown) {
      logger.error(
        "Graceful shutdown failed.",
        "main",
        "REGISTER_PROCESS_SIGNAL_SHUTDOWN_HANDLERS",
        {
          signal,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  };

  process.once("SIGINT", () => {
    stopServer("SIGINT");
  });
  process.once("SIGTERM", () => {
    stopServer("SIGTERM");
  });
  // END_BLOCK_REGISTER_PROCESS_SIGNAL_SHUTDOWN_HANDLERS_M_SERVER_002
}

// START_CONTRACT: main
//   PURPOSE: Initialize runtime dependencies and start the Bun HTTP server for MCP proxy routes.
//   INPUTS: {}
//   OUTPUTS: { Promise<Bun.Server> - Running Bun HTTP server instance }
//   SIDE_EFFECTS: [Reads environment config, opens network listener, registers process signal handlers, emits logs]
//   LINKS: [M-SERVER, M-CONFIG, M-LOGGER, M-TRANSPORT, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY]
// END_CONTRACT: main
export async function main(): Promise<Bun.Server<unknown>> {
  // START_BLOCK_INITIALIZE_RUNTIME_DEPENDENCIES_M_SERVER_003
  try {
    const config = loadConfig();
    const logger = createLogger(config, "ServerMain");
    const tgClient = createTgChatRagClient(config, logger.child({ component: "tgChatRagClient" }));
    const proxyService = createToolProxyService(
      config,
      logger.child({ component: "toolProxyService" }),
      tgClient,
    );
    const transportDeps: McpTransportDependencies = {
      logger: logger.child({ route: "mcp" }),
      proxyService,
    };
    // END_BLOCK_INITIALIZE_RUNTIME_DEPENDENCIES_M_SERVER_003

    // START_BLOCK_START_BUN_HTTP_SERVER_M_SERVER_004
    const server = Bun.serve({
      port: config.port,
      fetch: async (request: Request): Promise<Response> => {
        const url = new URL(request.url);

        if (request.method === "GET" && url.pathname === "/healthz") {
          return createJsonResponse(200, {
            status: "ok",
            service: "japan-travel-rag-mcp",
          });
        }

        if (request.method === "POST" && url.pathname === "/mcp") {
          logger.info(
            "Dispatching /mcp request to transport handler.",
            "main",
            "START_BUN_HTTP_SERVER",
            { method: request.method, pathname: url.pathname },
          );

          try {
            return await handleMcpRequest(request, transportDeps);
          } catch (error: unknown) {
            if (error instanceof TransportError) {
              logger.warn(
                "Transport handler rejected /mcp request.",
                "main",
                "HANDLE_MCP_ROUTE_FAILURE",
                {
                  code: error.code,
                  details: error.details ?? null,
                },
              );
              return createJsonResponse(400, {
                error: {
                  code: error.code,
                  message: error.message,
                  details: error.details ?? null,
                },
              });
            }

            logger.error(
              "Unexpected /mcp request failure.",
              "main",
              "HANDLE_MCP_ROUTE_FAILURE",
              {
                cause: error instanceof Error ? error.message : String(error),
              },
            );
            return createJsonResponse(500, {
              error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "Unexpected server error.",
              },
            });
          }
        }

        return createJsonResponse(404, {
          error: {
            code: "NOT_FOUND",
            message: "Route not found.",
          },
        });
      },
      error: (error: Error): Response => {
        logger.error(
          "Bun runtime produced unhandled fetch error.",
          "main",
          "START_BUN_HTTP_SERVER",
          { cause: error.message },
        );
        return createJsonResponse(500, {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Unhandled runtime error.",
          },
        });
      },
    });
    // END_BLOCK_START_BUN_HTTP_SERVER_M_SERVER_004

    // START_BLOCK_INSTALL_GRACEFUL_SHUTDOWN_AND_RETURN_SERVER_M_SERVER_005
    installGracefulShutdownHandlers(server, logger);
    logger.info("HTTP server started.", "main", "INSTALL_GRACEFUL_SHUTDOWN_AND_RETURN_SERVER", {
      port: config.port,
    });
    return server;
    // END_BLOCK_INSTALL_GRACEFUL_SHUTDOWN_AND_RETURN_SERVER_M_SERVER_005
  } catch (error: unknown) {
    // START_BLOCK_MAP_STARTUP_FAILURE_TO_SERVER_START_ERROR_M_SERVER_006
    if (error instanceof ServerStartError) {
      throw error;
    }
    throw new ServerStartError("Server startup failed.", {
      cause: error instanceof Error ? error.message : String(error),
    });
    // END_BLOCK_MAP_STARTUP_FAILURE_TO_SERVER_START_ERROR_M_SERVER_006
  }
}
