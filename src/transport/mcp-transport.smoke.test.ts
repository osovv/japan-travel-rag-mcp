// FILE: src/transport/mcp-transport.smoke.test.ts
// VERSION: 2.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Provide smoke coverage for MCP transport tool registration, request routing, and integrated /mcp auth-gated dispatch behavior.
//   SCOPE: Validate tool allowlist registration, tools/list response shape, tools/call proxy dispatch, and request-based auth guard gating for missing header, invalid token, insufficient scope, and valid token paths.
//   DEPENDS: M-TRANSPORT, M-MCP-AUTH-GUARD, M-MCP-AUTH-PROVIDER, M-TOOLS-CONTRACTS, M-TOOL-PROXY, M-LOGGER
//   LINKS: M-TRANSPORT, M-MCP-AUTH-GUARD, M-MCP-AUTH-PROVIDER, M-TOOLS-CONTRACTS, M-TOOL-PROXY, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build a no-op logger compatible with Logger interface.
//   createMockTransportDependencies - Build deterministic mock transport dependencies for smoke tests.
//   createMockAuthGuardDependencies - Build deterministic McpAuthContext dependencies for integrated /mcp auth gating tests.
//   createJsonResponse - Build JSON responses for integrated /mcp helper behavior.
//   createJsonRpcRequest - Build valid JSON-RPC MCP POST Request objects.
//   handleIntegratedMcpRoute - Emulate /mcp route auth guard + transport dispatch flow for smoke coverage.
//   TransportSmokeTests - Smoke suite for registerTools, handleMcpRequest, and integrated /mcp auth gating.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v2.0.0 - Migrated integrated /mcp smoke tests to Request-based guard API with McpAuthContext mocks and denied response passthrough.
// END_CHANGE_SUMMARY

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, it } from "bun:test";
import { MCPAuthTokenVerificationError } from "mcp-auth";
import { authorizeMcpRequest } from "../auth/mcp-auth-guard";
import type { McpAuthGuardDependencies } from "../auth/mcp-auth-guard";
import type { McpAuthContext } from "../auth/mcp-auth-provider";
import type { Logger } from "../logger/index";
import type { ToolProxyService } from "../tools/proxy-service";
import { handleMcpRequest, registerTools } from "./mcp-transport";
import type { McpTransportDependencies } from "./mcp-transport";

type MockCall = {
  toolName: string;
  rawArgs: unknown;
};

type IntegratedMcpRouteDependencies = {
  authDeps: McpAuthGuardDependencies;
  transportDeps: McpTransportDependencies;
  transportHandler?: typeof handleMcpRequest;
};

type MockAuthGuardTokenOptions = {
  validBearerToken: string;
  insufficientScopeBearerToken?: string;
};

type GuardDecision = Awaited<ReturnType<typeof authorizeMcpRequest>>;

// START_CONTRACT: createNoopLogger
//   PURPOSE: Create a no-op logger implementation for transport smoke tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - Logger with inert log methods and child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER, M-TRANSPORT]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_IMPLEMENTATION_M_TRANSPORT_SMOKE_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_IMPLEMENTATION_M_TRANSPORT_SMOKE_001
}

// START_CONTRACT: createMockTransportDependencies
//   PURPOSE: Build transport dependencies with deterministic proxy outputs and call capture.
//   INPUTS: {}
//   OUTPUTS: { deps: McpTransportDependencies - Mock transport dependencies, calls: MockCall[] - Captured proxy call history }
//   SIDE_EFFECTS: [Captures tool invocation data in memory]
//   LINKS: [M-TRANSPORT, M-TOOL-PROXY, M-LOGGER]
// END_CONTRACT: createMockTransportDependencies
function createMockTransportDependencies(): {
  deps: McpTransportDependencies;
  calls: MockCall[];
} {
  // START_BLOCK_CREATE_MOCK_PROXY_AND_DEPS_M_TRANSPORT_SMOKE_002
  const calls: MockCall[] = [];
  const proxyService: ToolProxyService = {
    executeTool: async (toolName, rawArgs) => {
      calls.push({ toolName, rawArgs });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ toolName, rawArgs }),
          },
        ],
        structuredContent: { toolName, rawArgs },
      };
    },
  };

  return {
    deps: {
      logger: createNoopLogger(),
      proxyService,
    },
    calls,
  };
  // END_BLOCK_CREATE_MOCK_PROXY_AND_DEPS_M_TRANSPORT_SMOKE_002
}

