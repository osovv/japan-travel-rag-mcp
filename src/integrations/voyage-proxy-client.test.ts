// FILE: src/integrations/voyage-proxy-client.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate deterministic Voyage proxy embedding behavior for M-VOYAGE-PROXY-CLIENT.
//   SCOPE: Assert URL/header/body construction, trailing-slash handling, timeout mapping, non-2xx HTTP mapping, token usage logging, embedDocuments batch return, embedQuery single return, and error normalization.
//   DEPENDS: M-VOYAGE-PROXY-CLIENT, M-CONFIG, M-LOGGER
//   LINKS: M-VOYAGE-PROXY-CLIENT-TEST, M-VOYAGE-PROXY-CLIENT, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build deterministic no-op logger implementation.
//   createTestConfig - Build AppConfig fixture with overrideable proxy settings.
//   installFetchMock - Replace global fetch with deterministic per-test mock and capture invocations.
//   readHeaderValue - Extract header values from HeadersInit variants.
//   assertVoyageProxyError - Capture and assert typed VoyageProxyError instances.
//   assertVoyageTimeoutError - Capture and assert typed VoyageTimeoutError instances.
//   VoyageProxyClientTests - Focused tests for success and primary error branches.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial test suite for M-VOYAGE-PROXY-CLIENT.
// END_CHANGE_SUMMARY

import { afterEach, describe, expect, it } from "bun:test";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import {
  callEmbeddingEndpoint,
  computeVoyageRetryDelay,
  createVoyageProxyClient,
  isTransientVoyageError,
  VoyageProxyError,
  VoyageTimeoutError,
  type VoyageEmbeddingRequest,
} from "./voyage-proxy-client";

type FetchCall = {
  input: Request | URL | string;
  init?: RequestInit;
};

type FetchImpl = (input: Request | URL | string, init?: RequestInit) => Promise<Response>;

const ORIGINAL_FETCH = globalThis.fetch;
let capturedFetchCalls: FetchCall[] = [];

// START_CONTRACT: createNoopLogger
//   PURPOSE: Build inert logger implementation for deterministic Voyage client tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - No-op logger with child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_M_VOYAGE_PROXY_CLIENT_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_M_VOYAGE_PROXY_CLIENT_TEST_001
}

// START_CONTRACT: createTestConfig
//   PURPOSE: Build deterministic AppConfig fixture with optional proxy overrides.
//   INPUTS: { proxyOverrides: Partial<AppConfig["proxy"]> | undefined - Optional proxy override values }
//   OUTPUTS: { AppConfig - Runtime config fixture for Voyage client tests }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG]
// END_CONTRACT: createTestConfig
function createTestConfig(proxyOverrides?: Partial<AppConfig["proxy"]>): AppConfig {
  // START_BLOCK_BUILD_APP_CONFIG_FIXTURE_M_VOYAGE_PROXY_CLIENT_TEST_002
  return {
    port: 3000,
    publicUrl: "https://travel.example.com/",
    rootAuthToken: "root-token",
    databaseUrl: "postgres://localhost:5432/test",
    oauthSessionSecret: "test-oauth-session-secret-at-least-32-characters",
    tgChatRag: {
      baseUrl: "https://upstream.example.com/",
      bearerToken: "service-bearer-token",
      chatIds: ["chat-1"],
      timeoutMs: 15000,
    },
    logto: {
      tenantUrl: "https://tenant.logto.app/",
      clientId: "client-id",
      clientSecret: "client-secret",
      oidcAuthEndpoint: "https://tenant.logto.app/oidc/auth",
      oidcTokenEndpoint: "https://tenant.logto.app/oidc/token",
    },
    portal: {
      sessionSecret: "test-portal-session-secret",
      logtoAppId: "test-portal-app-id",
      logtoAppSecret: "test-portal-app-secret",
      logtoM2mAppId: "test-m2m-app-id",
      logtoM2mAppSecret: "test-m2m-app-secret",
      logtoManagementApiResource: "https://mgmt.logto.app/api",
      mcpUserRoleId: "test-role-id",
      sessionTtlSeconds: 604800,
    },
    proxy: {
      baseUrl: "https://proxy.example.com/",
      secret: "proxy-secret-key",
      voyageApiKey: "voyage-api-key",
      spiderApiKey: "spider-api-key",
      ...proxyOverrides,
    },
  };
  // END_BLOCK_BUILD_APP_CONFIG_FIXTURE_M_VOYAGE_PROXY_CLIENT_TEST_002
}

