// FILE: src/server/index.ts
// VERSION: 3.6.0
// START_MODULE_CONTRACT
//   PURPOSE: Bootstrap runtime dependencies, construct FastMCP server with MCP, admin, and portal surfaces, and start HTTP stream transport on /mcp.
//   SCOPE: Load config/logger, initialize database client/OAuth proxy/upstream proxy/portal identity/admin handler/portal handler/sites search service/country cache dependencies, construct FastMCP runtime, start httpStream transport, and manage graceful shutdown.
//   DEPENDS: M-CONFIG, M-LOGGER, M-DB, M-AUTH-PROXY, M-ADMIN-UI, M-ADMIN-SITES, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY, M-FASTMCP-RUNTIME, M-PORTAL-IDENTITY, M-PORTAL-UI, M-USAGE-TRACKER, M-SITES-SEARCH, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-DB-SITES-BOOTSTRAP, M-COUNTRY-SETTINGS, M-TOOLS-CONTRACTS
//   LINKS: M-SERVER, M-CONFIG, M-LOGGER, M-DB, M-AUTH-PROXY, M-ADMIN-UI, M-ADMIN-SITES, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY, M-FASTMCP-RUNTIME, M-PORTAL-IDENTITY, M-PORTAL-UI, M-USAGE-TRACKER, M-SITES-SEARCH, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-DB-SITES-BOOTSTRAP, M-COUNTRY-SETTINGS, M-TOOLS-CONTRACTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ServerStartError - Typed startup failure error with SERVER_START_ERROR code.
//   stopRuntime - Stop FastMCP runtime with deterministic logs.
//   installGracefulShutdownHandlers - Register SIGINT/SIGTERM handlers with idempotent shutdown guard.
//   main - Application entrypoint that initializes dependencies and starts FastMCP httpStream runtime at /mcp with admin and portal surfaces.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v3.6.0 - Added db handle to PortalUiDependencies for destination list rendering from country_settings.
//   v3.5.0 - Built country cache and tool schemas at startup, passed countryCache and db into FastMCP runtime dependencies for multi-tenant country routing.
//   v3.4.0 - Pass db handle into AdminUiDependencies for sites management routes.
//   v3.3.0 - Wired SitesSearchService (VoyageProxyClient, SitesIndexRepository) into FastMCP runtime dependencies with bootstrapSitesSchema.
// END_CHANGE_SUMMARY

import { type FastMCP } from "fastmcp";
import type { Pool } from "pg";
import { handleAdminRequest } from "../admin/ui-routes";
import { createOauthProxy } from "../auth/oauth-proxy";
import { loadConfig } from "../config/index";
import { createDb } from "../db/index";
import type { DbClient } from "../db/index";
import { createTgChatRagClient } from "../integrations/tg-chat-rag-client";
import { createLogger } from "../logger/index";
import type { Logger } from "../logger/index";
import { createPortalIdentityClient } from "../portal/identity-client";
import {
  handleLandingRequest,
  handlePortalRootRoute,
  handlePortalRegisterRoute,
  handlePortalLoginRoute,
  handlePortalOauthStartRoute,
  handlePortalOauthCallbackRoute,
  handlePortalHomeRoute,
  handlePortalAgentSetupRoute,
  handlePortalLogoutRoute,
} from "../portal/ui-routes";
import type { PortalUiDependencies } from "../portal/ui-routes";
import { buildCountryCache } from "../countries/index";
import { bootstrapSitesSchema } from "../db/sites-bootstrap";
import { createVoyageProxyClient } from "../integrations/voyage-proxy-client";
import { buildToolSchemas } from "../tools/contracts";
import { createFastMcpRuntime } from "../runtime/fastmcp-runtime";
import { createSitesIndexRepository } from "../sites/search/repository";
import { createSitesSearchService } from "../sites/search/service";
import { createToolProxyService } from "../tools/proxy-service";
import { createUsageTracker } from "../usage/tracker";

