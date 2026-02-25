// FILE: src/transport/mcp-transport.smoke.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Provide smoke coverage for MCP transport tool registration and basic request routing.
//   SCOPE: Validate registered tool allowlist shape, tools/list response behavior, and tools/call routing through a mock proxy service.
//   DEPENDS: M-TRANSPORT, M-TOOLS-CONTRACTS, M-TOOL-PROXY, M-LOGGER
//   LINKS: M-TRANSPORT, M-TOOLS-CONTRACTS, M-TOOL-PROXY, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build a no-op logger compatible with Logger interface.
//   createMockTransportDependencies - Build deterministic mock transport dependencies for smoke tests.
//   createJsonRpcRequest - Build valid JSON-RPC MCP POST Request objects.
//   TransportSmokeTests - Smoke suite for registerTools and handleMcpRequest.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Added smoke checks for tool registration and MCP tools/list/tools/call flows.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { Logger } from "../logger/index";
import { handleMcpRequest, registerTools } from "./mcp-transport";
import type { McpTransportDependencies } from "./mcp-transport";
import type { ToolProxyService } from "../tools/proxy-service";

type MockCall = {
  toolName: string;
  rawArgs: unknown;
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

// START_CONTRACT: createJsonRpcRequest
//   PURPOSE: Build valid MCP JSON-RPC POST requests for transport smoke execution.
//   INPUTS: { id: number - JSON-RPC request id, method: string - JSON-RPC method, params: unknown - JSON-RPC params payload }
//   OUTPUTS: { Request - HTTP request with required MCP transport headers }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TRANSPORT]
// END_CONTRACT: createJsonRpcRequest
function createJsonRpcRequest(id: number, method: string, params: unknown): Request {
  // START_BLOCK_BUILD_JSON_RPC_POST_REQUEST_M_TRANSPORT_SMOKE_003
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });
  // END_BLOCK_BUILD_JSON_RPC_POST_REQUEST_M_TRANSPORT_SMOKE_003
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
});
