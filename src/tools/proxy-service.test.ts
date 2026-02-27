// FILE: src/tools/proxy-service.test.ts
// VERSION: 1.2.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify deterministic orchestration and error mapping for M-TOOL-PROXY.
//   SCOPE: Assert validate->policy->upstream->normalize flow, tool allowlist enforcement, internal search chat_ids injection, and deterministic proxy error codes.
//   DEPENDS: M-TOOL-PROXY, M-TG-CHAT-RAG-CLIENT, M-CONFIG, M-LOGGER
//   LINKS: M-TOOL-PROXY, M-TG-CHAT-RAG-CLIENT, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   buildTestConfig - Build deterministic AppConfig fixture for proxy tests.
//   createNoopLogger - Provide logger fixture that keeps tests focused on behavior.
//   assertProxyExecutionError - Assert async calls fail with typed ProxyExecutionError and expected code.
//   ToolProxyServiceTests - Contract tests for orchestration and deterministic error branches.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.2.0 - Updated expectations to content-only MCP tool results without structuredContent to match FastMCP strict output schema.
//   PREVIOUS: v1.1.0 - Updated search_messages fixtures for strict filters schema and direct chat_ids-forbidden validation path.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { AppConfig } from "../config/index";
import { UpstreamCallError, type TgChatRagClient } from "../integrations/tg-chat-rag-client";
import type { Logger } from "../logger/index";
import { ProxyExecutionError, createToolProxyService, type ProxyErrorCode } from "./proxy-service";

// START_CONTRACT: buildTestConfig
//   PURPOSE: Create deterministic AppConfig fixture for proxy tests.
//   INPUTS: { none }
//   OUTPUTS: { AppConfig - Minimal valid runtime config fixture }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG, M-TOOL-PROXY]
// END_CONTRACT: buildTestConfig
function buildTestConfig(): AppConfig {
  // START_BLOCK_BUILD_STATIC_APP_CONFIG_FIXTURE_M_TOOL_PROXY_TEST_001
  return {
    port: 3000,
    publicUrl: "https://travel.example.com/",
    rootAuthToken: "root-secret",
    tgChatRag: {
      baseUrl: "https://upstream.example.com/",
      bearerToken: "service-token",
      chatIds: ["chat-alpha", "chat-bravo"],
      timeoutMs: 15000,
    },
    logto: {
      tenantUrl: "https://tenant.example.com/",
      clientId: "client-id",
      clientSecret: "client-secret",
      oidcAuthEndpoint: "https://tenant.example.com/oidc/auth",
      oidcTokenEndpoint: "https://tenant.example.com/oidc/token",
    },
  };
  // END_BLOCK_BUILD_STATIC_APP_CONFIG_FIXTURE_M_TOOL_PROXY_TEST_001
}

// START_CONTRACT: createNoopLogger
//   PURPOSE: Provide a logger fixture that satisfies Logger interface without side effects.
//   INPUTS: { none }
//   OUTPUTS: { Logger - No-op logger implementation }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_BUILD_NOOP_LOGGER_FIXTURE_M_TOOL_PROXY_TEST_002
  const noop = (): void => {};
  let loggerRef: Logger;
  loggerRef = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => loggerRef,
  };
  return loggerRef;
  // END_BLOCK_BUILD_NOOP_LOGGER_FIXTURE_M_TOOL_PROXY_TEST_002
}

// START_CONTRACT: assertProxyExecutionError
//   PURPOSE: Assert async execution fails with ProxyExecutionError and expected deterministic code.
//   INPUTS: { execute: () => Promise<unknown> - Async call expected to fail, expectedCode: ProxyErrorCode - Expected deterministic proxy error code }
//   OUTPUTS: { Promise<ProxyExecutionError> - Captured typed proxy execution error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TOOL-PROXY]
// END_CONTRACT: assertProxyExecutionError
async function assertProxyExecutionError(
  execute: () => Promise<unknown>,
  expectedCode: ProxyErrorCode,
): Promise<ProxyExecutionError> {
  // START_BLOCK_ASSERT_TYPED_PROXY_EXECUTION_ERROR_M_TOOL_PROXY_TEST_003
  let thrown: unknown;
  try {
    await execute();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ProxyExecutionError);
  const proxyError = thrown as ProxyExecutionError;
  expect(proxyError.code).toBe(expectedCode);
  return proxyError;
  // END_BLOCK_ASSERT_TYPED_PROXY_EXECUTION_ERROR_M_TOOL_PROXY_TEST_003
}