type ShutdownTarget = {
  fastMcpServer: FastMCP | null;
  dbPool: Pool | null;
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
//   PURPOSE: Stop FastMCP runtime and database pool in deterministic order with idempotent target clearing.
//   INPUTS: { shutdownTarget: ShutdownTarget - Mutable runtime handle, logger: Logger - Server logger, reason: ShutdownReason - Shutdown trigger label }
//   OUTPUTS: { Promise<void> - Resolves after stop attempts complete }
//   SIDE_EFFECTS: [Calls FastMCP.stop(), closes database pool, mutates shutdownTarget handles to null, emits structured logs]
//   LINKS: [M-SERVER, M-FASTMCP-RUNTIME, M-DB, M-LOGGER]
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

  // START_BLOCK_CLOSE_DATABASE_POOL_M_SERVER_106
  const poolToClose = shutdownTarget.dbPool;

  shutdownTarget.dbPool = null;

  if (poolToClose !== null) {
    try {
      await poolToClose.end();
      logger.info(
        "Closed database connection pool.",
        "stopRuntime",
        "CLOSE_DATABASE_POOL",
        { reason },
      );
    } catch (error: unknown) {
      logger.error(
        "Failed while closing database connection pool.",
        "stopRuntime",
        "CLOSE_DATABASE_POOL",
        {
          reason,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
  // END_BLOCK_CLOSE_DATABASE_POOL_M_SERVER_106
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
//   SIDE_EFFECTS: [Reads env config, initializes database client and oauth proxy metadata and upstream dependencies, bootstraps usage_counters and sites schema, initializes SitesSearchService, opens network listeners, registers process signal handlers, emits logs]
//   LINKS: [M-SERVER, M-CONFIG, M-LOGGER, M-DB, M-AUTH-PROXY, M-TG-CHAT-RAG-CLIENT, M-TOOL-PROXY, M-FASTMCP-RUNTIME, M-ADMIN-UI, M-PORTAL-UI, M-USAGE-TRACKER, M-SITES-SEARCH, M-VOYAGE-PROXY-CLIENT, M-SITES-INDEX-REPOSITORY, M-DB-SITES-BOOTSTRAP]
// END_CONTRACT: main
export async function main(): Promise<FastMCP> {
  const shutdownTarget: ShutdownTarget = {
    fastMcpServer: null,
    dbPool: null,
  };
  let logger: Logger | null = null;

  // START_BLOCK_BOOTSTRAP_FASTMCP_SERVER_RUNTIME_M_SERVER_103
  try {
    const config = loadConfig();
    logger = createLogger(config, "ServerMain");

    if (config.devMode) {
      logger.warn(
        "Running in DEV_MODE — external service configs use placeholders. Portal, auth, and ingestion features will not work.",
        "main",
        "DEV_MODE_ACTIVE",
        {},
      );
    }

    logger.info(
      "Loaded runtime config and logger; initializing dependencies.",
      "main",
      "BOOTSTRAP_FASTMCP_SERVER_RUNTIME",
      { port: config.port, devMode: config.devMode },
    );

    // START_BLOCK_BOOTSTRAP_DATABASE_CLIENT_M_SERVER_107
    const dbClient: DbClient = await createDb(config, logger.child({ component: "db" }));
    shutdownTarget.dbPool = dbClient.pool;
    // END_BLOCK_BOOTSTRAP_DATABASE_CLIENT_M_SERVER_107

    // START_BLOCK_BOOTSTRAP_USAGE_TRACKER_M_SERVER_108
    // Create usage tracker with auto-schema bootstrap
    const usageTracker = await createUsageTracker({
      db: dbClient.db,
      logger: logger.child({ component: "usageTracker" }),
    });
    // END_BLOCK_BOOTSTRAP_USAGE_TRACKER_M_SERVER_108

    // START_BLOCK_BOOTSTRAP_SITES_SEARCH_SERVICE_M_SERVER_109
    await bootstrapSitesSchema(dbClient.db, logger.child({ component: "sitesBootstrap" }));

    const voyageClient = createVoyageProxyClient(config, logger.child({ component: "voyageClient" }));
    const sitesRepository = createSitesIndexRepository(dbClient.db, logger.child({ component: "sitesRepository" }));
    const sitesSearchService = createSitesSearchService({
      voyageClient,
      repository: sitesRepository,
      logger: logger.child({ component: "sitesSearch" }),
    });
    // END_BLOCK_BOOTSTRAP_SITES_SEARCH_SERVICE_M_SERVER_109

    // START_BLOCK_BOOTSTRAP_COUNTRY_CACHE_M_SERVER_110
    const countryCache = await buildCountryCache(
      dbClient.db,
      logger.child({ component: "countrySettings" }),
    );
    const activeCountryCodes = Array.from(countryCache.keys());
    const toolSchemas = buildToolSchemas(activeCountryCodes);
    logger.info(
      "Built country cache and tool schemas.",
      "main",
      "BOOTSTRAP_COUNTRY_CACHE",
      { activeCountries: activeCountryCodes, toolSchemaCount: Object.keys(toolSchemas).length },
    );
    // END_BLOCK_BOOTSTRAP_COUNTRY_CACHE_M_SERVER_110

    const tgClient = createTgChatRagClient(config, logger.child({ component: "tgChatRagClient" }));
    const proxyService = createToolProxyService(
      config,
      logger.child({ component: "toolProxyService" }),
      tgClient,
    );
    const oauthProxyContext = createOauthProxy({
      config,
      logger: logger.child({ component: "oauthProxy" }),
      db: dbClient.db,
    });

    const adminDeps = {
      config,
      logger: logger.child({ route: "admin", component: "adminUiRoutes" }),
      db: dbClient.db,
    };
    const adminHandler = async (request: Request): Promise<Response> => {
      return handleAdminRequest(request, adminDeps);
    };

    // START_BLOCK_CONSTRUCT_PORTAL_DEPENDENCIES_M_SERVER_105
    const identityClient = createPortalIdentityClient(
      config,
      logger.child({ component: "portalIdentityClient" }),
    );
    const portalDeps: PortalUiDependencies = {
      config,
      logger: logger.child({ route: "portal", component: "portalUiRoutes" }),
      identityClient,
      usageTracker,
      db: dbClient.db,
    };

    const portalLandingHandler = async (request: Request): Promise<Response> => {
      return handleLandingRequest(request, portalDeps);
    };

    const portalHandler = async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const method = request.method.toUpperCase();

      if (pathname === "/portal" && method === "GET") {
        return handlePortalRootRoute(request, portalDeps);
      }
      if (pathname === "/portal/register" && method === "GET") {
        return handlePortalRegisterRoute(request, portalDeps);
      }
      if (pathname === "/portal/login" && method === "GET") {
        return handlePortalLoginRoute(request, portalDeps);
      }
      if (pathname === "/portal/auth/start" && method === "GET") {
        return handlePortalOauthStartRoute(request, portalDeps);
      }
      if (pathname === "/portal/auth/callback" && method === "GET") {
        return handlePortalOauthCallbackRoute(request, portalDeps);
      }
      if (pathname === "/portal/home" && method === "GET") {
        return handlePortalHomeRoute(request, portalDeps);
      }
      if (pathname === "/portal/integrations/agent-setup" && method === "GET") {
        return handlePortalAgentSetupRoute(request, portalDeps);
      }
      if (pathname === "/portal/logout" && method === "POST") {
        return handlePortalLogoutRoute(request, portalDeps);
      }

      return new Response("Not Found", { status: 404 });
    };
    // END_BLOCK_CONSTRUCT_PORTAL_DEPENDENCIES_M_SERVER_105

    const fastMcpServer = createFastMcpRuntime({
      config,
      logger: logger.child({ component: "fastMcpRuntime" }),
      oauthProxyContext,
      proxyService,
      adminHandler,
      portalLandingHandler,
      portalHandler,
      usageTracker,
      sitesSearchService,
      countryCache,
      db: dbClient.db,
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
      // logger is null only if loadConfig() or createLogger() threw.
      // createDb is called after logger, so dbPool is always null here.
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
