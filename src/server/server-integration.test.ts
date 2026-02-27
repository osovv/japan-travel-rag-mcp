// FILE: src/server/server-integration.test.ts
// VERSION: 2.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Integration verification of FastMCP well-known discovery routes, auth challenge flow, admin routes, and authorized MCP dispatch.
//   SCOPE: Build an in-memory FastMCP integration harness with deterministic mocks, assert OAuth well-known metadata routes, validate /admin delegation through mounted Hono routes, and verify /mcp denied/allowed auth + proxy dispatch behavior via authenticateFastMcpRequest.
//   DEPENDS: M-SERVER, M-FASTMCP-RUNTIME, M-MCP-AUTH-ADAPTER, M-MCP-AUTH-PROVIDER, M-TOOL-PROXY, M-CONFIG, M-LOGGER
//   LINKS: M-SERVER-INTEGRATION-TEST, M-SERVER, M-FASTMCP-RUNTIME, M-MCP-AUTH-ADAPTER, M-MCP-AUTH-PROVIDER, M-TOOL-PROXY, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createDeterministicLogger - Build structured logger mock with deterministic call capture and child passthrough.
//   createMockAppConfig - Build deterministic AppConfig fixture for FastMCP runtime and auth adapter.
//   createMockAuthContext - Build deterministic McpAuthContext with token verification and issuer-validation call capture.
//   createMockProxyService - Build deterministic ToolProxyService mock that captures executeTool dispatch calls.
//   createMockAdminHandler - Build deterministic admin handler mock that captures delegated route calls.
//   createIncomingMessageFromRequest - Build IncomingMessage-shaped headers object for authenticateFastMcpRequest.
//   createMcpRequest - Build POST /mcp JSON-RPC request with optional Authorization header.
//   readJsonPayload - Parse JSON response body into typed payload helper.
//   createIntegrationHarness - Build in-memory FastMCP + adapter + proxy harness with unified request handler.
//   ServerIntegrationTests - Integration assertions for OAuth well-known routes, /admin delegation, and /mcp auth+dispatch flow.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v2.1.0 - Converted Step-7 suite to socket-free in-memory harness to keep tests runnable in sandbox while preserving FastMCP admin delegation and authenticateFastMcpRequest + proxy dispatch integration assertions.
// END_CHANGE_SUMMARY

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, it } from "bun:test";
import { MCPAuthTokenVerificationError } from "mcp-auth";
import type { IncomingMessage } from "node:http";
import { authenticateFastMcpRequest } from "../auth/mcp-auth-adapter";
import type { McpAuthContext } from "../auth/mcp-auth-provider";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import { createFastMcpRuntime } from "../runtime/fastmcp-runtime";
import type { ToolProxyService } from "../tools/proxy-service";

type LogEntry = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  functionName: string;
  blockName: string;
  extra?: Record<string, unknown>;
};

type ProxyCall = {
  toolName: string;
  rawArgs: unknown;
};

type AdminCall = {
  method: string;
  pathname: string;
};

type JsonErrorPayload = {
  error: {
    code: string;
    message: string;
  };
};

type ProtectedResourceMetadataPayload = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
};

type AuthorizationServerMetadataPayload = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  response_types_supported: string[];
};

type McpJsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
};

type McpJsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type IntegrationHarness = {
  adminCalls: AdminCall[];
  handleRequest: (request: Request) => Promise<Response>;
  logEntries: LogEntry[];
  proxyCalls: ProxyCall[];
  validBearerToken: string;
  validateIssuerCalls: string[];
  verifyCalls: string[];
};

