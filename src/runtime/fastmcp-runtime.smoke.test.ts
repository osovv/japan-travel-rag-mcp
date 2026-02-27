// FILE: src/runtime/fastmcp-runtime.smoke.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Provide smoke verification for FastMCP runtime tool surface, schema rejection, and authorized proxy dispatch through the HTTP stream boundary.
//   SCOPE: Start createFastMcpRuntime on /mcp using httpStream transport, assert tools/list exposure contract, verify invalid tool arguments return MCP protocol errors, and verify authorized tools/call is forwarded to ToolProxyService.
//   DEPENDS: M-FASTMCP-RUNTIME, M-MCP-AUTH-ADAPTER, M-MCP-AUTH-PROVIDER, M-TOOL-PROXY, M-TOOLS-CONTRACTS, M-CONFIG, M-LOGGER
//   LINKS: M-FASTMCP-RUNTIME-SMOKE, M-FASTMCP-RUNTIME, M-MCP-AUTH-ADAPTER, M-MCP-AUTH-PROVIDER, M-TOOL-PROXY, M-TOOLS-CONTRACTS, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build deterministic no-op logger for runtime smoke tests.
//   createMockAppConfig - Build stable AppConfig object for runtime/auth adapter expectations.
//   createMockAuthContext - Build McpAuthContext with valid-token path and optional invalid-token behavior.
//   createMockProxyService - Build ToolProxyService mock that captures toolName/rawArgs.
//   findAvailablePort - Reserve and return an available localhost TCP port for runtime startup.
//   createRuntimeHarness - Start FastMCP runtime + MCP HTTP client and return deterministic teardown handle.
//   assertMcpInvalidParamsError - Assert thrown error follows MCP InvalidParams behavior.
//   FastMcpRuntimeSmokeTests - Smoke checks for tool exposure, schema rejection, and authorized dispatch capture.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Implemented Phase-7 Step-5 FastMCP runtime smoke tests through /mcp httpStream boundary with deterministic dependency mocks and teardown safety.
// END_CHANGE_SUMMARY

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "bun:test";
import { MCPAuthTokenVerificationError } from "mcp-auth";
import { createServer } from "node:net";
import type { McpAuthContext } from "../auth/mcp-auth-provider";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import { createFastMcpRuntime } from "./fastmcp-runtime";
import type { ToolProxyService } from "../tools/proxy-service";

type MockAuthMode = "allow" | "invalid_token";

type ProxyCall = {
  toolName: string;
  rawArgs: unknown;
};

type RuntimeHarness = {
  client: Client;
  proxyCalls: ProxyCall[];
  verifyCalls: string[];
  stop: () => Promise<void>;
};

