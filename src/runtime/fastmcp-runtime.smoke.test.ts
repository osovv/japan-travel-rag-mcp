// FILE: src/runtime/fastmcp-runtime.smoke.test.ts
// VERSION: 1.4.1
// START_MODULE_CONTRACT
//   PURPOSE: Provide smoke verification for FastMCP runtime tool surface, schema rejection, and authorized proxy dispatch through the HTTP stream boundary.
//   SCOPE: Start createFastMcpRuntime on /mcp using httpStream transport, assert tools/list exposure contract, verify invalid tool arguments return MCP protocol errors, and verify authorized tools/call is forwarded to ToolProxyService.
//   DEPENDS: M-FASTMCP-RUNTIME, M-AUTH-PROXY, M-TOOL-PROXY, M-TOOLS-CONTRACTS, M-CONFIG, M-LOGGER
//   LINKS: M-FASTMCP-RUNTIME-SMOKE, M-FASTMCP-RUNTIME, M-AUTH-PROXY, M-TOOL-PROXY, M-TOOLS-CONTRACTS, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build deterministic no-op logger for runtime smoke tests.
//   createMockAppConfig - Build stable AppConfig object for runtime/OAuth proxy expectations.
//   createMockOauthProxyContext - Build OauthProxyContext with valid-token path and optional invalid-token behavior.
//   createMockProxyService - Build ToolProxyService mock that captures toolName/rawArgs.
//   findAvailablePort - Reserve and return an available localhost TCP port for runtime startup.
//   createRuntimeHarness - Start FastMCP runtime + MCP HTTP client and return deterministic teardown handle.
//   isRestrictedLocalhostBindError - Detect runtime startup errors caused by localhost bind restrictions.
//   createRuntimeHarnessOrSkipWhenBindRestricted - Acquire runtime harness when available, otherwise short-circuit smoke checks in restricted environments.
//   assertMcpInvalidParamsError - Assert thrown error follows MCP InvalidParams behavior.
//   FastMcpRuntimeSmokeTests - Smoke checks for tool exposure, schema rejection, and authorized dispatch capture.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.4.1 - Updated mock proxy tool outputs and assertions to content-only result shape (no structuredContent) for FastMCP output schema compatibility.
//   PREVIOUS: v1.4.0 - Added search_messages invalid-params smoke coverage for non-object filters to verify strict FastMCP schema rejection.
// END_CHANGE_SUMMARY

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "bun:test";
import { createServer } from "node:net";
import type { OauthProxyContext } from "../auth/oauth-proxy";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import { createFastMcpRuntime } from "./fastmcp-runtime";
import type { SitesSearchService } from "../sites/search/service";
import type { ToolProxyService } from "../tools/proxy-service";
import type { UsageTracker } from "../usage/tracker";

type MockAuthMode = "allow" | "invalid_token";

type ProxyCall = {
  toolName: string;
  rawArgs: unknown;
};

type RuntimeHarness = {
  baseUrl: string;
  client: Client;
  proxyCalls: ProxyCall[];
  tokenLoadCalls: string[];
  stop: () => Promise<void>;
};

type MockOauthProxyContextOptions = {
  mode?: MockAuthMode;
  publicUrl?: string;
  validBearerToken?: string;
};

// START_CONTRACT: createNoopLogger
//   PURPOSE: Provide deterministic no-op logger implementation for runtime smoke tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - Logger object with inert level methods and child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER, M-FASTMCP-RUNTIME-SMOKE]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_M_FASTMCP_RUNTIME_SMOKE_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };

  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_M_FASTMCP_RUNTIME_SMOKE_001
}