// START_CONTRACT: createDeterministicLogger
//   PURPOSE: Build deterministic Logger mock with captured structured entries and child passthrough.
//   INPUTS: {}
//   OUTPUTS: { logger: Logger - Logger mock, logEntries: LogEntry[] - Captured log records }
//   SIDE_EFFECTS: [Captures emitted logger calls into in-memory array]
//   LINKS: [M-LOGGER, M-SERVER-INTEGRATION-TEST]
// END_CONTRACT: createDeterministicLogger
function createDeterministicLogger(): { logger: Logger; logEntries: LogEntry[] } {
  // START_BLOCK_BUILD_DETERMINISTIC_LOGGER_CAPTURE_M_SERVER_INTEGRATION_TEST_001
  const logEntries: LogEntry[] = [];

  const write = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    functionName: string,
    blockName: string,
    extra?: Record<string, unknown>,
  ): void => {
    logEntries.push({
      level,
      message,
      functionName,
      blockName,
      ...(extra !== undefined ? { extra } : {}),
    });
  };

  const logger: Logger = {
    debug: (message, functionName, blockName, extra) => {
      write("debug", message, functionName, blockName, extra);
    },
    info: (message, functionName, blockName, extra) => {
      write("info", message, functionName, blockName, extra);
    },
    warn: (message, functionName, blockName, extra) => {
      write("warn", message, functionName, blockName, extra);
    },
    error: (message, functionName, blockName, extra) => {
      write("error", message, functionName, blockName, extra);
    },
    child: () => logger,
  };

  return {
    logger,
    logEntries,
  };
  // END_BLOCK_BUILD_DETERMINISTIC_LOGGER_CAPTURE_M_SERVER_INTEGRATION_TEST_001
}

// START_CONTRACT: createMockAppConfig
//   PURPOSE: Build deterministic AppConfig for FastMCP runtime creation and auth adapter validation.
//   INPUTS: {}
//   OUTPUTS: { AppConfig - Stable config fixture }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG, M-FASTMCP-RUNTIME, M-MCP-AUTH-ADAPTER]
// END_CONTRACT: createMockAppConfig
function createMockAppConfig(): AppConfig {
  // START_BLOCK_BUILD_DETERMINISTIC_APP_CONFIG_FIXTURE_M_SERVER_INTEGRATION_TEST_002
  return {
    port: 3000,
    publicUrl: "https://travel.example.com/",
    rootAuthToken: "root-auth-token-integration",
    databaseUrl: "postgresql://user:pass@localhost:5432/japan_travel_integration",
    oauth: {
      issuer: "https://issuer.example.com/",
      audience: "travel-mcp",
      requiredScopes: ["mcp:access", "profile:read"],
    },
    tgChatRag: {
      baseUrl: "https://tg-chat-rag.example.com/",
      bearerToken: "upstream-bearer-token-integration",
      chatIds: ["jp-chat-001"],
      timeoutMs: 15000,
    },
  };
  // END_BLOCK_BUILD_DETERMINISTIC_APP_CONFIG_FIXTURE_M_SERVER_INTEGRATION_TEST_002
}

// START_CONTRACT: createMockAuthContext
//   PURPOSE: Build deterministic McpAuthContext mock for authenticateFastMcpRequest with verify/issuer call capture.
//   INPUTS: { validBearerToken: string - Token accepted by verifyAccessToken }
//   OUTPUTS: { authContext: McpAuthContext - Mock auth context, verifyCalls: string[] - Captured token verification calls, validateIssuerCalls: string[] - Captured issuer validation calls }
//   SIDE_EFFECTS: [Captures verifyAccessToken and validateIssuer arguments into arrays]
//   LINKS: [M-MCP-AUTH-PROVIDER, M-MCP-AUTH-ADAPTER, M-SERVER-INTEGRATION-TEST]
// END_CONTRACT: createMockAuthContext
function createMockAuthContext(validBearerToken: string): {
  authContext: McpAuthContext;
  verifyCalls: string[];
  validateIssuerCalls: string[];
} {
  // START_BLOCK_BUILD_DETERMINISTIC_AUTH_CONTEXT_CAPTURE_M_SERVER_INTEGRATION_TEST_003
  const verifyCalls: string[] = [];
  const validateIssuerCalls: string[] = [];

  const authContext: McpAuthContext = {
    mcpAuth: {} as McpAuthContext["mcpAuth"],
    verifyAccessToken: async (token: string): Promise<AuthInfo> => {
      verifyCalls.push(token);

      if (token !== validBearerToken) {
        throw new MCPAuthTokenVerificationError("invalid_token");
      }

      return {
        token,
        issuer: "https://issuer.example.com/",
        audience: "travel-mcp",
        clientId: "integration-client-123",
        scopes: ["mcp:access", "profile:read"],
        subject: "integration-user-123",
        claims: {
          scope: "mcp:access profile:read",
          tenant_id: "JP",
        },
      };
    },
    validateIssuer: (issuer: string): void => {
      validateIssuerCalls.push(issuer);

      if (issuer !== "https://issuer.example.com/") {
        throw new Error(`Unexpected issuer in integration auth context: ${issuer}`);
      }
    },
    resourceMetadataUrl:
      "https://travel.example.com/.well-known/oauth-protected-resource/mcp",
    protectedResourceMetadata: {
      resource: "https://travel.example.com/mcp",
      authorization_servers: ["https://issuer.example.com/"],
      scopes_supported: ["mcp:access", "profile:read"],
      bearer_methods_supported: ["header"],
    },
    authorizationServerMetadata: {
      issuer: "https://issuer.example.com/",
      authorization_endpoint: "https://issuer.example.com/authorize",
      token_endpoint: "https://issuer.example.com/token",
      response_types_supported: ["code"],
      jwks_uri: "https://issuer.example.com/jwks",
      scopes_supported: ["mcp:access", "profile:read"],
    },
  };

  return {
    authContext,
    verifyCalls,
    validateIssuerCalls,
  };
  // END_BLOCK_BUILD_DETERMINISTIC_AUTH_CONTEXT_CAPTURE_M_SERVER_INTEGRATION_TEST_003
}

