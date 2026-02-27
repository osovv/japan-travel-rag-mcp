// FILE: src/server/index.ts
// VERSION: 1.8.0
// START_MODULE_CONTRACT
//   PURPOSE: Boot Bun HTTP server, enforce auth guards, and expose /mcp, /admin/*, OAuth protected-resource metadata, and /healthz routes.
//   SCOPE: Load runtime config, initialize logger/upstream/transport/auth dependencies, serve protected-resource metadata from McpAuthContext payload, route /mcp through Request-based auth guard, and handle process shutdown signals.
//   DEPENDS: M-CONFIG, M-LOGGER, M-ADMIN-AUTH, M-ADMIN-UI, M-MCP-AUTH-PROVIDER, M-MCP-AUTH-GUARD, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY, M-TRANSPORT
//   LINKS: M-SERVER, M-CONFIG, M-LOGGER, M-ADMIN-AUTH, M-ADMIN-UI, M-MCP-AUTH-PROVIDER, M-MCP-AUTH-GUARD, M-TRANSPORT, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ServerStartError - Typed startup failure error with SERVER_START_ERROR code.
//   main - Application entrypoint that initializes dependencies and starts Bun HTTP server with OAuth metadata and /mcp auth routing.
//   createJsonResponse - Build consistent JSON HTTP responses.
//   handleProtectedResourceMetadataRequest - Serve OAuth protected resource metadata endpoints from McpAuthContext payload.
//   isAdminRoutePath - Determine whether pathname maps to /admin surface.
//   installGracefulShutdownHandlers - Register SIGINT/SIGTERM handlers for graceful server shutdown.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.8.0 - Migrated server wiring to initMcpAuth + Request-based guard and served OAuth protected-resource metadata from McpAuthContext.
// END_CHANGE_SUMMARY

import { handleAdminRequest } from "../admin/ui-routes";
import { authorizeMcpRequest } from "../auth/mcp-auth-guard";
import type { McpAuthGuardDependencies } from "../auth/mcp-auth-guard";
import { initMcpAuth } from "../auth/mcp-auth-provider";
import type { McpAuthContext } from "../auth/mcp-auth-provider";
import { loadConfig } from "../config/index";
import { createLogger } from "../logger/index";
import type { Logger } from "../logger/index";
import { createTgChatRagClient } from "../integrations/tg-chat-rag-client";
import { createToolProxyService } from "../tools/proxy-service";
import { handleMcpRequest, TransportError } from "../transport/mcp-transport";
import type { McpTransportDependencies } from "../transport/mcp-transport";

const PROTECTED_RESOURCE_METADATA_ROOT_PATH = "/.well-known/oauth-protected-resource";
const PROTECTED_RESOURCE_METADATA_MCP_PATH = "/.well-known/oauth-protected-resource/mcp";
const OAUTH_AUTHORIZATION_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";
const OPENID_CONFIGURATION_PATH = "/.well-known/openid-configuration";

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

// START_CONTRACT: isProtectedResourceMetadataPath
//   PURPOSE: Determine whether pathname matches OAuth protected resource metadata endpoints.
//   INPUTS: { pathname: string - Request URL pathname }
//   OUTPUTS: { boolean - True when path is /.well-known/oauth-protected-resource or /.well-known/oauth-protected-resource/mcp }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SERVER]
// END_CONTRACT: isProtectedResourceMetadataPath
function isProtectedResourceMetadataPath(pathname: string): boolean {
  // START_BLOCK_MATCH_PROTECTED_RESOURCE_METADATA_PATHS_M_SERVER_009
  return (
    pathname === PROTECTED_RESOURCE_METADATA_ROOT_PATH ||
    pathname === PROTECTED_RESOURCE_METADATA_MCP_PATH
  );
  // END_BLOCK_MATCH_PROTECTED_RESOURCE_METADATA_PATHS_M_SERVER_009
}

// START_CONTRACT: handleProtectedResourceMetadataRequest
//   PURPOSE: Serve OAuth protected resource metadata endpoints from initialized McpAuthContext payload.
//   INPUTS: { request: Request - Incoming request, pathname: string - Parsed pathname, authContext: McpAuthContext - Initialized auth context, logger: Logger - Route logger }
//   OUTPUTS: { Response | null - Metadata response for matched route or null for non-match }
//   SIDE_EFFECTS: [Emits structured route logs]
//   LINKS: [M-SERVER, M-MCP-AUTH-PROVIDER, M-LOGGER]
// END_CONTRACT: handleProtectedResourceMetadataRequest
function handleProtectedResourceMetadataRequest(
  request: Request,
  pathname: string,
  authContext: McpAuthContext,
  logger: Logger,
): Response | null {
  // START_BLOCK_HANDLE_PROTECTED_RESOURCE_METADATA_REQUEST_M_SERVER_010
  if (!isProtectedResourceMetadataPath(pathname)) {
    return null;
  }

  logger.info(
    "Matched OAuth protected resource metadata route.",
    "handleProtectedResourceMetadataRequest",
    "HANDLE_PROTECTED_RESOURCE_METADATA_REQUEST",
    {
      method: request.method,
      pathname,
    },
  );

  if (request.method !== "GET") {
    logger.warn(
      "Rejected non-GET request for protected resource metadata route.",
      "handleProtectedResourceMetadataRequest",
      "HANDLE_PROTECTED_RESOURCE_METADATA_REQUEST",
      {
        method: request.method,
        pathname,
      },
    );

    return new Response(
      JSON.stringify({
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "OAuth protected resource metadata endpoint supports GET only.",
        },
      }),
      {
        status: 405,
        headers: {
          "content-type": "application/json; charset=utf-8",
          Allow: "GET",
        },
      },
    );
  }

  return createJsonResponse(200, {
    ...authContext.protectedResourceMetadata,
  });
  // END_BLOCK_HANDLE_PROTECTED_RESOURCE_METADATA_REQUEST_M_SERVER_010
}