type MockAuthContextOptions = {
  mode?: MockAuthMode;
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
//   PURPOSE: Build deterministic AppConfig used by FastMCP runtime and auth adapter in smoke tests.
//   INPUTS: { port: number - Runtime HTTP port }
//   OUTPUTS: { AppConfig - Stable configuration object for runtime startup }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG, M-FASTMCP-RUNTIME, M-MCP-AUTH-ADAPTER]
// END_CONTRACT: createMockAppConfig
function createMockAppConfig(port: number): AppConfig {
  // START_BLOCK_BUILD_STABLE_APP_CONFIG_FOR_RUNTIME_SMOKE_M_FASTMCP_RUNTIME_SMOKE_002
  return {
    port,
    publicUrl: `http://127.0.0.1:${port}`,
    rootAuthToken: "root-auth-token-smoke",
    databaseUrl: "postgres://user:pass@localhost:5432/japan_travel_smoke",
    oauth: {
      issuer: "https://issuer.example.com/",
      audience: "travel-mcp",
      requiredScopes: ["mcp:access"],
    },
    tgChatRag: {
      baseUrl: "https://tg-chat-rag.example.com/",
      bearerToken: "tg-bearer-token-smoke",
      chatIds: ["jp-chat-001"],
      timeoutMs: 15000,
    },
  };
  // END_BLOCK_BUILD_STABLE_APP_CONFIG_FOR_RUNTIME_SMOKE_M_FASTMCP_RUNTIME_SMOKE_002
}

// START_CONTRACT: createMockAuthContext
//   PURPOSE: Build deterministic McpAuthContext with valid token flow and optional invalid-token behavior for smoke checks.
//   INPUTS: { options: MockAuthContextOptions - Auth behavior options for mocked token verification }
//   OUTPUTS: { authContext: McpAuthContext - Mock auth context, verifyCalls: string[] - Captured verifyAccessToken token calls }
//   SIDE_EFFECTS: [Captures verifyAccessToken calls in memory]
//   LINKS: [M-MCP-AUTH-PROVIDER, M-MCP-AUTH-ADAPTER, M-FASTMCP-RUNTIME-SMOKE]
// END_CONTRACT: createMockAuthContext
function createMockAuthContext(options: MockAuthContextOptions = {}): {
  authContext: McpAuthContext;
  verifyCalls: string[];
} {
  // START_BLOCK_BUILD_MOCK_AUTH_CONTEXT_FOR_RUNTIME_SMOKE_M_FASTMCP_RUNTIME_SMOKE_003
  const verifyCalls: string[] = [];
  const mode = options.mode ?? "allow";
  const validBearerToken = options.validBearerToken ?? "valid.runtime.jwt";

  const authContext: McpAuthContext = {
    mcpAuth: {} as McpAuthContext["mcpAuth"],
    verifyAccessToken: async (token: string): Promise<AuthInfo> => {
      verifyCalls.push(token);

      if (mode === "invalid_token" || token !== validBearerToken) {
        throw new MCPAuthTokenVerificationError("invalid_token");
      }

      return {
        token,
        issuer: "https://issuer.example.com/",
        audience: "travel-mcp",
        clientId: "runtime-smoke-client",
        scopes: ["mcp:access"],
        subject: "runtime-smoke-subject",
        claims: {
          scope: "mcp:access",
        },
      };
    },
    validateIssuer: (issuer: string): void => {
      if (issuer !== "https://issuer.example.com/") {
        throw new Error(`Unexpected issuer in smoke auth context: ${issuer}`);
      }
    },
    resourceMetadataUrl: "https://travel.example.com/.well-known/oauth-protected-resource/mcp",
    protectedResourceMetadata: {
      resource: "https://travel.example.com/mcp",
      authorization_servers: ["https://issuer.example.com/"],
      scopes_supported: ["mcp:access"],
      bearer_methods_supported: ["header"],
    },
    authorizationServerMetadata: {
      issuer: "https://issuer.example.com/",
      authorization_endpoint: "https://issuer.example.com/authorize",
      token_endpoint: "https://issuer.example.com/token",
      response_types_supported: ["code"],
      jwks_uri: "https://issuer.example.com/jwks",
    },
  };

  return {
    authContext,
    verifyCalls,
  };
  // END_BLOCK_BUILD_MOCK_AUTH_CONTEXT_FOR_RUNTIME_SMOKE_M_FASTMCP_RUNTIME_SMOKE_003
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
        structuredContent: {
          toolName,
          rawArgs,
        },
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
//   LINKS: [M-FASTMCP-RUNTIME, M-MCP-AUTH-ADAPTER, M-MCP-AUTH-PROVIDER, M-TOOL-PROXY, M-FASTMCP-RUNTIME-SMOKE]
// END_CONTRACT: createRuntimeHarness
async function createRuntimeHarness(
  mode: MockAuthMode = "allow",
  bearerToken = "valid.runtime.jwt",
): Promise<RuntimeHarness> {
  // START_BLOCK_START_RUNTIME_AND_CONNECT_MCP_CLIENT_M_FASTMCP_RUNTIME_SMOKE_006
  const port = await findAvailablePort();
  const config = createMockAppConfig(port);
  const logger = createNoopLogger();
  const { authContext, verifyCalls } = createMockAuthContext({
    mode,
    validBearerToken: bearerToken,
  });
  const { proxyService, proxyCalls } = createMockProxyService();
  const adminHandler = async (): Promise<Response> => {
    return new Response("admin", {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  };

  const runtime = createFastMcpRuntime({
    config,
    logger,
    authContext,
    proxyService,
    adminHandler,
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
    client,
    proxyCalls,
    verifyCalls,
    stop,
  };
  // END_BLOCK_START_RUNTIME_AND_CONNECT_MCP_CLIENT_M_FASTMCP_RUNTIME_SMOKE_006
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
  it("exposes exactly 4 tools and excludes list_chats at /mcp runtime boundary", async () => {
    const harness = await createRuntimeHarness("allow");

    try {
      const response = await harness.client.listTools();
      const toolNames = response.tools.map((tool) => tool.name);

      expect(toolNames).toEqual([
        "search_messages",
        "get_message_context",
        "get_related_messages",
        "list_sources",
      ]);
      expect(toolNames).not.toContain("list_chats");
      expect(harness.proxyCalls).toEqual([]);
    } finally {
      await harness.stop();
    }
  });

  it("returns MCP error behavior for invalid get_message_context arguments", async () => {
    const harness = await createRuntimeHarness("allow");

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

  it("forwards authorized dispatch to ToolProxyService with expected toolName and args", async () => {
    const harness = await createRuntimeHarness("allow");

    try {
      const response = await harness.client.callTool({
        name: "get_message_context",
        arguments: {
          message_uid: "message-uid-123",
        },
      });

      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toEqual({
        toolName: "get_message_context",
        rawArgs: {
          message_uid: "message-uid-123",
        },
      });
      expect(harness.proxyCalls).toEqual([
        {
          toolName: "get_message_context",
          rawArgs: {
            message_uid: "message-uid-123",
          },
        },
      ]);
      expect(harness.verifyCalls.length).toBeGreaterThan(0);
    } finally {
      await harness.stop();
    }
  });
});
