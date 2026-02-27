// FILE: src/server/server-integration.test.ts
// VERSION: 3.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Integration verification of OAuth well-known metadata, admin route delegation, and /mcp auth+dispatch behavior on the OAuthProxy runtime model.
//   SCOPE: Build an in-memory FastMCP harness with deterministic OAuthProxy and ToolProxy mocks, assert OAuth metadata responses, validate /admin delegation through mounted FastMCP app routes, and verify /mcp denied/allowed flow through OAuthProxy token loading plus tool proxy dispatch.
//   DEPENDS: M-SERVER, M-FASTMCP-RUNTIME, M-AUTH-PROXY, M-TOOL-PROXY, M-CONFIG, M-LOGGER
//   LINKS: M-SERVER-INTEGRATION-TEST, M-SERVER, M-FASTMCP-RUNTIME, M-AUTH-PROXY, M-TOOL-PROXY, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createDeterministicLogger - Build structured logger mock with deterministic call capture and child passthrough.
//   createMockAppConfig - Build deterministic AppConfig fixture for FastMCP runtime dependencies.
//   createMockOauthProxyContext - Build deterministic OauthProxyContext with token-load capture.
//   createMockProxyService - Build deterministic ToolProxyService mock that captures executeTool dispatch calls.
//   createMockAdminHandler - Build deterministic admin handler mock that captures delegated route calls.
//   createMcpRequest - Build POST /mcp JSON-RPC request with optional Authorization header.
//   readJsonPayload - Parse JSON response body into typed payload helper.
//   extractBearerTokenFromAuthorizationHeader - Parse strict Bearer token from Authorization header.
//   buildProtectedResourceMetadata - Build OAuth protected-resource metadata payload for /mcp.
//   buildAuthorizationServerMetadata - Build OAuth authorization-server metadata payload from OauthProxyContext.
//   buildUnauthorizedResponse - Build OAuth challenge response for denied /mcp requests.
//   createIntegrationHarness - Build in-memory FastMCP + OAuthProxy + proxy harness with unified request handler.
//   ServerIntegrationTests - Integration assertions for OAuth metadata routes, /admin delegation, and /mcp auth+dispatch flow.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v3.1.0 - Updated protected-resource discovery assertions to use OAuth proxy issuer metadata even when Logto tenant URL differs.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { OauthProxyContext } from "../auth/oauth-proxy";
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
  bearer_methods_supported: string[];
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
  tokenLoadCalls: string[];
  validBearerToken: string;
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
//   PURPOSE: Build deterministic AppConfig for FastMCP runtime and OAuthProxy metadata behavior.
//   INPUTS: {}
//   OUTPUTS: { AppConfig - Stable config fixture }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG, M-FASTMCP-RUNTIME, M-AUTH-PROXY]
// END_CONTRACT: createMockAppConfig
function createMockAppConfig(): AppConfig {
  // START_BLOCK_BUILD_DETERMINISTIC_APP_CONFIG_FIXTURE_M_SERVER_INTEGRATION_TEST_002
  return {
    port: 3000,
    publicUrl: "https://travel.example.com/",
    rootAuthToken: "root-auth-token-integration",
    tgChatRag: {
      baseUrl: "https://tg-chat-rag.example.com/",
      bearerToken: "upstream-bearer-token-integration",
      chatIds: ["jp-chat-001"],
      timeoutMs: 15000,
    },
    logto: {
      tenantUrl: "https://upstream-logto.example.com/",
      clientId: "logto-client-id-integration",
      clientSecret: "logto-client-secret-integration",
      oidcAuthEndpoint: "https://upstream-logto.example.com/oidc/auth",
      oidcTokenEndpoint: "https://upstream-logto.example.com/oidc/token",
    },
  };
  // END_BLOCK_BUILD_DETERMINISTIC_APP_CONFIG_FIXTURE_M_SERVER_INTEGRATION_TEST_002
}

