// FILE: src/integrations/tg-chat-rag-client.test.ts
// VERSION: 1.0.1
// START_MODULE_CONTRACT
//   PURPOSE: Validate deterministic upstream-call behavior for M-TG-CHAT-RAG-CLIENT.
//   SCOPE: Assert URL/header/body construction, timeout mapping, non-2xx HTTP mapping, and success JSON object parsing.
//   DEPENDS: M-TG-CHAT-RAG-CLIENT, M-CONFIG, M-LOGGER
//   LINKS: M-TG-CHAT-RAG-CLIENT-TEST, M-TG-CHAT-RAG-CLIENT, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build deterministic no-op logger implementation.
//   createTestConfig - Build AppConfig fixture with overrideable tg-chat-rag settings.
//   installFetchMock - Replace global fetch with deterministic per-test mock and capture invocations.
//   readHeaderValue - Extract header values from HeadersInit variants.
//   assertUpstreamCallError - Capture and assert typed UpstreamCallError instances.
//   TgChatRagClientTests - Focused tests for success and primary upstream error branches.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.1 - Fixed TypeScript type compatibility for Bun runtime globals and strict null checks in fetch-call assertions.
// END_CHANGE_SUMMARY

import { afterEach, describe, expect, it } from "bun:test";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import {
  callMethod,
  createTgChatRagClient,
  type UpstreamErrorCode,
  UpstreamCallError,
} from "./tg-chat-rag-client";

type FetchCall = {
  input: Request | URL | string;
  init?: RequestInit;
};

type FetchImpl = (input: Request | URL | string, init?: RequestInit) => Promise<Response>;

const ORIGINAL_FETCH = globalThis.fetch;
let capturedFetchCalls: FetchCall[] = [];

// START_CONTRACT: createNoopLogger
//   PURPOSE: Build inert logger implementation for deterministic integration client tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - No-op logger with child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_FOR_TG_CHAT_RAG_CLIENT_TESTS_M_TG_CHAT_RAG_CLIENT_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_FOR_TG_CHAT_RAG_CLIENT_TESTS_M_TG_CHAT_RAG_CLIENT_TEST_001
}

// START_CONTRACT: createTestConfig
//   PURPOSE: Build deterministic AppConfig fixture with optional tg-chat-rag overrides.
//   INPUTS: { tgOverrides: Partial<AppConfig["tgChatRag"]> | undefined - Optional tg-chat-rag override values }
//   OUTPUTS: { AppConfig - Runtime config fixture for client tests }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG]
// END_CONTRACT: createTestConfig
function createTestConfig(tgOverrides?: Partial<AppConfig["tgChatRag"]>): AppConfig {
  // START_BLOCK_BUILD_APP_CONFIG_FIXTURE_FOR_TG_CLIENT_TESTS_M_TG_CHAT_RAG_CLIENT_TEST_002
  return {
    port: 3000,
    publicUrl: "https://travel.example.com/",
    rootAuthToken: "root-token",
    tgChatRag: {
      baseUrl: "https://upstream.example.com/",
      bearerToken: "service-bearer-token",
      chatIds: ["chat-1"],
      timeoutMs: 15000,
      ...tgOverrides,
    },
    logto: {
      tenantUrl: "https://tenant.logto.app/",
      clientId: "client-id",
      clientSecret: "client-secret",
      oidcAuthEndpoint: "https://tenant.logto.app/oidc/auth",
      oidcTokenEndpoint: "https://tenant.logto.app/oidc/token",
    },
  };
  // END_BLOCK_BUILD_APP_CONFIG_FIXTURE_FOR_TG_CLIENT_TESTS_M_TG_CHAT_RAG_CLIENT_TEST_002
}

// START_CONTRACT: installFetchMock
//   PURPOSE: Install a deterministic fetch mock and capture call arguments for assertions.
//   INPUTS: { impl: FetchImpl - Mock implementation used for fetch responses }
//   OUTPUTS: { void - No return value }
//   SIDE_EFFECTS: [Replaces globalThis.fetch and stores call arguments]
//   LINKS: [M-TG-CHAT-RAG-CLIENT]
// END_CONTRACT: installFetchMock
function installFetchMock(impl: FetchImpl): void {
  // START_BLOCK_INSTALL_FETCH_MOCK_AND_CAPTURE_CALLS_M_TG_CHAT_RAG_CLIENT_TEST_003
  capturedFetchCalls = [];
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    capturedFetchCalls.push({ input, init });
    return impl(input, init);
  }) as typeof fetch;
  // END_BLOCK_INSTALL_FETCH_MOCK_AND_CAPTURE_CALLS_M_TG_CHAT_RAG_CLIENT_TEST_003
}

// START_CONTRACT: readHeaderValue
//   PURPOSE: Normalize header access across all HeadersInit variants.
//   INPUTS: { headers: HeadersInit | undefined - Headers container, headerName: string - Header to read }
//   OUTPUTS: { string | null - Resolved header value when present }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TG-CHAT-RAG-CLIENT]
// END_CONTRACT: readHeaderValue
function readHeaderValue(headers: RequestInit["headers"], headerName: string): string | null {
  // START_BLOCK_READ_HEADER_VALUE_FROM_HEADERS_INIT_M_TG_CHAT_RAG_CLIENT_TEST_004
  if (!headers) {
    return null;
  }

  if (headers instanceof Headers) {
    return headers.get(headerName);
  }

  const normalizedHeaderName = headerName.toLowerCase();
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        entry[0].toLowerCase() === normalizedHeaderName &&
        typeof entry[1] === "string"
      ) {
        return entry[1];
      }
    }
    return null;
  }

  const byDirectName = headers[headerName];
  if (typeof byDirectName === "string") {
    return byDirectName;
  }

  const byLowercaseName = headers[normalizedHeaderName];
  return typeof byLowercaseName === "string" ? byLowercaseName : null;
  // END_BLOCK_READ_HEADER_VALUE_FROM_HEADERS_INIT_M_TG_CHAT_RAG_CLIENT_TEST_004
}