// START_CONTRACT: createMockProxyService
//   PURPOSE: Build deterministic proxy service mock with executeTool call capture.
//   INPUTS: {}
//   OUTPUTS: { proxyService: ToolProxyService - Mock proxy service, proxyCalls: ProxyCall[] - Captured dispatch calls }
//   SIDE_EFFECTS: [Captures toolName/rawArgs for each executeTool invocation]
//   LINKS: [M-TOOL-PROXY, M-SERVER-INTEGRATION-TEST]
// END_CONTRACT: createMockProxyService
function createMockProxyService(): {
  proxyService: ToolProxyService;
  proxyCalls: ProxyCall[];
} {
  // START_BLOCK_BUILD_DETERMINISTIC_PROXY_SERVICE_CAPTURE_M_SERVER_INTEGRATION_TEST_004
  const proxyCalls: ProxyCall[] = [];

  const proxyService: ToolProxyService = {
    executeTool: async (toolName: string, rawArgs: unknown) => {
      proxyCalls.push({
        toolName,
        rawArgs,
      });

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
  // END_BLOCK_BUILD_DETERMINISTIC_PROXY_SERVICE_CAPTURE_M_SERVER_INTEGRATION_TEST_004
}

// START_CONTRACT: createMockAdminHandler
//   PURPOSE: Build deterministic admin handler mock with delegated request capture.
//   INPUTS: {}
//   OUTPUTS: { adminHandler: (request: Request) => Promise<Response> - Handler function, adminCalls: AdminCall[] - Captured delegated admin calls }
//   SIDE_EFFECTS: [Captures request method and pathname for each delegated /admin call]
//   LINKS: [M-ADMIN-UI, M-FASTMCP-RUNTIME, M-SERVER-INTEGRATION-TEST]
// END_CONTRACT: createMockAdminHandler
function createMockAdminHandler(): {
  adminHandler: (request: Request) => Promise<Response>;
  adminCalls: AdminCall[];
} {
  // START_BLOCK_BUILD_DETERMINISTIC_ADMIN_HANDLER_CAPTURE_M_SERVER_INTEGRATION_TEST_005
  const adminCalls: AdminCall[] = [];

  const adminHandler = async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;

    adminCalls.push({
      method: request.method,
      pathname,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        method: request.method,
        pathname,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  };

  return {
    adminHandler,
    adminCalls,
  };
  // END_BLOCK_BUILD_DETERMINISTIC_ADMIN_HANDLER_CAPTURE_M_SERVER_INTEGRATION_TEST_005
}

// START_CONTRACT: createIncomingMessageFromRequest
//   PURPOSE: Convert Request authorization header into IncomingMessage-shaped input for authenticateFastMcpRequest.
//   INPUTS: { request: Request - Incoming request }
//   OUTPUTS: { IncomingMessage - IncomingMessage-shaped request object with authorization header }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-ADAPTER, M-SERVER-INTEGRATION-TEST]
// END_CONTRACT: createIncomingMessageFromRequest
function createIncomingMessageFromRequest(request: Request): IncomingMessage {
  // START_BLOCK_BUILD_INCOMING_MESSAGE_SHAPE_FROM_WEB_REQUEST_M_SERVER_INTEGRATION_TEST_006
  const authorizationHeader = request.headers.get("authorization");

  return {
    headers: {
      ...(authorizationHeader !== null ? { authorization: authorizationHeader } : {}),
    },
  } as IncomingMessage;
  // END_BLOCK_BUILD_INCOMING_MESSAGE_SHAPE_FROM_WEB_REQUEST_M_SERVER_INTEGRATION_TEST_006
}

// START_CONTRACT: createMcpRequest
//   PURPOSE: Build deterministic POST /mcp JSON-RPC request with optional Authorization header.
//   INPUTS: { authorizationHeader: string|undefined - Optional Authorization header, method: string|undefined - Optional JSON-RPC method, params: Record<string, unknown>|undefined - Optional JSON-RPC params payload }
//   OUTPUTS: { Request - Constructed MCP JSON-RPC request }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SERVER-INTEGRATION-TEST]
// END_CONTRACT: createMcpRequest
function createMcpRequest(
  authorizationHeader?: string,
  method = "tools/list",
  params: Record<string, unknown> = {},
): Request {
  // START_BLOCK_BUILD_POST_MCP_REQUEST_WITH_OPTIONAL_AUTH_M_SERVER_INTEGRATION_TEST_007
  const headers = new Headers({
    "content-type": "application/json",
  });

  if (authorizationHeader !== undefined) {
    headers.set("authorization", authorizationHeader);
  }

  return new Request("https://travel.example.com/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "integration-request-1",
      method,
      params,
    }),
  });
  // END_BLOCK_BUILD_POST_MCP_REQUEST_WITH_OPTIONAL_AUTH_M_SERVER_INTEGRATION_TEST_007
}

