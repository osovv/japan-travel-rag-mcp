// FILE: src/server/index.ts
// VERSION: 1.5.0
// START_MODULE_CONTRACT
//   PURPOSE: Boot Bun HTTP server, enforce auth guards, and expose /mcp, /admin/*, OAuth discovery metadata, and /healthz routes.
//   SCOPE: Load runtime config, initialize logger/database/repository/upstream/transport/auth/discovery dependencies, serve guarded HTTP routes, centralize OAuth challenge response construction for /mcp unauthorized paths, and handle process shutdown signals.
//   DEPENDS: M-CONFIG, M-LOGGER, M-DB, M-API-KEY-REPOSITORY, M-ADMIN-AUTH, M-ADMIN-UI, M-MCP-AUTH-GUARD, M-OAUTH-DISCOVERY, M-OAUTH-TOKEN-VALIDATOR, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY, M-TRANSPORT
//   LINKS: M-SERVER, M-CONFIG, M-LOGGER, M-DB, M-API-KEY-REPOSITORY, M-ADMIN-AUTH, M-ADMIN-UI, M-MCP-AUTH-GUARD, M-OAUTH-DISCOVERY, M-OAUTH-TOKEN-VALIDATOR, M-TRANSPORT, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ServerStartError - Typed startup failure error with SERVER_START_ERROR code.
//   main - Application entrypoint that initializes dependencies and starts Bun HTTP server with OAuth discovery and /mcp auth routing.
//   createJsonResponse - Build consistent JSON HTTP responses.
//   createUnauthorizedMcpResponse - Build consistent 401 /mcp response with OAuth WWW-Authenticate challenge metadata.
//   isAdminRoutePath - Determine whether pathname maps to /admin surface.
//   installGracefulShutdownHandlers - Register SIGINT/SIGTERM handlers for graceful server shutdown.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.5.0 - Centralized /mcp unauthorized OAuth challenge responses to keep WWW-Authenticate behavior consistent across auth-failure branches.
// END_CHANGE_SUMMARY

import { createApiKeyRepository } from "../admin/api-key-repository";
import { handleAdminRequest } from "../admin/ui-routes";
import { authorizeMcpRequest, buildWwwAuthenticateHeader } from "../auth/mcp-auth-guard";
import type { OAuthChallengeMetadata } from "../auth/mcp-auth-guard";
import { handleOAuthProtectedResourceMetadata } from "../auth/oauth-discovery-routes";
import { createOAuthTokenValidator } from "../auth/oauth-token-validator";
import { loadConfig } from "../config/index";
import { createDb } from "../db/index";
import { createLogger } from "../logger/index";
import type { Logger } from "../logger/index";
import { createTgChatRagClient } from "../integrations/tg-chat-rag-client";
import { createToolProxyService } from "../tools/proxy-service";
import { handleMcpRequest, TransportError } from "../transport/mcp-transport";
import type { McpTransportDependencies } from "../transport/mcp-transport";

const MCP_UNAUTHORIZED_MESSAGE = "Invalid or missing OAuth access token.";

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

// START_CONTRACT: createUnauthorizedMcpResponse
//   PURPOSE: Build consistent /mcp unauthorized response body and OAuth WWW-Authenticate challenge header.
//   INPUTS: { challenge: OAuthChallengeMetadata - OAuth challenge metadata used to build WWW-Authenticate header }
//   OUTPUTS: { Response - HTTP 401 response with UNAUTHORIZED error body and challenge header }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SERVER, M-MCP-AUTH-GUARD]
// END_CONTRACT: createUnauthorizedMcpResponse
export function createUnauthorizedMcpResponse(challenge: OAuthChallengeMetadata): Response {
  // START_BLOCK_CREATE_UNAUTHORIZED_MCP_RESPONSE_WITH_CHALLENGE_M_SERVER_008
  return new Response(
    JSON.stringify({
      error: {
        code: "UNAUTHORIZED",
        message: MCP_UNAUTHORIZED_MESSAGE,
      },
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "www-authenticate": buildWwwAuthenticateHeader(challenge),
      },
    },
  );
  // END_BLOCK_CREATE_UNAUTHORIZED_MCP_RESPONSE_WITH_CHALLENGE_M_SERVER_008
}