// START_CONTRACT: createMockAuthGuardDependencies
//   PURPOSE: Build auth guard dependencies that map Bearer tokens to valid, invalid_token, or insufficient_scope outcomes.
//   INPUTS: { options: MockAuthGuardTokenOptions - Token mapping options for auth outcomes }
//   OUTPUTS: { deps: McpAuthGuardDependencies - Mock auth guard dependencies, verifyCalls: string[] - Captured verifyAccessToken token values }
//   SIDE_EFFECTS: [Captures verifyAccessToken calls in memory]
//   LINKS: [M-MCP-AUTH-GUARD, M-MCP-AUTH-PROVIDER, M-LOGGER]
// END_CONTRACT: createMockAuthGuardDependencies
function createMockAuthGuardDependencies(options: MockAuthGuardTokenOptions): {
  deps: McpAuthGuardDependencies;
  verifyCalls: string[];
} {
  // START_BLOCK_CREATE_MOCK_AUTH_GUARD_DEPS_M_TRANSPORT_SMOKE_004
  const verifyCalls: string[] = [];
  const validToken = options.validBearerToken;
  const insufficientScopeToken = options.insufficientScopeBearerToken;

  const authContext: McpAuthContext = {
    mcpAuth: {} as McpAuthContext["mcpAuth"],
    verifyAccessToken: async (token: string): Promise<AuthInfo> => {
      verifyCalls.push(token);

      if (typeof insufficientScopeToken === "string" && token === insufficientScopeToken) {
        return {
          token,
          issuer: "https://issuer.example.com/",
          clientId: "client-smoke",
          scopes: ["profile:read"],
          audience: "travel-mcp",
          subject: "subject-smoke-limited",
          claims: {
            scope: "profile:read",
          },
        };
      }

      if (token !== validToken) {
        throw new MCPAuthTokenVerificationError("invalid_token");
      }

      return {
        token,
        issuer: "https://issuer.example.com/",
        clientId: "client-smoke",
        scopes: ["mcp:access"],
        audience: "travel-mcp",
        subject: "subject-smoke-1",
        claims: {
          scope: "mcp:access",
        },
      };
    },
    validateIssuer: () => {},
    resourceMetadataUrl: "https://resource.example.com/.well-known/oauth-protected-resource/mcp",
    protectedResourceMetadata: {
      resource: "https://resource.example.com/mcp",
      authorization_servers: ["https://issuer.example.com/"],
      scopes_supported: ["mcp:access"],
      bearer_methods_supported: ["header"],
    },
    authorizationServerMetadata: {
      issuer: "https://issuer.example.com/",
      authorization_endpoint: "https://issuer.example.com/authorize",
      token_endpoint: "https://issuer.example.com/token",
      jwks_uri: "https://issuer.example.com/jwks",
    },
  };

  return {
    deps: {
      logger: createNoopLogger(),
      audience: "travel-mcp",
      requiredScopes: ["mcp:access"],
      authContext,
    },
    verifyCalls,
  };
  // END_BLOCK_CREATE_MOCK_AUTH_GUARD_DEPS_M_TRANSPORT_SMOKE_004
}

// START_CONTRACT: createJsonResponse
//   PURPOSE: Build deterministic JSON responses for integrated /mcp auth-gating helper behavior.
//   INPUTS: { status: number - HTTP status code, payload: Record<string, unknown> - JSON response payload }
//   OUTPUTS: { Response - JSON HTTP response }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TRANSPORT]
// END_CONTRACT: createJsonResponse
function createJsonResponse(status: number, payload: Record<string, unknown>): Response {
  // START_BLOCK_CREATE_JSON_RESPONSE_M_TRANSPORT_SMOKE_005
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
  // END_BLOCK_CREATE_JSON_RESPONSE_M_TRANSPORT_SMOKE_005
}