// START_CONTRACT: installFetchMock
//   PURPOSE: Install a deterministic fetch mock and capture call arguments for assertions.
//   INPUTS: { impl: FetchImpl - Mock implementation used for fetch responses }
//   OUTPUTS: { void }
//   SIDE_EFFECTS: [Replaces globalThis.fetch and stores call arguments]
//   LINKS: [M-VOYAGE-PROXY-CLIENT]
// END_CONTRACT: installFetchMock
function installFetchMock(impl: FetchImpl): void {
  // START_BLOCK_INSTALL_FETCH_MOCK_M_VOYAGE_PROXY_CLIENT_TEST_003
  capturedFetchCalls = [];
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    capturedFetchCalls.push({ input, init });
    return impl(input, init);
  }) as typeof fetch;
  // END_BLOCK_INSTALL_FETCH_MOCK_M_VOYAGE_PROXY_CLIENT_TEST_003
}

// START_CONTRACT: readHeaderValue
//   PURPOSE: Normalize header access across all HeadersInit variants.
//   INPUTS: { headers: HeadersInit | undefined - Headers container, headerName: string - Header to read }
//   OUTPUTS: { string | null - Resolved header value when present }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-VOYAGE-PROXY-CLIENT]
// END_CONTRACT: readHeaderValue
function readHeaderValue(headers: RequestInit["headers"], headerName: string): string | null {
  // START_BLOCK_READ_HEADER_VALUE_M_VOYAGE_PROXY_CLIENT_TEST_004
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
  // END_BLOCK_READ_HEADER_VALUE_M_VOYAGE_PROXY_CLIENT_TEST_004
}

// START_CONTRACT: assertVoyageProxyError
//   PURPOSE: Execute async call and assert it fails with VoyageProxyError.
//   INPUTS: { execute: () => Promise<unknown> - Async call expected to fail }
//   OUTPUTS: { Promise<VoyageProxyError> - Captured typed error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-VOYAGE-PROXY-CLIENT]
// END_CONTRACT: assertVoyageProxyError
async function assertVoyageProxyError(
  execute: () => Promise<unknown>,
): Promise<VoyageProxyError> {
  // START_BLOCK_ASSERT_VOYAGE_PROXY_ERROR_M_VOYAGE_PROXY_CLIENT_TEST_005
  let thrown: unknown;
  try {
    await execute();
  } catch (error: unknown) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(VoyageProxyError);
  const voyageError = thrown as VoyageProxyError;
  expect(voyageError.code).toBe("VOYAGE_PROXY_ERROR");
  return voyageError;
  // END_BLOCK_ASSERT_VOYAGE_PROXY_ERROR_M_VOYAGE_PROXY_CLIENT_TEST_005
}

// START_CONTRACT: assertVoyageTimeoutError
//   PURPOSE: Execute async call and assert it fails with VoyageTimeoutError.
//   INPUTS: { execute: () => Promise<unknown> - Async call expected to fail }
//   OUTPUTS: { Promise<VoyageTimeoutError> - Captured typed error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-VOYAGE-PROXY-CLIENT]
// END_CONTRACT: assertVoyageTimeoutError
async function assertVoyageTimeoutError(
  execute: () => Promise<unknown>,
): Promise<VoyageTimeoutError> {
  // START_BLOCK_ASSERT_VOYAGE_TIMEOUT_ERROR_M_VOYAGE_PROXY_CLIENT_TEST_006
  let thrown: unknown;
  try {
    await execute();
  } catch (error: unknown) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(VoyageTimeoutError);
  const voyageError = thrown as VoyageTimeoutError;
  expect(voyageError.code).toBe("VOYAGE_TIMEOUT");
  return voyageError;
  // END_BLOCK_ASSERT_VOYAGE_TIMEOUT_ERROR_M_VOYAGE_PROXY_CLIENT_TEST_006
}

function createMockEmbeddingResponse(
  embeddings: number[][],
  model = "voyage-4",
  totalTokens = 100,
) {
  return {
    object: "list",
    data: embeddings.map((embedding, index) => ({
      object: "embedding",
      embedding,
      index,
    })),
    model,
    usage: { total_tokens: totalTokens },
  };
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  capturedFetchCalls = [];
});