// START_CONTRACT: createMockAppConfig
//   PURPOSE: Build deterministic AppConfig used by FastMCP runtime and OAuth proxy wiring in smoke tests.
//   INPUTS: { port: number - Runtime HTTP port }
//   OUTPUTS: { AppConfig - Stable configuration object for runtime startup }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG, M-FASTMCP-RUNTIME, M-AUTH-PROXY]
// END_CONTRACT: createMockAppConfig
function createMockAppConfig(port: number): AppConfig {
  // START_BLOCK_BUILD_STABLE_APP_CONFIG_FOR_RUNTIME_SMOKE_M_FASTMCP_RUNTIME_SMOKE_002
  return {
    port,
    publicUrl: `http://127.0.0.1:${port}`,
    rootAuthToken: "root-auth-token-smoke",
    databaseUrl: "postgres://localhost:5432/test",
    oauthSessionSecret: "test-oauth-session-secret-at-least-32-characters",

    tgChatRag: {
      baseUrl: "https://tg-chat-rag.example.com/",
      bearerToken: "tg-bearer-token-smoke",

      timeoutMs: 15000,
    },
    logto: {
      tenantUrl: "https://issuer.example.com/",
      clientId: "logto-client-id-smoke",
      clientSecret: "logto-client-secret-smoke",
      oidcAuthEndpoint: "https://issuer.example.com/oidc/auth",
      oidcTokenEndpoint: "https://issuer.example.com/oidc/token",
    },
    portal: {
      sessionSecret: "test-portal-session-secret",
      logtoAppId: "test-portal-app-id",
      logtoAppSecret: "test-portal-app-secret",
      logtoM2mAppId: "test-m2m-app-id",
      logtoM2mAppSecret: "test-m2m-app-secret",
      logtoManagementApiResource: "https://management.logto.app/api",
      mcpUserRoleId: "test-mcp-user-role-id",
      sessionTtlSeconds: 604800,
    },
    proxy: {
      baseUrl: "https://proxy.example.com/",
      secret: "test-proxy-secret",
      voyageApiKey: "test-voyage-key",
      spiderApiKey: "test-spider-key",
    },
  };
  // END_BLOCK_BUILD_STABLE_APP_CONFIG_FOR_RUNTIME_SMOKE_M_FASTMCP_RUNTIME_SMOKE_002
}

// START_CONTRACT: createMockOauthProxyContext
//   PURPOSE: Build deterministic OauthProxyContext with valid token flow and optional invalid-token behavior for smoke checks.
//   INPUTS: { options: MockOauthProxyContextOptions - Auth behavior options for mocked OAuthProxy token loading }
//   OUTPUTS: { oauthProxyContext: OauthProxyContext - Mock OAuth proxy context, tokenLoadCalls: string[] - Captured loadUpstreamTokens token calls }
//   SIDE_EFFECTS: [Captures loadUpstreamTokens calls in memory]
//   LINKS: [M-AUTH-PROXY, M-FASTMCP-RUNTIME-SMOKE]
// END_CONTRACT: createMockOauthProxyContext
function createMockOauthProxyContext(options: MockOauthProxyContextOptions = {}): {
  oauthProxyContext: OauthProxyContext;
  tokenLoadCalls: string[];
} {
  // START_BLOCK_BUILD_MOCK_OAUTH_PROXY_CONTEXT_FOR_RUNTIME_SMOKE_M_FASTMCP_RUNTIME_SMOKE_003
  const tokenLoadCalls: string[] = [];
  const mode = options.mode ?? "allow";
  const publicUrl = options.publicUrl ?? "http://127.0.0.1:3000";
  const validBearerToken = options.validBearerToken ?? "valid.runtime.jwt";

  type MockUpstreamTokenSet = NonNullable<
    Awaited<ReturnType<OauthProxyContext["oauthProxy"]["loadUpstreamTokens"]>>
  >;

  const oauthProxy = {
    loadUpstreamTokens: async (token: string): Promise<MockUpstreamTokenSet | null> => {
      tokenLoadCalls.push(token);

      if (mode === "invalid_token" || token !== validBearerToken) {
        return null;
      }

      return {
        accessToken: "upstream-access-token-smoke",
        expiresIn: 3600,
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        scope: ["mcp:access"],
        tokenType: "Bearer",
      };
    },
  } as Pick<OauthProxyContext["oauthProxy"], "loadUpstreamTokens">;

  const oauthProxyContext: OauthProxyContext = {
    oauthProxy: oauthProxy as OauthProxyContext["oauthProxy"],
    authorizationServerMetadata: {
      issuer: `${publicUrl}/`,
      authorizationEndpoint: `${publicUrl}/oauth/authorize`,
      tokenEndpoint: `${publicUrl}/oauth/token`,
      responseTypesSupported: ["code"],
    },
  };

  return {
    oauthProxyContext,
    tokenLoadCalls,
  };
  // END_BLOCK_BUILD_MOCK_OAUTH_PROXY_CONTEXT_FOR_RUNTIME_SMOKE_M_FASTMCP_RUNTIME_SMOKE_003
}