// START_CONTRACT: isDeniedMcpAuthDecision
//   PURPOSE: Narrow MCP auth decision union to denied-branch type for safe access to reason and response fields.
//   INPUTS: { decision: Awaited<ReturnType<typeof authorizeMcpRequest>> - Authorization decision from guard }
//   OUTPUTS: { decision is Extract<Awaited<ReturnType<typeof authorizeMcpRequest>>, { isAuthorized: false }> - True when auth decision is denied }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SERVER, M-MCP-AUTH-GUARD]
// END_CONTRACT: isDeniedMcpAuthDecision
function isDeniedMcpAuthDecision(
  decision: Awaited<ReturnType<typeof authorizeMcpRequest>>,
): decision is Extract<Awaited<ReturnType<typeof authorizeMcpRequest>>, { isAuthorized: false }> {
  // START_BLOCK_NARROW_DENIED_MCP_AUTH_DECISION_M_SERVER_011
  return !decision.isAuthorized;
  // END_BLOCK_NARROW_DENIED_MCP_AUTH_DECISION_M_SERVER_011
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
//   PURPOSE: Initialize runtime dependencies and start the Bun HTTP server for MCP, admin, and OAuth protected resource metadata routes.
//   INPUTS: {}
//   OUTPUTS: { Promise<Bun.Server> - Running Bun HTTP server instance }
//   SIDE_EFFECTS: [Reads environment config, opens network connections, registers process signal handlers, emits logs]
//   LINKS: [M-SERVER, M-CONFIG, M-LOGGER, M-ADMIN-UI, M-MCP-AUTH-PROVIDER, M-MCP-AUTH-GUARD, M-TRANSPORT, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY]
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
    const mcpLogger = logger.child({ route: "mcp" });
    const transportDeps: McpTransportDependencies = {
      logger: mcpLogger.child({ component: "transport" }),
      proxyService,
    };
    const adminDeps = {
      config,
      logger: logger.child({ route: "admin", component: "adminUiRoutes" }),
    };
    const mcpAuthContext = await initMcpAuth(
      config,
      mcpLogger.child({ component: "mcpAuthProvider" }),
    );
    const mcpAuthDeps: McpAuthGuardDependencies = {
      authContext: mcpAuthContext,
      audience: config.oauth.audience,
      requiredScopes: config.oauth.requiredScopes,
      logger: mcpLogger.child({ component: "mcpAuthGuard" }),
    };
    const oauthDiscoveryLogger = logger.child({
      route: "oauthDiscovery",
      component: "mcpAuthProviderMetadata",
    });
    // END_BLOCK_INITIALIZE_RUNTIME_DEPENDENCIES_M_SERVER_003

    // START_BLOCK_START_BUN_HTTP_SERVER_M_SERVER_004
    const server = Bun.serve({
      port: config.port,
      fetch: async (request: Request): Promise<Response> => {
        const url = new URL(request.url);

        // Log every incoming request for debugging
        logger.info(
          "Incoming HTTP request.",
          "main",
          "START_BUN_HTTP_SERVER",
          {
            method: request.method,
            pathname: url.pathname,
            authHeaderPresent: request.headers.get("authorization") !== null,
            origin: request.headers.get("origin") ?? null,
          },
        );

        if (request.method === "GET" && url.pathname === "/healthz") {
          return createJsonResponse(200, {
            status: "ok",
            service: "japan-travel-rag-mcp",
          });
        }

        const protectedResourceMetadataResponse = handleProtectedResourceMetadataRequest(
          request,
          url.pathname,
          mcpAuthContext,
          oauthDiscoveryLogger,
        );
        if (protectedResourceMetadataResponse !== null) {
          return protectedResourceMetadataResponse;
        }

        if (
          url.pathname === OAUTH_AUTHORIZATION_SERVER_METADATA_PATH ||
          url.pathname === OPENID_CONFIGURATION_PATH
        ) {
          if (request.method !== "GET") {
            return new Response(
              JSON.stringify({
                error: {
                  code: "METHOD_NOT_ALLOWED",
                  message: "OAuth authorization server metadata endpoint supports GET only.",
                },
              }),
              {
                status: 405,
                headers: {
                  "content-type": "application/json; charset=utf-8",
                  Allow: "GET",
                },
              },
            );
          }

          oauthDiscoveryLogger.info(
            "Serving delegated OAuth authorization server metadata.",
            "main",
            "SERVE_DELEGATED_AUTH_SERVER_METADATA",
            { pathname: url.pathname },
          );

          return createJsonResponse(200, mcpAuthContext.authorizationServerMetadata);
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

          try {
            authDecision = await authorizeMcpRequest(request, mcpAuthDeps);
          } catch (error: unknown) {
            logger.error(
              "MCP authorization guard failed due to internal error.",
              "main",
              "HANDLE_MCP_ROUTE_FAILURE",
              {
                cause: error instanceof Error ? error.message : String(error),
              },
            );
            return createJsonResponse(500, {
              error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "Unexpected authorization failure.",
              },
            });
          }

          if (isDeniedMcpAuthDecision(authDecision)) {
            logger.warn(
              "Rejected /mcp request due to failed authorization.",
              "main",
              "HANDLE_MCP_ROUTE_FAILURE",
              {
                reason: authDecision.reason,
              },
            );
            return authDecision.response;
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

        logger.warn(
          "No route matched request.",
          "main",
          "START_BUN_HTTP_SERVER",
          { method: request.method, pathname: url.pathname },
        );
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
      resourceMetadataUrl: mcpAuthContext.resourceMetadataUrl,
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