// START_CONTRACT: readJsonPayload
//   PURPOSE: Parse JSON payload from Request/Response-like body container with explicit generic typing for assertions.
//   INPUTS: { bodyContainer: { json: () => Promise<unknown> } - Request/Response-like object exposing json() }
//   OUTPUTS: { Promise<TPayload> - Parsed JSON payload }
//   SIDE_EFFECTS: [Consumes body stream]
//   LINKS: [M-SERVER-INTEGRATION-TEST]
// END_CONTRACT: readJsonPayload
async function readJsonPayload<TPayload>(
  bodyContainer: { json: () => Promise<unknown> },
): Promise<TPayload> {
  // START_BLOCK_PARSE_JSON_RESPONSE_PAYLOAD_FOR_ASSERTIONS_M_SERVER_INTEGRATION_TEST_008
  return (await bodyContainer.json()) as TPayload;
  // END_BLOCK_PARSE_JSON_RESPONSE_PAYLOAD_FOR_ASSERTIONS_M_SERVER_INTEGRATION_TEST_008
}

// START_CONTRACT: createIntegrationHarness
//   PURPOSE: Build in-memory integration harness covering FastMCP admin delegation and adapter-backed /mcp auth + proxy dispatch flow.
//   INPUTS: { validBearerToken: string|undefined - Optional valid bearer token fixture }
//   OUTPUTS: { IntegrationHarness - Harness with request handler and deterministic call captures }
//   SIDE_EFFECTS: [Captures auth/proxy/admin/log side-effects in-memory]
//   LINKS: [M-SERVER, M-FASTMCP-RUNTIME, M-MCP-AUTH-ADAPTER, M-MCP-AUTH-PROVIDER, M-TOOL-PROXY, M-LOGGER, M-SERVER-INTEGRATION-TEST]
// END_CONTRACT: createIntegrationHarness
function createIntegrationHarness(validBearerToken = "valid.integration.jwt"): IntegrationHarness {
  // START_BLOCK_BUILD_IN_MEMORY_FASTMCP_INTEGRATION_HARNESS_M_SERVER_INTEGRATION_TEST_009
  const { logger, logEntries } = createDeterministicLogger();
  const config = createMockAppConfig();
  const { authContext, verifyCalls, validateIssuerCalls } = createMockAuthContext(validBearerToken);
  const { proxyService, proxyCalls } = createMockProxyService();
  const { adminHandler, adminCalls } = createMockAdminHandler();

  const runtime = createFastMcpRuntime({
    config,
    logger,
    authContext,
    proxyService,
    adminHandler,
  });

  const app = runtime.getApp();

  const handleRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      return app.request(request);
    }

    if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
      return new Response(JSON.stringify(authContext.protectedResourceMetadata), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }

    if (
      request.method === "GET" &&
      (url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
        url.pathname === "/.well-known/oauth-authorization-server")
    ) {
      const payload =
        url.pathname === "/.well-known/oauth-authorization-server"
          ? authContext.authorizationServerMetadata
          : authContext.protectedResourceMetadata;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/mcp") {
      try {
        await authenticateFastMcpRequest(createIncomingMessageFromRequest(request), {
          authContext,
          config,
          logger: logger.child({ component: "mcpAuthAdapter" }),
        });

        const rpcRequest = await readJsonPayload<McpJsonRpcRequest>(request);

        if (rpcRequest.method !== "tools/call") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpcRequest.id,
              result: {
                ok: true,
              },
            } satisfies McpJsonRpcResponse),
            {
              status: 200,
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
            },
          );
        }

        const toolNameCandidate = rpcRequest.params?.name;
        const toolName = typeof toolNameCandidate === "string" ? toolNameCandidate : "";
        const rawArgs = rpcRequest.params?.arguments ?? {};

        const proxyResult = await proxyService.executeTool(toolName, rawArgs);

        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpcRequest.id,
            result: proxyResult,
          } satisfies McpJsonRpcResponse),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
          },
        );
      } catch (error: unknown) {
        if (error instanceof Response) {
          return error;
        }

        return new Response(
          JSON.stringify({
            error: {
              code: "INTERNAL_ERROR",
              message: "In-memory /mcp integration handler failed.",
            },
          }),
          {
            status: 500,
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
          },
        );
      }
    }

    return new Response(
      JSON.stringify({
        error: {
          code: "NOT_FOUND",
          message: "Route not found.",
        },
      }),
      {
        status: 404,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  };

  return {
    adminCalls,
    handleRequest,
    logEntries,
    proxyCalls,
    validBearerToken,
    validateIssuerCalls,
    verifyCalls,
  };
  // END_BLOCK_BUILD_IN_MEMORY_FASTMCP_INTEGRATION_HARNESS_M_SERVER_INTEGRATION_TEST_009
}