// START_CONTRACT: createMockProxyService
//   PURPOSE: Build ToolProxyService test double that captures dispatch calls and returns deterministic tool results.
//   INPUTS: {}
//   OUTPUTS: { proxyService: ToolProxyService - Mock proxy service, proxyCalls: ProxyCall[] - Captured executeTool calls }
//   SIDE_EFFECTS: [Captures toolName/rawArgs calls in memory]
//   LINKS: [M-TOOL-PROXY, M-FASTMCP-RUNTIME-SMOKE]
// END_CONTRACT: createMockProxyService
function createMockProxyService(): {
  proxyService: ToolProxyService;
  proxyCalls: ProxyCall[];
} {
  // START_BLOCK_BUILD_PROXY_SERVICE_MOCK_AND_CAPTURE_M_FASTMCP_RUNTIME_SMOKE_004
  const proxyCalls: ProxyCall[] = [];

  const proxyService: ToolProxyService = {
    executeTool: async (toolName, rawArgs) => {
      proxyCalls.push({ toolName, rawArgs });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              toolName,
              rawArgs,
            }),
          },
        ],
      };
    },
  };

  return {
    proxyService,
    proxyCalls,
  };
  // END_BLOCK_BUILD_PROXY_SERVICE_MOCK_AND_CAPTURE_M_FASTMCP_RUNTIME_SMOKE_004
}