// START_CONTRACT: createJsonRpcRequest
//   PURPOSE: Build valid MCP JSON-RPC POST requests for transport smoke execution.
//   INPUTS: { id: number - JSON-RPC request id, method: string - JSON-RPC method, params: unknown - JSON-RPC params payload, authorizationHeader: string|undefined - Optional Authorization header value }
//   OUTPUTS: { Request - HTTP request with required MCP transport headers }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TRANSPORT]
// END_CONTRACT: createJsonRpcRequest
function createJsonRpcRequest(
  id: number,
  method: string,
  params: unknown,
  authorizationHeader?: string,
): Request {
  // START_BLOCK_BUILD_JSON_RPC_POST_REQUEST_M_TRANSPORT_SMOKE_003
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  if (typeof authorizationHeader === "string") {
    headers.set("authorization", authorizationHeader);
  }

  return new Request("http://localhost/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });
  // END_BLOCK_BUILD_JSON_RPC_POST_REQUEST_M_TRANSPORT_SMOKE_003
}

// START_CONTRACT: isDeniedGuardDecision
//   PURPOSE: Narrow guard decision union to denied branch for response passthrough in integrated smoke tests.
//   INPUTS: { decision: GuardDecision - Decision returned by authorizeMcpRequest }
//   OUTPUTS: { decision is Extract<GuardDecision, { isAuthorized: false }> - True when auth decision is denied }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: isDeniedGuardDecision
function isDeniedGuardDecision(
  decision: GuardDecision,
): decision is Extract<GuardDecision, { isAuthorized: false }> {
  // START_BLOCK_NARROW_DENIED_DECISION_FOR_TRANSPORT_SMOKE_M_TRANSPORT_SMOKE_007
  return !decision.isAuthorized;
  // END_BLOCK_NARROW_DENIED_DECISION_FOR_TRANSPORT_SMOKE_M_TRANSPORT_SMOKE_007
}

// START_CONTRACT: handleIntegratedMcpRoute
//   PURPOSE: Emulate /mcp route auth guard gating before transport dispatch in integrated smoke tests.
//   INPUTS: { request: Request - MCP HTTP request, deps: IntegratedMcpRouteDependencies - Auth and transport dependencies plus optional transport override }
//   OUTPUTS: { Promise<Response> - Auth-denied response or transport response }
//   SIDE_EFFECTS: [Invokes authorizeMcpRequest and optionally handleMcpRequest]
//   LINKS: [M-MCP-AUTH-GUARD, M-TRANSPORT]
// END_CONTRACT: handleIntegratedMcpRoute
async function handleIntegratedMcpRoute(
  request: Request,
  deps: IntegratedMcpRouteDependencies,
): Promise<Response> {
  // START_BLOCK_RUN_AUTH_GUARD_AND_GATE_TRANSPORT_M_TRANSPORT_SMOKE_006
  const authDecision = await authorizeMcpRequest(request, deps.authDeps);

  if (isDeniedGuardDecision(authDecision)) {
    return authDecision.response;
  }

  const transportHandler = deps.transportHandler ?? handleMcpRequest;
  return transportHandler(request, {
    ...deps.transportDeps,
    logger: deps.transportDeps.logger.child({
      authSubject: authDecision.subject ?? null,
      grantedScopes: authDecision.grantedScopes,
    }),
  });
  // END_BLOCK_RUN_AUTH_GUARD_AND_GATE_TRANSPORT_M_TRANSPORT_SMOKE_006
}

describe("M-TRANSPORT smoke checks", () => {
  it("registerTools returns exactly the 4 allowed proxied tools", () => {
    const tools = registerTools();
    const names = tools.map((tool) => tool.name);

    expect(tools).toHaveLength(4);
    expect(names).toEqual([
      "search_messages",
      "get_message_context",
      "get_related_messages",
      "list_sources",
    ]);
  });

  it("registerTools excludes list_chats", () => {
    const tools = registerTools();
    const names = tools.map((tool) => tool.name);

    expect(names).not.toContain("list_chats");
  });

  it("handleMcpRequest tools/list returns success with exactly 4 tools", async () => {
    const { deps } = createMockTransportDependencies();
    const request = createJsonRpcRequest(1, "tools/list", {});

    const response = await handleMcpRequest(request, deps);
    const payload = (await response.json()) as {
      result: { tools: Array<{ name: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.result.tools).toHaveLength(4);
    expect(payload.result.tools.map((tool) => tool.name)).toEqual([
      "search_messages",
      "get_message_context",
      "get_related_messages",
      "list_sources",
    ]);
  });

  it("handleMcpRequest tools/call passes for each allowed tool with mock proxy service", async () => {
    const { deps, calls } = createMockTransportDependencies();

    const toolInputs: Record<
      "search_messages" | "get_message_context" | "get_related_messages" | "list_sources",
      unknown
    > = {
      search_messages: {},
      get_message_context: { message_uid: "msg-context-1" },
      get_related_messages: { message_uid: "msg-related-1" },
      list_sources: { message_uids: ["test-uid-1"] },
    };

    const allowedToolNames = [
      "search_messages",
      "get_message_context",
      "get_related_messages",
      "list_sources",
    ] as const;

    for (const [index, toolName] of allowedToolNames.entries()) {
      const args = toolInputs[toolName];
      const request = createJsonRpcRequest(index + 100, "tools/call", {
        name: toolName,
        arguments: args,
      });

      const response = await handleMcpRequest(request, deps);
      const payload = (await response.json()) as {
        result: {
          structuredContent: { toolName: string; rawArgs: unknown };
        };
      };

      expect(response.status).toBe(200);
      expect(payload.result.structuredContent).toEqual({
        toolName,
        rawArgs: args,
      });
    }

    expect(calls).toHaveLength(4);
    expect(calls.map((call) => call.toolName)).toEqual([
      "search_messages",
      "get_message_context",
      "get_related_messages",
      "list_sources",
    ]);
  });

  it("integrated /mcp route rejects missing or invalid Authorization headers with 401 and skips transport", async () => {
    const validBearerToken = "token-valid-smoke";
    const { deps: authDeps, verifyCalls } = createMockAuthGuardDependencies({ validBearerToken });
    const { deps: transportDeps } = createMockTransportDependencies();
    let transportInvocationCount = 0;

    const responseWithoutHeader = await handleIntegratedMcpRoute(createJsonRpcRequest(201, "tools/list", {}), {
      authDeps,
      transportDeps,
      transportHandler: async (_request: Request, _deps: McpTransportDependencies) => {
        transportInvocationCount += 1;
        return createJsonResponse(200, { ok: true });
      },
    });

    const responseWithInvalidScheme = await handleIntegratedMcpRoute(
      createJsonRpcRequest(202, "tools/list", {}, "Basic not-bearer"),
      {
        authDeps,
        transportDeps,
        transportHandler: async (_request: Request, _deps: McpTransportDependencies) => {
          transportInvocationCount += 1;
          return createJsonResponse(200, { ok: true });
        },
      },
    );

    const payloadWithoutHeader = (await responseWithoutHeader.json()) as {
      error: { code: string; message: string };
    };
    const payloadWithInvalidScheme = (await responseWithInvalidScheme.json()) as {
      error: { code: string; message: string };
    };

    expect(responseWithoutHeader.status).toBe(401);
    expect(responseWithInvalidScheme.status).toBe(401);
    expect(payloadWithoutHeader.error.code).toBe("UNAUTHORIZED");
    expect(payloadWithInvalidScheme.error.code).toBe("UNAUTHORIZED");

    const headerWithout = responseWithoutHeader.headers.get("www-authenticate") ?? "";
    const headerInvalidScheme = responseWithInvalidScheme.headers.get("www-authenticate") ?? "";
    expect(headerWithout).toContain("Bearer");
    expect(headerInvalidScheme).toContain("Bearer");
    expect(headerWithout).toContain('resource_metadata="https://resource.example.com/.well-known/oauth-protected-resource/mcp"');
    expect(headerWithout).not.toContain('error="');

    expect(transportInvocationCount).toBe(0);
    expect(verifyCalls).toEqual([]);
  });

  it("integrated /mcp route rejects invalid Bearer token with 401 challenge and skips transport", async () => {
    const validBearerToken = "token-valid-smoke";
    const invalidBearerToken = "token-invalid-smoke";
    const { deps: authDeps, verifyCalls } = createMockAuthGuardDependencies({ validBearerToken });
    const { deps: transportDeps } = createMockTransportDependencies();
    let transportInvocationCount = 0;

    const response = await handleIntegratedMcpRoute(
      createJsonRpcRequest(203, "tools/list", {}, `Bearer ${invalidBearerToken}`),
      {
        authDeps,
        transportDeps,
        transportHandler: async (_request: Request, _deps: McpTransportDependencies) => {
          transportInvocationCount += 1;
          return createJsonResponse(200, { ok: true });
        },
      },
    );
    const unauthorizedPayload = (await response.json()) as {
      error: { code: string; message: string };
    };
    const challengeHeader = response.headers.get("www-authenticate") ?? "";

    expect(response.status).toBe(401);
    expect(unauthorizedPayload.error.code).toBe("UNAUTHORIZED");
    expect(challengeHeader).toContain('error="invalid_token"');
    expect(challengeHeader).toContain(
      'resource_metadata="https://resource.example.com/.well-known/oauth-protected-resource/mcp"',
    );
    expect(transportInvocationCount).toBe(0);
    expect(verifyCalls).toEqual([invalidBearerToken]);
  });

  it("integrated /mcp route rejects insufficient-scope token with 403 challenge and skips transport", async () => {
    const validBearerToken = "token-valid-smoke";
    const insufficientScopeBearerToken = "token-insufficient-smoke";
    const { deps: authDeps, verifyCalls } = createMockAuthGuardDependencies({
      validBearerToken,
      insufficientScopeBearerToken,
    });
    const { deps: transportDeps } = createMockTransportDependencies();
    let transportInvocationCount = 0;

    const response = await handleIntegratedMcpRoute(
      createJsonRpcRequest(204, "tools/list", {}, `Bearer ${insufficientScopeBearerToken}`),
      {
        authDeps,
        transportDeps,
        transportHandler: async (_request: Request, _deps: McpTransportDependencies) => {
          transportInvocationCount += 1;
          return createJsonResponse(200, { ok: true });
        },
      },
    );
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };
    const challengeHeader = response.headers.get("www-authenticate") ?? "";

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("FORBIDDEN");
    expect(challengeHeader).toContain('error="insufficient_scope"');
    expect(challengeHeader).toContain('scope="mcp:access"');
    expect(transportInvocationCount).toBe(0);
    expect(verifyCalls).toEqual([insufficientScopeBearerToken]);
  });

  it("integrated /mcp route authorizes valid Bearer token and forwards to transport/proxy", async () => {
    const validBearerToken = "token-valid-smoke";
    const { deps: authDeps, verifyCalls } = createMockAuthGuardDependencies({ validBearerToken });
    const { deps: transportDeps, calls } = createMockTransportDependencies();
    let transportInvocationCount = 0;

    const response = await handleIntegratedMcpRoute(
      createJsonRpcRequest(
        301,
        "tools/call",
        {
          name: "search_messages",
          arguments: {},
        },
        `Bearer ${validBearerToken}`,
      ),
      {
        authDeps,
        transportDeps,
        transportHandler: async (request: Request, deps: McpTransportDependencies) => {
          transportInvocationCount += 1;
          return handleMcpRequest(request, deps);
        },
      },
    );
    const payload = (await response.json()) as {
      result: {
        structuredContent: { toolName: string; rawArgs: unknown };
      };
    };

    expect(response.status).toBe(200);
    expect(verifyCalls).toEqual([validBearerToken]);
    expect(transportInvocationCount).toBe(1);
    expect(payload.result.structuredContent).toEqual({
      toolName: "search_messages",
      rawArgs: {},
    });
    expect(calls).toEqual([
      {
        toolName: "search_messages",
        rawArgs: {},
      },
    ]);
  });
});