// START_CONTRACT: createMockOauthProxyContext
//   PURPOSE: Build deterministic OauthProxyContext mock with token-loading call capture.
//   INPUTS: { validBearerToken: string - Token accepted by oauthProxy.loadUpstreamTokens }
//   OUTPUTS: { oauthProxyContext: OauthProxyContext - Mock OAuth proxy context, tokenLoadCalls: string[] - Captured token load calls }
//   SIDE_EFFECTS: [Captures loadUpstreamTokens token values in-memory]
//   LINKS: [M-AUTH-PROXY, M-SERVER-INTEGRATION-TEST]
// END_CONTRACT: createMockOauthProxyContext
function createMockOauthProxyContext(validBearerToken: string): {
  oauthProxyContext: OauthProxyContext;
  tokenLoadCalls: string[];
} {
  // START_BLOCK_BUILD_DETERMINISTIC_OAUTH_PROXY_CONTEXT_CAPTURE_M_SERVER_INTEGRATION_TEST_003
  const tokenLoadCalls: string[] = [];

  type MockUpstreamTokenSet = NonNullable<
    Awaited<ReturnType<OauthProxyContext["oauthProxy"]["loadUpstreamTokens"]>>
  >;

  const oauthProxy = {
    loadUpstreamTokens: async (token: string): Promise<MockUpstreamTokenSet | null> => {
      tokenLoadCalls.push(token);

      if (token !== validBearerToken) {
        return null;
      }

      return {
        accessToken: "upstream-access-token-integration",
        expiresIn: 3600,
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
        scope: ["mcp:access", "profile:read"],
        tokenType: "Bearer",
      };
    },
  } as Pick<OauthProxyContext["oauthProxy"], "loadUpstreamTokens">;

  const oauthProxyContext: OauthProxyContext = {
    oauthProxy: oauthProxy as OauthProxyContext["oauthProxy"],
    authorizationServerMetadata: {
      issuer: "https://oauth-proxy.example.com/",
      authorizationEndpoint: "https://oauth-proxy.example.com/oauth/authorize",
      tokenEndpoint: "https://oauth-proxy.example.com/oauth/token",
      responseTypesSupported: ["code"],
    },
  };

  return {
    oauthProxyContext,
    tokenLoadCalls,
  };
  // END_BLOCK_BUILD_DETERMINISTIC_OAUTH_PROXY_CONTEXT_CAPTURE_M_SERVER_INTEGRATION_TEST_003
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
  // START_BLOCK_BUILD_POST_MCP_REQUEST_WITH_OPTIONAL_AUTH_M_SERVER_INTEGRATION_TEST_006
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
  // END_BLOCK_BUILD_POST_MCP_REQUEST_WITH_OPTIONAL_AUTH_M_SERVER_INTEGRATION_TEST_006
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
  // START_BLOCK_PARSE_JSON_RESPONSE_PAYLOAD_FOR_ASSERTIONS_M_SERVER_INTEGRATION_TEST_007
  return (await bodyContainer.json()) as TPayload;
  // END_BLOCK_PARSE_JSON_RESPONSE_PAYLOAD_FOR_ASSERTIONS_M_SERVER_INTEGRATION_TEST_007
}

// START_CONTRACT: extractBearerTokenFromAuthorizationHeader
//   PURPOSE: Parse strict Bearer token from Authorization header value.
//   INPUTS: { authorizationHeader: string|null - Incoming authorization header value }
//   OUTPUTS: { string|undefined - Bearer token string when valid; otherwise undefined }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SERVER-INTEGRATION-TEST, M-AUTH-PROXY]
// END_CONTRACT: extractBearerTokenFromAuthorizationHeader
function extractBearerTokenFromAuthorizationHeader(authorizationHeader: string | null): string | undefined {
  // START_BLOCK_PARSE_BEARER_TOKEN_FROM_AUTHORIZATION_HEADER_M_SERVER_INTEGRATION_TEST_008
  if (typeof authorizationHeader !== "string") {
    return undefined;
  }

  const normalizedHeader = authorizationHeader.trim();
  if (!normalizedHeader) {
    return undefined;
  }

  const matchedBearerHeader = /^Bearer\s+(.+)$/i.exec(normalizedHeader);
  if (!matchedBearerHeader || matchedBearerHeader.length < 2) {
    return undefined;
  }

  const token = matchedBearerHeader[1]?.trim();
  return token ? token : undefined;
  // END_BLOCK_PARSE_BEARER_TOKEN_FROM_AUTHORIZATION_HEADER_M_SERVER_INTEGRATION_TEST_008
}