// START_CONTRACT: assertUpstreamCallError
//   PURPOSE: Execute async call and assert it fails with typed UpstreamCallError code.
//   INPUTS: { execute: () => Promise<unknown> - Async call expected to fail, expectedCode: UpstreamErrorCode - Expected normalized upstream error code }
//   OUTPUTS: { Promise<UpstreamCallError> - Captured typed upstream error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TG-CHAT-RAG-CLIENT]
// END_CONTRACT: assertUpstreamCallError
async function assertUpstreamCallError(
  execute: () => Promise<unknown>,
  expectedCode: UpstreamErrorCode,
): Promise<UpstreamCallError> {
  // START_BLOCK_ASSERT_TYPED_UPSTREAM_CALL_ERROR_M_TG_CHAT_RAG_CLIENT_TEST_005
  let thrown: unknown;
  try {
    await execute();
  } catch (error: unknown) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(UpstreamCallError);
  const upstreamError = thrown as UpstreamCallError;
  expect(upstreamError.code).toBe(expectedCode);
  return upstreamError;
  // END_BLOCK_ASSERT_TYPED_UPSTREAM_CALL_ERROR_M_TG_CHAT_RAG_CLIENT_TEST_005
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  capturedFetchCalls = [];
});

describe("M-TG-CHAT-RAG-CLIENT deterministic method-call contract", () => {
  it("posts to /api/v1/methods/<tool_name> with bearer token and returns parsed JSON object", async () => {
    const config = createTestConfig({
      baseUrl: "https://upstream.example.com///",
    });
    const logger = createNoopLogger();
    const client = createTgChatRagClient(config, logger);
    const payload = { query: "tokyo ramen", top_k: 5 };

    installFetchMock(async () => {
      return new Response(JSON.stringify({ ok: true, count: 3 }), { status: 200 });
    });

    const response = await client.callMethod(" search_messages ", payload);

    expect(response).toEqual({ ok: true, count: 3 });
    expect(capturedFetchCalls).toHaveLength(1);

    const call = capturedFetchCalls[0];
    if (!call) {
      throw new Error("Expected one captured fetch call.");
    }
    expect(String(call.input)).toBe("https://upstream.example.com/api/v1/methods/search_messages");
    expect(call.init?.method).toBe("POST");
    expect(readHeaderValue(call.init?.headers, "Authorization")).toBe(
      "Bearer service-bearer-token",
    );
    expect(readHeaderValue(call.init?.headers, "Content-Type")).toBe("application/json");
    expect(call.init?.body).toBe(JSON.stringify(payload));
  });

  it("maps non-2xx upstream responses to UPSTREAM_HTTP_ERROR with status and preview", async () => {
    installFetchMock(async () => {
      return new Response("bad gateway", { status: 502 });
    });

    const error = await assertUpstreamCallError(
      () => callMethod(createTestConfig(), createNoopLogger(), "list_sources", { message_uids: ["1"] }),
      "UPSTREAM_HTTP_ERROR",
    );

    expect(error.status).toBe(502);
    expect(error.details?.status).toBe(502);
    expect(error.details?.toolName).toBe("list_sources");
    expect(error.details?.bodyPreview).toBe("bad gateway");
  });

  it("maps timeout-driven aborted requests to UPSTREAM_TIMEOUT", async () => {
    installFetchMock(async (_input, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;

        if (!(signal instanceof AbortSignal)) {
          reject(new Error("Missing AbortSignal in fetch init."));
          return;
        }

        if (signal.aborted) {
          const timeoutError = new Error("Timed out");
          timeoutError.name = "TimeoutError";
          reject(timeoutError);
          return;
        }

        signal.addEventListener(
          "abort",
          () => {
            const timeoutError = new Error("Timed out");
            timeoutError.name = "TimeoutError";
            reject(timeoutError);
          },
          { once: true },
        );
      });
    });

    const error = await assertUpstreamCallError(
      () =>
        callMethod(
          createTestConfig({ timeoutMs: 10 }),
          createNoopLogger(),
          "get_message_context",
          { message_uid: "msg-1" },
        ),
      "UPSTREAM_TIMEOUT",
    );

    expect(error.details?.toolName).toBe("get_message_context");
    expect(typeof error.details?.durationMs).toBe("number");
  });

  it("maps invalid success JSON to UPSTREAM_PROTOCOL_ERROR", async () => {
    installFetchMock(async () => {
      return new Response("not-json", { status: 200 });
    });

    const error = await assertUpstreamCallError(
      () =>
        callMethod(createTestConfig(), createNoopLogger(), "get_related_messages", {
          message_uid: "msg-2",
        }),
      "UPSTREAM_PROTOCOL_ERROR",
    );

    expect(error.status).toBe(200);
    expect(error.details?.toolName).toBe("get_related_messages");
    expect(error.details?.bodyPreview).toBe("not-json");
  });

  it("maps success JSON arrays to UPSTREAM_PROTOCOL_ERROR because object payload is required", async () => {
    installFetchMock(async () => {
      return new Response(JSON.stringify(["msg-1", "msg-2"]), { status: 200 });
    });

    const error = await assertUpstreamCallError(
      () =>
        callMethod(createTestConfig(), createNoopLogger(), "list_sources", {
          message_uids: ["msg-1"],
        }),
      "UPSTREAM_PROTOCOL_ERROR",
    );

    expect(error.status).toBe(200);
    expect(error.details?.toolName).toBe("list_sources");
  });
});