describe("M-VOYAGE-PROXY-CLIENT deterministic embedding contract", () => {
  it("posts to proxy embedding endpoint with correct headers and returns parsed embedding response", async () => {
    const config = createTestConfig();
    const logger = createNoopLogger();

    const mockResponse = createMockEmbeddingResponse(
      [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
      "voyage-4",
      42,
    );

    installFetchMock(async () => {
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const result = await callEmbeddingEndpoint(config, logger, {
      input: ["hello world", "foo bar"],
      input_type: "document",
    });

    expect(result.data).toHaveLength(2);
    expect(result.data[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result.data[1].embedding).toEqual([0.4, 0.5, 0.6]);
    expect(result.model).toBe("voyage-4");
    expect(result.usage.total_tokens).toBe(42);

    expect(capturedFetchCalls).toHaveLength(1);

    const call = capturedFetchCalls[0];
    if (!call) {
      throw new Error("Expected one captured fetch call.");
    }

    expect(String(call.input)).toBe("https://proxy.example.com/api.voyageai.com/v1/embeddings");
    expect(call.init?.method).toBe("POST");
    expect(readHeaderValue(call.init?.headers, "Authorization")).toBe("Bearer voyage-api-key");
    expect(readHeaderValue(call.init?.headers, "X-Proxy-Key")).toBe("proxy-secret-key");
    expect(readHeaderValue(call.init?.headers, "Content-Type")).toBe("application/json");

    const parsedBody = JSON.parse(call.init?.body as string);
    expect(parsedBody.model).toBe("voyage-4");
    expect(parsedBody.input).toEqual(["hello world", "foo bar"]);
    expect(parsedBody.input_type).toBe("document");
  });

  it("strips trailing slashes from proxy base URL before appending embedding path", async () => {
    const config = createTestConfig({ baseUrl: "https://proxy.example.com///" });
    const logger = createNoopLogger();

    const mockResponse = createMockEmbeddingResponse([[0.1]], "voyage-4", 5);

    installFetchMock(async () => {
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    await callEmbeddingEndpoint(config, logger, {
      input: ["test"],
      input_type: "query",
    });

    const call = capturedFetchCalls[0];
    if (!call) {
      throw new Error("Expected one captured fetch call.");
    }

    expect(String(call.input)).toBe("https://proxy.example.com/api.voyageai.com/v1/embeddings");
  });

  it("sends query input_type for query embedding requests", async () => {
    const config = createTestConfig();
    const logger = createNoopLogger();

    const mockResponse = createMockEmbeddingResponse([[0.1, 0.2]], "voyage-4", 10);

    installFetchMock(async () => {
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    await callEmbeddingEndpoint(config, logger, {
      input: ["search query"],
      input_type: "query",
    });

    const call = capturedFetchCalls[0];
    if (!call) {
      throw new Error("Expected one captured fetch call.");
    }

    const parsedBody = JSON.parse(call.init?.body as string);
    expect(parsedBody.input_type).toBe("query");
    expect(parsedBody.input).toEqual(["search query"]);
  });

  it("maps non-2xx proxy responses to VoyageProxyError with status and preview", async () => {
    installFetchMock(async () => {
      return new Response("upstream error: rate limited", { status: 429 });
    });

    const error = await assertVoyageProxyError(() =>
      callEmbeddingEndpoint(createTestConfig(), createNoopLogger(), {
        input: ["test"],
        input_type: "document",
      }),
    );

    expect(error.status).toBe(429);
    expect(error.details?.status).toBe(429);
    expect(error.details?.bodyPreview).toBe("upstream error: rate limited");
  });

  it("maps timeout-driven aborted requests to VoyageTimeoutError", async () => {
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

    const error = await assertVoyageTimeoutError(() =>
      callEmbeddingEndpoint(createTestConfig(), createNoopLogger(), {
        input: ["test"],
        input_type: "document",
      }, 10),
    );

    expect(typeof error.details?.durationMs).toBe("number");
  });

  it("maps invalid success JSON to VoyageProxyError", async () => {
    installFetchMock(async () => {
      return new Response("not-json-at-all", { status: 200 });
    });

    const error = await assertVoyageProxyError(() =>
      callEmbeddingEndpoint(createTestConfig(), createNoopLogger(), {
        input: ["test"],
        input_type: "document",
      }),
    );

    expect(error.status).toBe(200);
    expect(error.details?.bodyPreview).toBe("not-json-at-all");
  });

  it("maps success JSON arrays to VoyageProxyError because object payload is required", async () => {
    installFetchMock(async () => {
      return new Response(JSON.stringify(["item-1", "item-2"]), { status: 200 });
    });

    const error = await assertVoyageProxyError(() =>
      callEmbeddingEndpoint(createTestConfig(), createNoopLogger(), {
        input: ["test"],
        input_type: "document",
      }),
    );

    expect(error.status).toBe(200);
  });

  it("throws VoyageProxyError when request.input is empty", async () => {
    installFetchMock(async () => {
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const error = await assertVoyageProxyError(() =>
      callEmbeddingEndpoint(createTestConfig(), createNoopLogger(), {
        input: [],
        input_type: "document",
      }),
    );

    expect(error.message).toContain("request.input");
  });

  it("creates client via factory and embedDocuments returns array of embedding vectors", async () => {
    const config = createTestConfig();
    const logger = createNoopLogger();
    const client = createVoyageProxyClient(config, logger);

    const mockResponse = createMockEmbeddingResponse(
      [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9]],
      "voyage-4",
      150,
    );

    installFetchMock(async () => {
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const result = await client.embedDocuments(["doc one", "doc two", "doc three"]);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual([0.1, 0.2, 0.3]);
    expect(result[1]).toEqual([0.4, 0.5, 0.6]);
    expect(result[2]).toEqual([0.7, 0.8, 0.9]);

    const call = capturedFetchCalls[0];
    if (!call) {
      throw new Error("Expected one captured fetch call.");
    }

    const parsedBody = JSON.parse(call.init?.body as string);
    expect(parsedBody.input_type).toBe("document");
    expect(parsedBody.input).toEqual(["doc one", "doc two", "doc three"]);
  });

  it("creates client via factory and embedQuery returns single embedding vector", async () => {
    const config = createTestConfig();
    const logger = createNoopLogger();
    const client = createVoyageProxyClient(config, logger);

    const mockResponse = createMockEmbeddingResponse(
      [[0.11, 0.22, 0.33]],
      "voyage-4",
      12,
    );

    installFetchMock(async () => {
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const result = await client.embedQuery("what is tokyo like?");

    expect(result).toEqual([0.11, 0.22, 0.33]);

    const call = capturedFetchCalls[0];
    if (!call) {
      throw new Error("Expected one captured fetch call.");
    }

    const parsedBody = JSON.parse(call.init?.body as string);
    expect(parsedBody.input_type).toBe("query");
    expect(parsedBody.input).toEqual(["what is tokyo like?"]);
  });

  it("embedQuery throws VoyageProxyError when data array is empty", async () => {
    const config = createTestConfig();
    const logger = createNoopLogger();
    const client = createVoyageProxyClient(config, logger);

    const emptyResponse = {
      object: "list",
      data: [],
      model: "voyage-4",
      usage: { total_tokens: 0 },
    };

    installFetchMock(async () => {
      return new Response(JSON.stringify(emptyResponse), { status: 200 });
    });

    const error = await assertVoyageProxyError(() =>
      client.embedQuery("test query"),
    );

    expect(error.message).toContain("empty data array");
  });

  it("uses default model voyage-4 when model is not specified", async () => {
    const config = createTestConfig();
    const logger = createNoopLogger();

    const mockResponse = createMockEmbeddingResponse([[0.1]], "voyage-4", 5);

    installFetchMock(async () => {
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    await callEmbeddingEndpoint(config, logger, {
      input: ["test"],
      input_type: "document",
    });

    const call = capturedFetchCalls[0];
    if (!call) {
      throw new Error("Expected one captured fetch call.");
    }

    const parsedBody = JSON.parse(call.init?.body as string);
    expect(parsedBody.model).toBe("voyage-4");
  });

  it("allows overriding model in the request", async () => {
    const config = createTestConfig();
    const logger = createNoopLogger();

    const mockResponse = createMockEmbeddingResponse([[0.1]], "voyage-3", 5);

    installFetchMock(async () => {
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    await callEmbeddingEndpoint(config, logger, {
      input: ["test"],
      input_type: "document",
      model: "voyage-3",
    });

    const call = capturedFetchCalls[0];
    if (!call) {
      throw new Error("Expected one captured fetch call.");
    }

    const parsedBody = JSON.parse(call.init?.body as string);
    expect(parsedBody.model).toBe("voyage-3");
  });
});

// START_BLOCK_RETRY_TESTS_M_VOYAGE_PROXY_CLIENT_TEST_007
describe("M-VOYAGE-PROXY-CLIENT retry/backoff", () => {
  it("retries on 5xx and succeeds on second attempt", async () => {
    let fetchCallCount = 0;
    const mockResponse = createMockEmbeddingResponse([[0.1]], "voyage-4", 5);

    installFetchMock(async () => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return new Response("server error", { status: 502 });
      }
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const result = await callEmbeddingEndpoint(createTestConfig(), createNoopLogger(), {
      input: ["test"],
      input_type: "document",
    });

    expect(result.data).toHaveLength(1);
    expect(fetchCallCount).toBe(2);
  });

  it("retries on 429 rate limit and succeeds", async () => {
    let fetchCallCount = 0;
    const mockResponse = createMockEmbeddingResponse([[0.1]], "voyage-4", 5);

    installFetchMock(async () => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const result = await callEmbeddingEndpoint(createTestConfig(), createNoopLogger(), {
      input: ["test"],
      input_type: "document",
    });

    expect(result.data).toHaveLength(1);
    expect(fetchCallCount).toBe(2);
  });

  it("does NOT retry on 4xx client errors (except 429)", async () => {
    let fetchCallCount = 0;
    installFetchMock(async () => {
      fetchCallCount++;
      return new Response("bad request", { status: 400 });
    });

    const error = await assertVoyageProxyError(() =>
      callEmbeddingEndpoint(createTestConfig(), createNoopLogger(), {
        input: ["test"],
        input_type: "document",
      }),
    );

    expect(error.status).toBe(400);
    expect(fetchCallCount).toBe(1);
  });

  it("exhausts all retries on persistent 5xx and throws", async () => {
    let fetchCallCount = 0;
    installFetchMock(async () => {
      fetchCallCount++;
      return new Response("server error", { status: 503 });
    });

    const error = await assertVoyageProxyError(() =>
      callEmbeddingEndpoint(createTestConfig(), createNoopLogger(), {
        input: ["test"],
        input_type: "document",
      }),
    );

    expect(error.status).toBe(503);
    expect(fetchCallCount).toBe(3);
  });

  it("retries on network error and succeeds", async () => {
    let fetchCallCount = 0;
    const mockResponse = createMockEmbeddingResponse([[0.1]], "voyage-4", 5);

    installFetchMock(async () => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        throw new Error("ECONNRESET");
      }
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    });

    const result = await callEmbeddingEndpoint(createTestConfig(), createNoopLogger(), {
      input: ["test"],
      input_type: "document",
    });

    expect(result.data).toHaveLength(1);
    expect(fetchCallCount).toBe(2);
  });
});
// END_BLOCK_RETRY_TESTS_M_VOYAGE_PROXY_CLIENT_TEST_007

// START_BLOCK_IS_TRANSIENT_TESTS_M_VOYAGE_PROXY_CLIENT_TEST_008
describe("isTransientVoyageError", () => {
  it("returns true for VoyageTimeoutError", () => {
    const error = new VoyageTimeoutError("timeout");
    expect(isTransientVoyageError(error)).toBe(true);
  });

  it("returns true for 5xx VoyageProxyError", () => {
    expect(isTransientVoyageError(new VoyageProxyError("err", 500))).toBe(true);
    expect(isTransientVoyageError(new VoyageProxyError("err", 503))).toBe(true);
  });

  it("returns true for 429 VoyageProxyError", () => {
    expect(isTransientVoyageError(new VoyageProxyError("rate limited", 429))).toBe(true);
  });

  it("returns true for network error (no status)", () => {
    expect(isTransientVoyageError(new VoyageProxyError("network error", undefined))).toBe(true);
  });

  it("returns false for 4xx VoyageProxyError (except 429)", () => {
    expect(isTransientVoyageError(new VoyageProxyError("bad request", 400))).toBe(false);
    expect(isTransientVoyageError(new VoyageProxyError("not found", 404))).toBe(false);
    expect(isTransientVoyageError(new VoyageProxyError("forbidden", 403))).toBe(false);
  });
});
// END_BLOCK_IS_TRANSIENT_TESTS_M_VOYAGE_PROXY_CLIENT_TEST_008

// START_BLOCK_COMPUTE_RETRY_DELAY_TESTS_M_VOYAGE_PROXY_CLIENT_TEST_009
describe("computeVoyageRetryDelay", () => {
  it("returns delay >= base for attempt 0", () => {
    const delay = computeVoyageRetryDelay(0);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(1500);
  });

  it("returns delay >= 2*base for attempt 1", () => {
    const delay = computeVoyageRetryDelay(1);
    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThanOrEqual(2500);
  });
});
// END_BLOCK_COMPUTE_RETRY_DELAY_TESTS_M_VOYAGE_PROXY_CLIENT_TEST_009