// START_CONTRACT: isAdminRoutePath
//   PURPOSE: Determine whether request pathname belongs to /admin routing surface.
//   INPUTS: { pathname: string - Parsed URL pathname from incoming request }
//   OUTPUTS: { boolean - True when path is /admin or /admin/* }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SERVER, M-ADMIN-UI]
// END_CONTRACT: isAdminRoutePath
function isAdminRoutePath(pathname: string): boolean {
  // START_BLOCK_MATCH_ADMIN_ROUTE_PREFIX_M_SERVER_007
  return pathname === "/admin" || pathname.startsWith("/admin/");
  // END_BLOCK_MATCH_ADMIN_ROUTE_PREFIX_M_SERVER_007
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
//   PURPOSE: Initialize runtime dependencies and start the Bun HTTP server for MCP, admin, and OAuth discovery routes.
//   INPUTS: {}
//   OUTPUTS: { Promise<Bun.Server> - Running Bun HTTP server instance }
//   SIDE_EFFECTS: [Reads environment config, opens DB and network connections, registers process signal handlers, emits logs]
//   LINKS: [M-SERVER, M-CONFIG, M-LOGGER, M-DB, M-API-KEY-REPOSITORY, M-ADMIN-UI, M-MCP-AUTH-GUARD, M-OAUTH-DISCOVERY, M-OAUTH-TOKEN-VALIDATOR, M-TRANSPORT, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY]
// END_CONTRACT: main
export async function main(): Promise<Bun.Server<unknown>> {
  // START_BLOCK_INITIALIZE_RUNTIME_DEPENDENCIES_M_SERVER_003
  try {
    const config = loadConfig();
    const logger = createLogger(config, "ServerMain");
    const db = await createDb(config, logger.child({ component: "db" }));
    const apiKeyRepository = createApiKeyRepository(
      db,
      logger.child({ component: "apiKeyRepository" }),
    );
    const tgClient = createTgChatRagClient(config, logger.child({ component: "tgChatRagClient" }));
    const proxyService = createToolProxyService(
      config,
      logger.child({ component: "toolProxyService" }),
      tgClient,
    );
    const mcpLogger = logger.child({ route: "mcp" });
    const transportDeps: McpTransportDependencies = {
      logger: mcpLogger.child({ component: "transport" }),
      proxyService,
    };
    const adminDeps = {
      config,
      logger: logger.child({ route: "admin", component: "adminUiRoutes" }),
      apiKeyRepository,
    };
    const mcpResourceUrl = new URL("/mcp", config.publicUrl).toString();
    const oauthTokenValidator = createOAuthTokenValidator({
      config,
      logger: mcpLogger.child({ component: "oauthTokenValidator" }),
    });
    const oauthDiscoveryDeps = {
      config,
      logger: logger.child({ route: "oauthDiscovery", component: "oauthDiscoveryRoutes" }),
    };
    const mcpAuthDeps = {
      oauthTokenValidator,
      requiredScopes: config.oauth.requiredScopes,
      issuer: config.oauth.issuer,
      resource: mcpResourceUrl,
      logger: mcpLogger.child({ component: "mcpAuthGuard" }),
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

        const oauthDiscoveryResponse = handleOAuthProtectedResourceMetadata(request, oauthDiscoveryDeps);
        if (oauthDiscoveryResponse !== null) {
          return oauthDiscoveryResponse;
        }

        if (isAdminRoutePath(url.pathname)) {
          logger.info(
            "Dispatching /admin request to admin UI handler.",
            "main",
            "START_BUN_HTTP_SERVER",
            { method: request.method, pathname: url.pathname },
          );

          try {
            return await handleAdminRequest(request, adminDeps);
          } catch (error: unknown) {
            logger.error(
              "Unexpected /admin request failure at server boundary.",
              "main",
              "HANDLE_ADMIN_ROUTE_FAILURE",
              {
                cause: error instanceof Error ? error.message : String(error),
                method: request.method,
                pathname: url.pathname,
              },
            );
            return new Response("<h1>Internal Server Error</h1>", {
              status: 500,
              headers: {
                "content-type": "text/html; charset=utf-8",
              },
            });
          }
        }

        if (request.method === "POST" && url.pathname === "/mcp") {
          logger.info(
            "Received /mcp request; running authorization guard.",
            "main",
            "START_BUN_HTTP_SERVER",
            {
              method: request.method,
              pathname: url.pathname,
              authHeaderPresent: request.headers.get("authorization") !== null,
            },
          );

          let authDecision: Awaited<ReturnType<typeof authorizeMcpRequest>>;
          const authorizationHeader = request.headers.get("authorization");

          try {
            authDecision = await authorizeMcpRequest(authorizationHeader, mcpAuthDeps);
          } catch (error: unknown) {
            logger.error(
              "MCP authorization guard failed; denying request.",
              "main",
              "HANDLE_MCP_ROUTE_FAILURE",
              {
                cause: error instanceof Error ? error.message : String(error),
              },
            );
            return createUnauthorizedMcpResponse({
              error: "invalid_token",
              errorDescription: "Access token validation failed due to internal authorization error.",
              requiredScopes: config.oauth.requiredScopes,
              issuer: config.oauth.issuer,
              resource: mcpResourceUrl,
            });
          }

          if (!authDecision.isAuthorized) {
            logger.warn(
              "Rejected /mcp request due to failed authorization.",
              "main",
              "HANDLE_MCP_ROUTE_FAILURE",
              {
                reason: authDecision.reason,
              },
            );
            return createUnauthorizedMcpResponse(authDecision.challenge);
          }

          logger.info(
            "Authorized /mcp request; dispatching to transport handler.",
            "main",
            "START_BUN_HTTP_SERVER",
            {
              method: request.method,
              pathname: url.pathname,
              authSubject: authDecision.subject ?? null,
              grantedScopes: authDecision.grantedScopes,
            },
          );

          try {
            return await handleMcpRequest(request, {
              ...transportDeps,
              logger: transportDeps.logger.child({
                authSubject: authDecision.subject ?? null,
                grantedScopes: authDecision.grantedScopes,
              }),
            });
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
    const cause = error instanceof Error ? error.message : String(error);
    const causeName = error instanceof Error ? error.name : "UnknownError";
    throw new ServerStartError(`Server startup failed: ${causeName}: ${cause}`, {
      cause,
      causeName,
    });
    // END_BLOCK_MAP_STARTUP_FAILURE_TO_SERVER_START_ERROR_M_SERVER_006
  }
}