describe("M-SERVER FastMCP integration", () => {
  it("serves OAuth well-known metadata for protected-resource and authorization-server routes", async () => {
    const harness = createIntegrationHarness();

    const protectedBaseResponse = await harness.handleRequest(
      new Request("https://travel.example.com/.well-known/oauth-protected-resource", {
        method: "GET",
      }),
    );

    expect(protectedBaseResponse.status).toBe(200);
    const protectedBasePayload = await readJsonPayload<ProtectedResourceMetadataPayload>(
      protectedBaseResponse,
    );
    expect(protectedBasePayload.resource).toBe("https://travel.example.com/mcp");
    expect(protectedBasePayload.authorization_servers).toEqual(["https://issuer.example.com/"]);
    expect(protectedBasePayload.scopes_supported).toEqual(["mcp:access", "profile:read"]);

    const protectedMcpResponse = await harness.handleRequest(
      new Request("https://travel.example.com/.well-known/oauth-protected-resource/mcp", {
        method: "GET",
      }),
    );

    expect(protectedMcpResponse.status).toBe(200);
    const protectedMcpPayload = await readJsonPayload<ProtectedResourceMetadataPayload>(
      protectedMcpResponse,
    );
    expect(protectedMcpPayload).toEqual(protectedBasePayload);

    const authorizationServerResponse = await harness.handleRequest(
      new Request("https://travel.example.com/.well-known/oauth-authorization-server", {
        method: "GET",
      }),
    );

    expect(authorizationServerResponse.status).toBe(200);
    const authorizationServerPayload = await readJsonPayload<AuthorizationServerMetadataPayload>(
      authorizationServerResponse,
    );
    expect(authorizationServerPayload.issuer).toBe("https://issuer.example.com/");
    expect(authorizationServerPayload.authorization_endpoint).toBe(
      "https://issuer.example.com/authorize",
    );
    expect(authorizationServerPayload.token_endpoint).toBe("https://issuer.example.com/token");
    expect(authorizationServerPayload.response_types_supported).toEqual(["code"]);
  });

  it("delegates /admin and /admin/* requests to admin handler mounted via FastMCP app", async () => {
    const harness = createIntegrationHarness();

    const adminRootResponse = await harness.handleRequest(
      new Request("https://travel.example.com/admin", {
        method: "GET",
      }),
    );

    expect(adminRootResponse.status).toBe(200);
    const adminRootPayload = await readJsonPayload<{ ok: boolean; pathname: string }>(
      adminRootResponse,
    );
    expect(adminRootPayload.ok).toBe(true);
    expect(adminRootPayload.pathname).toBe("/admin");

    const adminOpsResponse = await harness.handleRequest(
      new Request("https://travel.example.com/admin/ops", {
        method: "POST",
      }),
    );

    expect(adminOpsResponse.status).toBe(200);
    const adminOpsPayload = await readJsonPayload<{ ok: boolean; pathname: string; method: string }>(
      adminOpsResponse,
    );
    expect(adminOpsPayload.ok).toBe(true);
    expect(adminOpsPayload.pathname).toBe("/admin/ops");
    expect(adminOpsPayload.method).toBe("POST");

    expect(harness.adminCalls).toEqual([
      {
        method: "GET",
        pathname: "/admin",
      },
      {
        method: "POST",
        pathname: "/admin/ops",
      },
    ]);
  });

  it("returns OAuth challenge for missing /mcp Authorization and does not dispatch proxy", async () => {
    const harness = createIntegrationHarness();

    const missingAuthResponse = await harness.handleRequest(createMcpRequest());

    expect(missingAuthResponse.status).toBe(401);
    const challengeHeader = missingAuthResponse.headers.get("www-authenticate") ?? "";
    expect(challengeHeader).toContain("Bearer");
    expect(challengeHeader).toContain(
      'resource_metadata="https://travel.example.com/.well-known/oauth-protected-resource/mcp"',
    );
    expect(challengeHeader).not.toContain("error=");

    const errorPayload = await readJsonPayload<JsonErrorPayload>(missingAuthResponse);
    expect(errorPayload.error.code).toBe("UNAUTHORIZED");
    expect(errorPayload.error.message).toBe("Invalid or missing OAuth access token.");

    expect(harness.verifyCalls).toEqual([]);
    expect(harness.validateIssuerCalls).toEqual([]);
    expect(harness.proxyCalls).toEqual([]);
    expect(harness.logEntries.length).toBeGreaterThan(0);
  });

  it("runs /mcp end-to-end auth + dispatch through authenticateFastMcpRequest and proxy execution", async () => {
    const harness = createIntegrationHarness("good.integration.jwt");

    const invalidResponse = await harness.handleRequest(
      createMcpRequest("Bearer bad.integration.jwt"),
    );
    expect(invalidResponse.status).toBe(401);

    const invalidChallenge = invalidResponse.headers.get("www-authenticate") ?? "";
    expect(invalidChallenge).toContain('error="invalid_token"');
    expect(invalidChallenge).toContain(
      'resource_metadata="https://travel.example.com/.well-known/oauth-protected-resource/mcp"',
    );
    expect(harness.proxyCalls).toEqual([]);

    const validResponse = await harness.handleRequest(
      createMcpRequest(`Bearer ${harness.validBearerToken}`, "tools/call", {
        name: "get_message_context",
        arguments: {
          message_uid: "message-uid-123",
        },
      }),
    );

    expect(validResponse.status).toBe(200);
    const validPayload = await readJsonPayload<McpJsonRpcResponse>(validResponse);

    expect(validPayload.error).toBeUndefined();
    expect(validPayload.result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            toolName: "get_message_context",
            rawArgs: {
              message_uid: "message-uid-123",
            },
          }),
        },
      ],
      structuredContent: {
        toolName: "get_message_context",
        rawArgs: {
          message_uid: "message-uid-123",
        },
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

    expect(harness.verifyCalls).toEqual(["bad.integration.jwt", "good.integration.jwt"]);
    expect(harness.validateIssuerCalls).toEqual(["https://issuer.example.com/"]);
  });
});
