// FILE: src/transport/mcp-transport.smoke.test.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Provide smoke coverage for MCP transport tool registration, request routing, and integrated /mcp auth-gated dispatch behavior.
//   SCOPE: Validate registered tool allowlist shape, tools/list response behavior, tools/call routing through a mock proxy service, and auth guard gating for unauthorized/authorized requests.
//   DEPENDS: M-TRANSPORT, M-MCP-AUTH-GUARD, M-TOOLS-CONTRACTS, M-TOOL-PROXY, M-LOGGER
//   LINKS: M-TRANSPORT, M-MCP-AUTH-GUARD, M-TOOLS-CONTRACTS, M-TOOL-PROXY, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build a no-op logger compatible with Logger interface.
//   createMockTransportDependencies - Build deterministic mock transport dependencies for smoke tests.
//   createMockAuthGuardDependencies - Build deterministic auth guard dependencies for integrated /mcp path tests.
//   createJsonResponse - Build JSON responses for integrated /mcp helper behavior.
//   createJsonRpcRequest - Build valid JSON-RPC MCP POST Request objects.
//   handleIntegratedMcpRoute - Emulate /mcp route auth guard + transport dispatch flow for smoke coverage.
//   TransportSmokeTests - Smoke suite for registerTools, handleMcpRequest, and integrated /mcp auth gating.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Added integrated /mcp auth-gating smoke tests for unauthorized/authorized request flow.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import { authorizeMcpRequest } from "../auth/mcp-auth-guard";
import type { McpAuthGuardDependencies } from "../auth/mcp-auth-guard";
import type { Logger } from "../logger/index";
import { handleMcpRequest, registerTools } from "./mcp-transport";
import type { McpTransportDependencies } from "./mcp-transport";
import type { ToolProxyService } from "../tools/proxy-service";

type MockCall = {
  toolName: string;
  rawArgs: unknown;
};

type IntegratedMcpRouteDependencies = {
  authDeps: McpAuthGuardDependencies;
  transportDeps: McpTransportDependencies;
  transportHandler?: typeof handleMcpRequest;
};

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
//   PURPOSE: Build auth guard dependencies that authorize exactly one Bearer token and capture repository lookups.
//   INPUTS: { validRawApiKey: string - Token value that resolves to an active API key record }
//   OUTPUTS: { deps: McpAuthGuardDependencies - Mock auth guard dependencies, resolveCalls: string[] - Captured resolveApiKey lookups }
//   SIDE_EFFECTS: [Captures resolveApiKey calls in memory]
//   LINKS: [M-MCP-AUTH-GUARD, M-LOGGER]
// END_CONTRACT: createMockAuthGuardDependencies
function createMockAuthGuardDependencies(validRawApiKey: string): {
  deps: McpAuthGuardDependencies;
  resolveCalls: string[];
} {
  // START_BLOCK_CREATE_MOCK_AUTH_GUARD_DEPS_M_TRANSPORT_SMOKE_004
  const resolveCalls: string[] = [];
  const activeRecord = {
    id: "11111111-2222-4333-8444-555555555555",
    keyPrefix: "jp_aaaaaaaaaaaa",
    label: "transport-smoke-test",
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  return {
    deps: {
      logger: createNoopLogger(),
      apiKeyRepository: {
        resolveApiKey: async (rawApiKey: string) => {
          resolveCalls.push(rawApiKey);
          return rawApiKey === validRawApiKey ? activeRecord : null;
        },
      },
    },
    resolveCalls,
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

// START_CONTRACT: handleIntegratedMcpRoute
//   PURPOSE: Emulate /mcp route auth guard gating before transport dispatch in integrated smoke tests.
//   INPUTS: { request: Request - MCP HTTP request, deps: IntegratedMcpRouteDependencies - Auth and transport dependencies plus optional transport override }
//   OUTPUTS: { Promise<Response> - Unauthorized JSON response or transport response }
//   SIDE_EFFECTS: [Invokes authorizeMcpRequest and optionally handleMcpRequest]
//   LINKS: [M-MCP-AUTH-GUARD, M-TRANSPORT]
// END_CONTRACT: handleIntegratedMcpRoute
async function handleIntegratedMcpRoute(
  request: Request,
  deps: IntegratedMcpRouteDependencies,
): Promise<Response> {
  // START_BLOCK_RUN_AUTH_GUARD_AND_GATE_TRANSPORT_M_TRANSPORT_SMOKE_006
  const authDecision = await authorizeMcpRequest(request.headers.get("authorization"), deps.authDeps);

  if (!authDecision.isAuthorized) {
    return createJsonResponse(401, {
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing MCP API key.",
      },
    });
  }

  const transportHandler = deps.transportHandler ?? handleMcpRequest;
  return transportHandler(request, {
    ...deps.transportDeps,
    logger: deps.transportDeps.logger.child({
      apiKeyId: authDecision.apiKeyId,
      keyPrefix: authDecision.keyPrefix,
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
      get_message_context: { message_id: "msg-context-1" },
      get_related_messages: { message_id: "msg-related-1" },
      list_sources: {},
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
    const validRawApiKey =
      "jp_aaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const { deps: authDeps, resolveCalls } = createMockAuthGuardDependencies(validRawApiKey);
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

    const unauthorizedPayloadWithoutHeader = (await responseWithoutHeader.json()) as {
      error: { code: string; message: string };
    };
    const unauthorizedPayloadWithInvalidScheme = (await responseWithInvalidScheme.json()) as {
      error: { code: string; message: string };
    };

    expect(responseWithoutHeader.status).toBe(401);
    expect(responseWithInvalidScheme.status).toBe(401);
    expect(unauthorizedPayloadWithoutHeader).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing MCP API key.",
      },
    });
    expect(unauthorizedPayloadWithInvalidScheme).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing MCP API key.",
      },
    });
    expect(transportInvocationCount).toBe(0);
    expect(resolveCalls).toEqual([]);
  });

  it("integrated /mcp route authorizes valid Bearer token and forwards to transport/proxy", async () => {
    const validRawApiKey =
      "jp_aaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const { deps: authDeps, resolveCalls } = createMockAuthGuardDependencies(validRawApiKey);
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
        `Bearer ${validRawApiKey}`,
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
    expect(resolveCalls).toEqual([validRawApiKey]);
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