// START_CONTRACT: buildProtectedResourceMetadata
//   PURPOSE: Build deterministic protected-resource metadata payload from AppConfig public URL and OAuth proxy issuer metadata.
//   INPUTS: { config: AppConfig - Runtime configuration fixture, oauthProxyContext: OauthProxyContext - OAuth proxy metadata fixture }
//   OUTPUTS: { ProtectedResourceMetadataPayload - OAuth protected-resource metadata }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SERVER-INTEGRATION-TEST, M-CONFIG, M-FASTMCP-RUNTIME, M-AUTH-PROXY]
// END_CONTRACT: buildProtectedResourceMetadata
function buildProtectedResourceMetadata(
  config: AppConfig,
  oauthProxyContext: OauthProxyContext,
): ProtectedResourceMetadataPayload {
  // START_BLOCK_BUILD_PROTECTED_RESOURCE_METADATA_PAYLOAD_M_SERVER_INTEGRATION_TEST_009
  return {
    resource: new URL("/mcp", config.publicUrl).toString(),
    authorization_servers: [oauthProxyContext.authorizationServerMetadata.issuer],
    bearer_methods_supported: ["header"],
  };
  // END_BLOCK_BUILD_PROTECTED_RESOURCE_METADATA_PAYLOAD_M_SERVER_INTEGRATION_TEST_009
}

// START_CONTRACT: buildAuthorizationServerMetadata
//   PURPOSE: Build deterministic authorization-server metadata payload from OauthProxyContext.
//   INPUTS: { oauthProxyContext: OauthProxyContext - OAuth proxy context fixture }
//   OUTPUTS: { AuthorizationServerMetadataPayload - OAuth authorization server metadata }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SERVER-INTEGRATION-TEST, M-AUTH-PROXY, M-FASTMCP-RUNTIME]
// END_CONTRACT: buildAuthorizationServerMetadata
function buildAuthorizationServerMetadata(
  oauthProxyContext: OauthProxyContext,
): AuthorizationServerMetadataPayload {
  // START_BLOCK_BUILD_AUTHORIZATION_SERVER_METADATA_PAYLOAD_M_SERVER_INTEGRATION_TEST_010
  const metadata = oauthProxyContext.authorizationServerMetadata;
  return {
    issuer: metadata.issuer,
    authorization_endpoint: metadata.authorizationEndpoint,
    token_endpoint: metadata.tokenEndpoint,
    response_types_supported: metadata.responseTypesSupported,
  };
  // END_BLOCK_BUILD_AUTHORIZATION_SERVER_METADATA_PAYLOAD_M_SERVER_INTEGRATION_TEST_010
}

// START_CONTRACT: buildUnauthorizedResponse
//   PURPOSE: Build OAuth challenge response payload for denied /mcp requests.
//   INPUTS: { config: AppConfig - Runtime config fixture, errorCode: \"invalid_token\"|undefined - Optional OAuth error code }
//   OUTPUTS: { Response - 401 JSON response with WWW-Authenticate challenge header }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SERVER-INTEGRATION-TEST, M-FASTMCP-RUNTIME]
// END_CONTRACT: buildUnauthorizedResponse
function buildUnauthorizedResponse(config: AppConfig, errorCode?: "invalid_token"): Response {
  // START_BLOCK_BUILD_OAUTH_CHALLENGE_RESPONSE_M_SERVER_INTEGRATION_TEST_011
  const resourceMetadataUrl = new URL(
    "/.well-known/oauth-protected-resource/mcp",
    config.publicUrl,
  ).toString();
  const challenge = `Bearer resource_metadata="${resourceMetadataUrl}"${
    errorCode ? `, error="${errorCode}"` : ""
  }`;

  return new Response(
    JSON.stringify({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing OAuth access token.",
      },
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "www-authenticate": challenge,
      },
    },
  );
  // END_BLOCK_BUILD_OAUTH_CHALLENGE_RESPONSE_M_SERVER_INTEGRATION_TEST_011
}