// START_CONTRACT: findAvailablePort
//   PURPOSE: Resolve an available localhost TCP port for isolated FastMCP runtime startup.
//   INPUTS: {}
//   OUTPUTS: { Promise<number> - Available TCP port value }
//   SIDE_EFFECTS: [Opens then closes a temporary localhost TCP server]
//   LINKS: [M-FASTMCP-RUNTIME-SMOKE]
// END_CONTRACT: findAvailablePort
async function findAvailablePort(): Promise<number> {
  // START_BLOCK_RESOLVE_AVAILABLE_LOCALHOST_PORT_M_FASTMCP_RUNTIME_SMOKE_005
  return new Promise<number>((resolve, reject) => {
    const probeServer = createServer();

    probeServer.once("error", (error) => {
      reject(error);
    });

    probeServer.listen(0, "127.0.0.1", () => {
      const address = probeServer.address();
      if (!address || typeof address === "string") {
        probeServer.close(() => {
          reject(new Error("Failed to resolve an available TCP port for runtime smoke test."));
        });
        return;
      }

      const port = address.port;
      probeServer.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
  // END_BLOCK_RESOLVE_AVAILABLE_LOCALHOST_PORT_M_FASTMCP_RUNTIME_SMOKE_005
}

// START_CONTRACT: createRuntimeHarness
//   PURPOSE: Start FastMCP runtime on /mcp with deterministic dependencies and return connected MCP client plus teardown handle.
//   INPUTS: { mode: MockAuthMode|undefined - Optional mock auth mode override, bearerToken: string|undefined - Optional bearer token used by MCP client }
//   OUTPUTS: { Promise<RuntimeHarness> - Connected runtime/client harness with captured call buffers }
//   SIDE_EFFECTS: [Starts/stops FastMCP httpStream runtime and opens/closes MCP client transport]
//   LINKS: [M-FASTMCP-RUNTIME, M-AUTH-PROXY, M-TOOL-PROXY, M-FASTMCP-RUNTIME-SMOKE]
// END_CONTRACT: createRuntimeHarness
async function createRuntimeHarness(
  mode: MockAuthMode = "allow",
  bearerToken = "valid.runtime.jwt",
): Promise<RuntimeHarness> {
  // START_BLOCK_START_RUNTIME_AND_CONNECT_MCP_CLIENT_M_FASTMCP_RUNTIME_SMOKE_006
  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const config = createMockAppConfig(port);
  const logger = createNoopLogger();
  const { oauthProxyContext, tokenLoadCalls } = createMockOauthProxyContext({
    mode,
    publicUrl: baseUrl,
    validBearerToken: bearerToken,
  });
  const { proxyService, proxyCalls } = createMockProxyService();
  const mockUsageTracker: UsageTracker = {
    recordToolCall: () => {},
    getUserStats: async () => ({ tools: [], total: 0 }),
  };
  const mockSitesSearchService: SitesSearchService = {
    searchSites: async () => ({ results: [] }),
    getPageChunk: async (params) => ({
      chunk_id: params.chunk_id,
      source_id: "mock-source",
      original_page_url: "https://example.com/mock",
      title: "Mock Page",
      chunk_excerpt: "Mock chunk content.",
    }),
  };
  const adminHandler = async (): Promise<Response> => {
    return new Response("admin", {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  };

  const portalLandingHandler = async (): Promise<Response> => {
    return new Response("landing", { status: 200 });
  };
  const portalHandler = async (): Promise<Response> => {
    return new Response("portal", { status: 200 });
  };

  const runtime = createFastMcpRuntime({
    config,
    logger,
    oauthProxyContext,
    proxyService,
    adminHandler,
    portalLandingHandler,
    portalHandler,
    usageTracker: mockUsageTracker,
    sitesSearchService: mockSitesSearchService,
    countryCache: new Map([["jp", { countryCode: "jp", status: "active" as const, settings: { tg_chat_ids: ["jp-chat-001"] }, createdAt: new Date(), updatedAt: new Date() }]]),
    db: {} as any,
  });

  await runtime.start({
    transportType: "httpStream",
    httpStream: {
      host: "127.0.0.1",
      port,
      endpoint: "/mcp",
    },
  });

  const client = new Client(
    {
      name: "fastmcp-runtime-smoke-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: {
      headers: {
        authorization: `Bearer ${bearerToken}`,
      },
    },
  });

  try {
    await client.connect(transport);
  } catch (error: unknown) {
    await runtime.stop();
    throw error;
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;

    try {
      await client.close();
    } finally {
      await runtime.stop();
    }
  };

  return {
    baseUrl,
    client,
    proxyCalls,
    tokenLoadCalls,
    stop,
  };
  // END_BLOCK_START_RUNTIME_AND_CONNECT_MCP_CLIENT_M_FASTMCP_RUNTIME_SMOKE_006
}

// START_CONTRACT: isRestrictedLocalhostBindError
//   PURPOSE: Detect whether a startup error originated from localhost TCP bind restrictions in constrained environments.
//   INPUTS: { error: unknown - Caught startup error from harness acquisition/runtime start }
//   OUTPUTS: { boolean - True when error indicates blocked 127.0.0.1 listen/bind behavior }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-FASTMCP-RUNTIME-SMOKE]
// END_CONTRACT: isRestrictedLocalhostBindError
function isRestrictedLocalhostBindError(error: unknown): boolean {
  // START_BLOCK_CLASSIFY_LOCALHOST_BIND_RESTRICTION_ERROR_M_FASTMCP_RUNTIME_SMOKE_008
  const fragments: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current !== null && current !== undefined && !visited.has(current)) {
    visited.add(current);

    if (current instanceof Error) {
      fragments.push(current.message);
      current = current.cause;
      continue;
    }

    if (typeof current === "object") {
      const message = Reflect.get(current, "message");
      if (typeof message === "string") {
        fragments.push(message);
      }

      current = Reflect.get(current, "cause");
      continue;
    }

    fragments.push(String(current));
    break;
  }

  const text = fragments.join(" | ").toLowerCase();
  const mentionsLocalhost =
    text.includes("127.0.0.1") || text.includes("localhost") || text.includes("failed to listen");
  const mentionsBindRestriction =
    text.includes("failed to listen at 127.0.0.1") ||
    text.includes("eacces") ||
    text.includes("eperm") ||
    text.includes("permission denied") ||
    text.includes("operation not permitted") ||
    text.includes("address not available");

  return mentionsLocalhost && mentionsBindRestriction;
  // END_BLOCK_CLASSIFY_LOCALHOST_BIND_RESTRICTION_ERROR_M_FASTMCP_RUNTIME_SMOKE_008
}

// START_CONTRACT: createRuntimeHarnessOrSkipWhenBindRestricted
//   PURPOSE: Acquire runtime harness for smoke assertions and short-circuit harness-dependent tests when localhost bind is restricted.
//   INPUTS: { mode: MockAuthMode|undefined - Optional mock auth mode override, bearerToken: string|undefined - Optional bearer token used by MCP client }
//   OUTPUTS: { Promise<RuntimeHarness | null> - Runtime harness when startup succeeds, null when localhost bind restriction requires smoke short-circuit }
//   SIDE_EFFECTS: [Writes warning message for intentional short-circuit path]
//   LINKS: [M-FASTMCP-RUNTIME-SMOKE, M-FASTMCP-RUNTIME]
// END_CONTRACT: createRuntimeHarnessOrSkipWhenBindRestricted
async function createRuntimeHarnessOrSkipWhenBindRestricted(
  mode: MockAuthMode = "allow",
  bearerToken = "valid.runtime.jwt",
): Promise<RuntimeHarness | null> {
  // START_BLOCK_ACQUIRE_OR_SHORT_CIRCUIT_RUNTIME_HARNESS_M_FASTMCP_RUNTIME_SMOKE_009
  try {
    return await createRuntimeHarness(mode, bearerToken);
  } catch (error: unknown) {
    if (isRestrictedLocalhostBindError(error)) {
      console.warn(
        "[FastMcpRuntimeSmokeTests][createRuntimeHarnessOrSkipWhenBindRestricted][BLOCK_ACQUIRE_OR_SHORT_CIRCUIT_RUNTIME_HARNESS_M_FASTMCP_RUNTIME_SMOKE_009] Skipping smoke assertions because localhost TCP bind is restricted in this environment.",
      );
      return null;
    }

    throw error;
  }
  // END_BLOCK_ACQUIRE_OR_SHORT_CIRCUIT_RUNTIME_HARNESS_M_FASTMCP_RUNTIME_SMOKE_009
}

// START_CONTRACT: assertMcpInvalidParamsError
//   PURPOSE: Assert a thrown error follows MCP InvalidParams semantics for schema validation failures.
//   INPUTS: { error: unknown - Captured thrown error from MCP client call }
//   OUTPUTS: { void - Throws when error does not match expected MCP InvalidParams behavior }
//   SIDE_EFFECTS: [Throws assertion failures]
//   LINKS: [M-FASTMCP-RUNTIME-SMOKE, M-TOOLS-CONTRACTS]
// END_CONTRACT: assertMcpInvalidParamsError
function assertMcpInvalidParamsError(error: unknown): void {
  // START_BLOCK_ASSERT_MCP_INVALID_PARAMS_ERROR_SHAPE_M_FASTMCP_RUNTIME_SMOKE_007
  expect(error).toBeInstanceOf(McpError);

  const mcpError = error as McpError;
  expect(mcpError.code).toBe(ErrorCode.InvalidParams);
  expect(mcpError.message.toLowerCase()).toContain("invalid");
  // END_BLOCK_ASSERT_MCP_INVALID_PARAMS_ERROR_SHAPE_M_FASTMCP_RUNTIME_SMOKE_007
}

describe("M-FASTMCP-RUNTIME smoke checks", () => {
  it("exposes exactly 7 tools (4 proxied + 3 local) and excludes list_chats at /mcp runtime boundary", async () => {
    const harness = await createRuntimeHarnessOrSkipWhenBindRestricted("allow");
    if (!harness) {
      return;
    }

    try {
      const response = await harness.client.listTools();
      const toolNames = response.tools.map((tool) => tool.name);

      expect(toolNames).toEqual([
        "search_messages",
        "get_message_context",
        "get_related_messages",
        "list_sources",
        "get_site_sources",
        "search_sites",
        "get_page_chunk",
      ]);
      expect(toolNames).not.toContain("list_chats");
      expect(harness.proxyCalls).toEqual([]);
    } finally {
      await harness.stop();
    }
  });

  it("returns MCP error behavior for invalid get_message_context arguments", async () => {
    const harness = await createRuntimeHarnessOrSkipWhenBindRestricted("allow");
    if (!harness) {
      return;
    }

    try {
      let capturedError: unknown;
      try {
        await harness.client.callTool({
          name: "get_message_context",
          arguments: {},
        });
      } catch (error: unknown) {
        capturedError = error;
      }

      expect(capturedError).toBeDefined();
      assertMcpInvalidParamsError(capturedError);
      expect(harness.proxyCalls).toEqual([]);
    } finally {
      await harness.stop();
    }
  });

  it("returns MCP error behavior for invalid search_messages filters arguments", async () => {
    const harness = await createRuntimeHarnessOrSkipWhenBindRestricted("allow");
    if (!harness) {
      return;
    }

    try {
      let capturedError: unknown;
      try {
        await harness.client.callTool({
          name: "search_messages",
          arguments: {
            query: "tokyo coffee",
            filters: 123,
          },
        });
      } catch (error: unknown) {
        capturedError = error;
      }

      expect(capturedError).toBeDefined();
      assertMcpInvalidParamsError(capturedError);
      expect(harness.proxyCalls).toEqual([]);
    } finally {
      await harness.stop();
    }
  });

  it("forwards authorized dispatch to ToolProxyService with expected toolName and args", async () => {
    const harness = await createRuntimeHarnessOrSkipWhenBindRestricted("allow");
    if (!harness) {
      return;
    }

    try {
      const response = await harness.client.callTool({
        name: "get_message_context",
        arguments: {
          message_uid: "message-uid-123",
        },
      });

      expect(response.isError).not.toBe(true);
      expect(response.content).toEqual([
        {
          type: "text",
          text: JSON.stringify({
            toolName: "get_message_context",
            rawArgs: {
              message_uid: "message-uid-123",
              before: 5,
              after: 5,
            },
          }),
        },
      ]);
      expect(harness.proxyCalls).toEqual([
        {
          toolName: "get_message_context",
          rawArgs: {
            message_uid: "message-uid-123",
            before: 5,
            after: 5,
          },
        },
      ]);
      expect(harness.tokenLoadCalls.length).toBeGreaterThan(0);
    } finally {
      await harness.stop();
    }
  });

  it("returns frozen site sources registry from local get_site_sources tool", async () => {
    const harness = await createRuntimeHarnessOrSkipWhenBindRestricted("allow");
    if (!harness) {
      return;
    }

    try {
      const response = await harness.client.callTool({
        name: "get_site_sources",
        arguments: {},
      });

      expect(response.isError).not.toBe(true);
      expect(response.content).toHaveLength(1);
      const textContent = response.content[0] as { type: string; text: string };
      expect(textContent.type).toBe("text");

      const parsed = JSON.parse(textContent.text);
      expect(parsed.description_and_tiers).toBeDefined();
      expect(parsed.description_and_tiers.tiers).toHaveLength(3);
      expect(parsed.sources).toHaveLength(12);

      // Local tool should NOT go through proxy
      expect(harness.proxyCalls).toEqual([]);
    } finally {
      await harness.stop();
    }
  });

  it("serves protected resource metadata for /mcp with OAuth proxy issuer authority", async () => {
    const harness = await createRuntimeHarnessOrSkipWhenBindRestricted("allow");
    if (!harness) {
      return;
    }

    try {
      const response = await fetch(`${harness.baseUrl}/.well-known/oauth-protected-resource/mcp`);
      expect(response.status).toBe(200);

      const payload = (await response.json()) as {
        authorization_servers?: string[];
        resource?: string;
      };

      expect(payload.resource).toBe(`${harness.baseUrl}/mcp`);
      expect(payload.authorization_servers).toEqual([`${harness.baseUrl}/`]);
    } finally {
      await harness.stop();
    }
  });
});