describe("M-TOOL-PROXY deterministic orchestration", () => {
  it("executes search_messages through validate->policy->upstream->normalize and injects internal chat_ids", async () => {
    const config = buildTestConfig();
    const logger = createNoopLogger();
    const upstreamResponse = {
      total: 1,
      hits: [{ message_uid: "msg-001", score: 0.91 }],
    } as Record<string, unknown>;

    const callLog: Array<{ toolName: string; payload: Record<string, unknown> }> = [];
    const client: TgChatRagClient = {
      callMethod: async (toolName, payload) => {
        callLog.push({ toolName, payload });
        return upstreamResponse;
      },
    };

    const proxyService = createToolProxyService(config, logger, client);
    const rawArgs = {
      query: "tokyo ramen",
      top_k: 5,
      filters: {
        authors: ["alice", "bob"],
        has_media: true,
      },
    };

    const result = await proxyService.executeTool("search_messages", rawArgs);

    expect(callLog).toHaveLength(1);
    expect(callLog[0]?.toolName).toBe("search_messages");
    expect(callLog[0]?.payload).toEqual({
      query: "tokyo ramen",
      top_k: 5,
      filters: {
        authors: ["alice", "bob"],
        has_media: true,
        chat_ids: ["chat-alpha", "chat-bravo"],
      },
    });
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(upstreamResponse) }],
    });
  });

  it("rejects non-allowlisted tools with UNSUPPORTED_TOOL without calling upstream", async () => {
    const config = buildTestConfig();
    const logger = createNoopLogger();
    let callCount = 0;

    const client: TgChatRagClient = {
      callMethod: async () => {
        callCount += 1;
        return {};
      },
    };

    const proxyService = createToolProxyService(config, logger, client);
    const error = await assertProxyExecutionError(
      () => proxyService.executeTool("list_chats", {}),
      "UNSUPPORTED_TOOL",
    );

    expect(callCount).toBe(0);
    expect(error.message).toBe("Tool is not supported by proxy surface.");
  });

  it("maps schema validation failures to VALIDATION_ERROR and never calls upstream", async () => {
    const config = buildTestConfig();
    const logger = createNoopLogger();
    let callCount = 0;

    const client: TgChatRagClient = {
      callMethod: async () => {
        callCount += 1;
        return {};
      },
    };

    const proxyService = createToolProxyService(config, logger, client);
    const error = await assertProxyExecutionError(
      () => proxyService.executeTool("get_message_context", { message_uid: " " }),
      "VALIDATION_ERROR",
    );

    expect(callCount).toBe(0);
    expect(error.details?.toolName).toBe("get_message_context");
    expect(Array.isArray(error.details?.details)).toBe(true);
    expect((error.details?.details as unknown[]).some((detail) => String(detail).includes("message_uid"))).toBe(true);
  });

  it("keeps caller-provided filters.chat_ids forbidden at the public boundary", async () => {
    const config = buildTestConfig();
    const logger = createNoopLogger();
    let callCount = 0;

    const client: TgChatRagClient = {
      callMethod: async () => {
        callCount += 1;
        return {};
      },
    };

    const proxyService = createToolProxyService(config, logger, client);
    const error = await assertProxyExecutionError(
      () =>
        proxyService.executeTool("search_messages", {
          query: "kyoto",
          filters: {
            chat_ids: ["chat-override"],
          },
        }),
      "VALIDATION_ERROR",
    );

    expect(callCount).toBe(0);
    expect(Array.isArray(error.details?.details)).toBe(true);
    expect(
      (error.details?.details as unknown[]).some((detail) =>
        String(detail).includes("forbids filters.chat_ids"),
      ),
    ).toBe(true);
  });

  it("maps UpstreamCallError to deterministic UPSTREAM_ERROR", async () => {
    const config = buildTestConfig();
    const logger = createNoopLogger();
    const client: TgChatRagClient = {
      callMethod: async () => {
        throw new UpstreamCallError("UPSTREAM_HTTP_ERROR", "Upstream request failed.", 502, {
          bodyPreview: "bad gateway",
        });
      },
    };

    const proxyService = createToolProxyService(config, logger, client);
    const error = await assertProxyExecutionError(
      () =>
        proxyService.executeTool("get_related_messages", {
          message_uid: "msg-002",
        }),
      "UPSTREAM_ERROR",
    );

    expect(error.details?.toolName).toBe("get_related_messages");
    expect(error.details?.upstreamCode).toBe("UPSTREAM_HTTP_ERROR");
    expect(error.details?.status).toBe(502);
  });
});