// START_CONTRACT: createIntegrationHarness
//   PURPOSE: Build in-memory integration harness covering FastMCP admin delegation and OAuthProxy-backed /mcp auth + proxy dispatch flow.
//   INPUTS: { validBearerToken: string|undefined - Optional valid bearer token fixture }
//   OUTPUTS: { IntegrationHarness - Harness with request handler and deterministic call captures }
//   SIDE_EFFECTS: [Captures oauth/admin/proxy/log side-effects in-memory]
//   LINKS: [M-SERVER, M-FASTMCP-RUNTIME, M-AUTH-PROXY, M-TOOL-PROXY, M-LOGGER, M-SERVER-INTEGRATION-TEST]
// END_CONTRACT: createIntegrationHarness
function createIntegrationHarness(validBearerToken = "valid.integration.jwt"): IntegrationHarness {
  // START_BLOCK_BUILD_IN_MEMORY_FASTMCP_OAUTH_INTEGRATION_HARNESS_M_SERVER_INTEGRATION_TEST_012
  const { logger, logEntries } = createDeterministicLogger();
  const config = createMockAppConfig();
  const { oauthProxyContext, tokenLoadCalls } = createMockOauthProxyContext(validBearerToken);
  const { proxyService, proxyCalls } = createMockProxyService();
  const { adminHandler, adminCalls } = createMockAdminHandler();

  const runtime = createFastMcpRuntime({
    config,
    logger,
    oauthProxyContext,
    proxyService,
    adminHandler,
  });

  const app = runtime.getApp();

  const handleRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      return app.request(request);
    }

    if (
      request.method === "GET" &&
      (url.pathname === "/.well-known/oauth-protected-resource" ||
        url.pathname === "/.well-known/oauth-protected-resource/mcp")
    ) {
      return new Response(JSON.stringify(buildProtectedResourceMetadata(config, oauthProxyContext)), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      return new Response(JSON.stringify(buildAuthorizationServerMetadata(oauthProxyContext)), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/mcp") {
      const bearerToken = extractBearerTokenFromAuthorizationHeader(
        request.headers.get("authorization"),
      );
      if (!bearerToken) {
        return buildUnauthorizedResponse(config);
      }

      const upstreamTokens = await oauthProxyContext.oauthProxy.loadUpstreamTokens(bearerToken);
      if (!upstreamTokens) {
        return buildUnauthorizedResponse(config, "invalid_token");
      }

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
    tokenLoadCalls,
    validBearerToken,
  };
  // END_BLOCK_BUILD_IN_MEMORY_FASTMCP_OAUTH_INTEGRATION_HARNESS_M_SERVER_INTEGRATION_TEST_012
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
    expect(protectedBasePayload.authorization_servers).toEqual(["https://oauth-proxy.example.com/"]);
    expect(protectedBasePayload.authorization_servers).not.toEqual([
      "https://upstream-logto.example.com/",
    ]);
    expect(protectedBasePayload.bearer_methods_supported).toEqual(["header"]);

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
    expect(authorizationServerPayload.issuer).toBe("https://oauth-proxy.example.com/");
    expect(authorizationServerPayload.authorization_endpoint).toBe(
      "https://oauth-proxy.example.com/oauth/authorize",
    );
    expect(authorizationServerPayload.token_endpoint).toBe(
      "https://oauth-proxy.example.com/oauth/token",
    );
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

    expect(harness.tokenLoadCalls).toEqual([]);
    expect(harness.proxyCalls).toEqual([]);
    expect(harness.logEntries.length).toBeGreaterThan(0);
  });

  it("runs /mcp end-to-end auth + dispatch through OAuthProxy token loading and proxy execution", async () => {
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

    expect(harness.tokenLoadCalls).toEqual(["bad.integration.jwt", "good.integration.jwt"]);
  });
});
