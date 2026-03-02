// FILE: src/integrations/spider-cloud-client.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate deterministic Spider proxy crawl behavior for M-SPIDER-CLOUD-CLIENT.
//   SCOPE: Assert URL/header/body construction, trailing-slash handling, timeout mapping, non-2xx HTTP mapping, default parameter handling, and success JSON parsing.
//   DEPENDS: M-SPIDER-CLOUD-CLIENT, M-CONFIG, M-LOGGER
//   LINKS: M-SPIDER-CLOUD-CLIENT-TEST, M-SPIDER-CLOUD-CLIENT, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build deterministic no-op logger implementation.
//   createTestConfig - Build AppConfig fixture with overrideable proxy settings.
//   installFetchMock - Replace global fetch with deterministic per-test mock and capture invocations.
//   readHeaderValue - Extract header values from HeadersInit variants.
//   assertSpiderProxyError - Capture and assert typed SpiderProxyError instances.
//   assertSpiderTimeoutError - Capture and assert typed SpiderTimeoutError instances.
//   SpiderCloudClientTests - Focused tests for success and primary error branches.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial test suite for M-SPIDER-CLOUD-CLIENT.
// END_CHANGE_SUMMARY

import { afterEach, describe, expect, it } from "bun:test";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import {
  computeRetryDelay,
  createSpiderCloudClient,
  isTransientSpiderError,
  runCrawl,
  SpiderProxyError,
  SpiderTimeoutError,
  type SpiderCrawlRequest,
} from "./spider-cloud-client";

type FetchCall = {
  input: Request | URL | string;
  init?: RequestInit;
};

type FetchImpl = (input: Request | URL | string, init?: RequestInit) => Promise<Response>;

const ORIGINAL_FETCH = globalThis.fetch;
let capturedFetchCalls: FetchCall[] = [];

// START_CONTRACT: createNoopLogger
//   PURPOSE: Build inert logger implementation for deterministic Spider client tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - No-op logger with child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_M_SPIDER_CLOUD_CLIENT_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_M_SPIDER_CLOUD_CLIENT_TEST_001
}

// START_CONTRACT: createTestConfig
//   PURPOSE: Build deterministic AppConfig fixture with optional proxy overrides.
//   INPUTS: { proxyOverrides: Partial<AppConfig["proxy"]> | undefined - Optional proxy override values }
//   OUTPUTS: { AppConfig - Runtime config fixture for Spider client tests }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG]
// END_CONTRACT: createTestConfig
function createTestConfig(proxyOverrides?: Partial<AppConfig["proxy"]>): AppConfig {
  // START_BLOCK_BUILD_APP_CONFIG_FIXTURE_M_SPIDER_CLOUD_CLIENT_TEST_002
  return {
    port: 3000,
    publicUrl: "https://travel.example.com/",
    rootAuthToken: "root-token",
    databaseUrl: "postgres://localhost:5432/test",
    oauthSessionSecret: "test-oauth-session-secret-at-least-32-characters",
    platformName: "Travel RAG",
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
  // END_BLOCK_BUILD_APP_CONFIG_FIXTURE_M_SPIDER_CLOUD_CLIENT_TEST_002
}

// START_CONTRACT: installFetchMock
//   PURPOSE: Install a deterministic fetch mock and capture call arguments for assertions.
//   INPUTS: { impl: FetchImpl - Mock implementation used for fetch responses }
//   OUTPUTS: { void }
//   SIDE_EFFECTS: [Replaces globalThis.fetch and stores call arguments]
//   LINKS: [M-SPIDER-CLOUD-CLIENT]
// END_CONTRACT: installFetchMock
function installFetchMock(impl: FetchImpl): void {
  // START_BLOCK_INSTALL_FETCH_MOCK_M_SPIDER_CLOUD_CLIENT_TEST_003
  capturedFetchCalls = [];
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    capturedFetchCalls.push({ input, init });
    return impl(input, init);
  }) as typeof fetch;
  // END_BLOCK_INSTALL_FETCH_MOCK_M_SPIDER_CLOUD_CLIENT_TEST_003
}

// START_CONTRACT: readHeaderValue
//   PURPOSE: Normalize header access across all HeadersInit variants.
//   INPUTS: { headers: HeadersInit | undefined - Headers container, headerName: string - Header to read }
//   OUTPUTS: { string | null - Resolved header value when present }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SPIDER-CLOUD-CLIENT]
// END_CONTRACT: readHeaderValue
function readHeaderValue(headers: RequestInit["headers"], headerName: string): string | null {
  // START_BLOCK_READ_HEADER_VALUE_M_SPIDER_CLOUD_CLIENT_TEST_004
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
  // END_BLOCK_READ_HEADER_VALUE_M_SPIDER_CLOUD_CLIENT_TEST_004
}

// START_CONTRACT: assertSpiderProxyError
//   PURPOSE: Execute async call and assert it fails with SpiderProxyError.
//   INPUTS: { execute: () => Promise<unknown> - Async call expected to fail }
//   OUTPUTS: { Promise<SpiderProxyError> - Captured typed error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SPIDER-CLOUD-CLIENT]
// END_CONTRACT: assertSpiderProxyError
async function assertSpiderProxyError(
  execute: () => Promise<unknown>,
): Promise<SpiderProxyError> {
  // START_BLOCK_ASSERT_SPIDER_PROXY_ERROR_M_SPIDER_CLOUD_CLIENT_TEST_005
  let thrown: unknown;
  try {
    await execute();
  } catch (error: unknown) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(SpiderProxyError);
  const spiderError = thrown as SpiderProxyError;
  expect(spiderError.code).toBe("SPIDER_PROXY_ERROR");
  return spiderError;
  // END_BLOCK_ASSERT_SPIDER_PROXY_ERROR_M_SPIDER_CLOUD_CLIENT_TEST_005
}

// START_CONTRACT: assertSpiderTimeoutError
//   PURPOSE: Execute async call and assert it fails with SpiderTimeoutError.
//   INPUTS: { execute: () => Promise<unknown> - Async call expected to fail }
//   OUTPUTS: { Promise<SpiderTimeoutError> - Captured typed error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SPIDER-CLOUD-CLIENT]
// END_CONTRACT: assertSpiderTimeoutError
async function assertSpiderTimeoutError(
  execute: () => Promise<unknown>,
): Promise<SpiderTimeoutError> {
  // START_BLOCK_ASSERT_SPIDER_TIMEOUT_ERROR_M_SPIDER_CLOUD_CLIENT_TEST_006
  let thrown: unknown;
  try {
    await execute();
  } catch (error: unknown) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(SpiderTimeoutError);
  const spiderError = thrown as SpiderTimeoutError;
  expect(spiderError.code).toBe("SPIDER_TIMEOUT");
  return spiderError;
  // END_BLOCK_ASSERT_SPIDER_TIMEOUT_ERROR_M_SPIDER_CLOUD_CLIENT_TEST_006
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  capturedFetchCalls = [];
});

describe("M-SPIDER-CLOUD-CLIENT deterministic crawl contract", () => {
  it("posts to proxy crawl endpoint with correct headers and returns parsed crawl response", async () => {
    const config = createTestConfig();
    const logger = createNoopLogger();
    const client = createSpiderCloudClient(config, logger);

    const crawlResponse = {
      data: [
        {
          url: "https://example.com/page1",
          content: "# Page 1\nHello world",
          status_code: 200,
          metadata: { title: "Page 1" },
        },
      ],
      status: "completed",
    };

    installFetchMock(async () => {
      return new Response(JSON.stringify(crawlResponse), { status: 200 });
    });

    const result = await client.runCrawl({ url: "https://example.com" });

    expect(result).toEqual(crawlResponse);
    expect(capturedFetchCalls).toHaveLength(1);

    const call = capturedFetchCalls[0];
    if (!call) {
      throw new Error("Expected one captured fetch call.");
    }

    expect(String(call.input)).toBe("https://proxy.example.com/api.spider.cloud/v1/crawl");
    expect(call.init?.method).toBe("POST");
    expect(readHeaderValue(call.init?.headers, "Authorization")).toBe("Bearer spider-api-key");
    expect(readHeaderValue(call.init?.headers, "X-Proxy-Key")).toBe("proxy-secret-key");
    expect(readHeaderValue(call.init?.headers, "Content-Type")).toBe("application/json");

    const parsedBody = JSON.parse(call.init?.body as string);
    expect(parsedBody.url).toBe("https://example.com");
    expect(parsedBody.return_format).toBe("markdown");
  });

  it("strips trailing slashes from proxy base URL before appending crawl path", async () => {
    const config = createTestConfig({ baseUrl: "https://proxy.example.com///" });
    const logger = createNoopLogger();

    installFetchMock(async () => {
      return new Response(JSON.stringify({ data: [], status: "completed" }), { status: 200 });
    });

    await runCrawl(config, logger, { url: "https://example.com" });

    const call = capturedFetchCalls[0];
    if (!call) {
      throw new Error("Expected one captured fetch call.");
    }

    expect(String(call.input)).toBe("https://proxy.example.com/api.spider.cloud/v1/crawl");
  });

  it("includes optional limit and depth when provided in request", async () => {
    const config = createTestConfig();
    const logger = createNoopLogger();

    installFetchMock(async () => {
      return new Response(JSON.stringify({ data: [], status: "completed" }), { status: 200 });
    });

    await runCrawl(config, logger, {
      url: "https://example.com",
      limit: 10,
      depth: 3,
      return_format: "text",
    });

    const call = capturedFetchCalls[0];
    if (!call) {
      throw new Error("Expected one captured fetch call.");
    }

    const parsedBody = JSON.parse(call.init?.body as string);
    expect(parsedBody.url).toBe("https://example.com");
    expect(parsedBody.limit).toBe(10);
    expect(parsedBody.depth).toBe(3);
    expect(parsedBody.return_format).toBe("text");
  });

  it("omits limit and depth from body when not provided in request", async () => {
    const config = createTestConfig();
    const logger = createNoopLogger();

    installFetchMock(async () => {
      return new Response(JSON.stringify({ data: [], status: "completed" }), { status: 200 });
    });

    await runCrawl(config, logger, { url: "https://example.com" });

    const call = capturedFetchCalls[0];
    if (!call) {
      throw new Error("Expected one captured fetch call.");
    }

    const parsedBody = JSON.parse(call.init?.body as string);
    expect(parsedBody).not.toHaveProperty("limit");
    expect(parsedBody).not.toHaveProperty("depth");
    expect(parsedBody.return_format).toBe("markdown");
  });

  it("maps non-2xx proxy responses to SpiderProxyError with status and preview", async () => {
    installFetchMock(async () => {
      return new Response("upstream error: rate limited", { status: 429 });
    });

    const error = await assertSpiderProxyError(() =>
      runCrawl(createTestConfig(), createNoopLogger(), { url: "https://example.com" }),
    );

    expect(error.status).toBe(429);
    expect(error.details?.status).toBe(429);
    expect(error.details?.bodyPreview).toBe("upstream error: rate limited");
    expect(error.details?.seedUrl).toBe("https://example.com");
  });

  it("maps timeout-driven aborted requests to SpiderTimeoutError", async () => {
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

    const error = await assertSpiderTimeoutError(() =>
      runCrawl(createTestConfig(), createNoopLogger(), { url: "https://example.com" }, 10),
    );

    expect(typeof error.details?.durationMs).toBe("number");
  });

  it("maps invalid success JSON to SpiderProxyError", async () => {
    installFetchMock(async () => {
      return new Response("not-json-at-all", { status: 200 });
    });

    const error = await assertSpiderProxyError(() =>
      runCrawl(createTestConfig(), createNoopLogger(), { url: "https://example.com" }),
    );

    expect(error.status).toBe(200);
    expect(error.details?.bodyPreview).toBe("not-json-at-all");
  });

  it("accepts success JSON arrays as Spider crawl results", async () => {
    const items = [
      { url: "https://example.com", content: "hello", status_code: 200 },
      { url: "https://example.com/page2", content: "world", status_code: 200 },
    ];
    installFetchMock(async () => {
      return new Response(JSON.stringify(items), { status: 200 });
    });

    const result = await runCrawl(createTestConfig(), createNoopLogger(), { url: "https://example.com" });

    expect(result.status).toBe("ok");
    expect(result.data).toHaveLength(2);
    expect(result.data[0].url).toBe("https://example.com");
    expect(result.data[1].content).toBe("world");
  });

  it("throws SpiderProxyError when request.url is empty", async () => {
    installFetchMock(async () => {
      return new Response(JSON.stringify({ data: [], status: "completed" }), { status: 200 });
    });

    const error = await assertSpiderProxyError(() =>
      runCrawl(createTestConfig(), createNoopLogger(), { url: "" }),
    );

    expect(error.message).toContain("request.url");
  });

  it("creates client via factory and delegates to runCrawl", async () => {
    const config = createTestConfig();
    const logger = createNoopLogger();
    const client = createSpiderCloudClient(config, logger);

    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          data: [{ url: "https://example.com", content: "Hello", status_code: 200 }],
          status: "completed",
        }),
        { status: 200 },
      );
    });

    const result = await client.runCrawl({ url: "https://example.com", limit: 5 });

    expect(result.status).toBe("completed");
    expect(result.data).toHaveLength(1);
    expect(result.data[0].content).toBe("Hello");
  });
});

// START_BLOCK_RETRY_TESTS_M_SPIDER_CLOUD_CLIENT_TEST_007
describe("M-SPIDER-CLOUD-CLIENT retry/backoff", () => {
  it("retries on 5xx and succeeds on second attempt", async () => {
    let fetchCallCount = 0;
    installFetchMock(async () => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return new Response("server error", { status: 502 });
      }
      return new Response(
        JSON.stringify({ data: [], status: "completed" }),
        { status: 200 },
      );
    });

    const result = await runCrawl(createTestConfig(), createNoopLogger(), { url: "https://example.com" });

    expect(result.status).toBe("completed");
    expect(fetchCallCount).toBe(2);
  });

  it("does NOT retry on 4xx client errors", async () => {
    let fetchCallCount = 0;
    installFetchMock(async () => {
      fetchCallCount++;
      return new Response("bad request", { status: 400 });
    });

    const error = await assertSpiderProxyError(() =>
      runCrawl(createTestConfig(), createNoopLogger(), { url: "https://example.com" }),
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

    const error = await assertSpiderProxyError(() =>
      runCrawl(createTestConfig(), createNoopLogger(), { url: "https://example.com" }),
    );

    expect(error.status).toBe(503);
    expect(fetchCallCount).toBe(3); // 3 attempts total
  });

  it("retries on network error (no status) and succeeds", async () => {
    let fetchCallCount = 0;
    installFetchMock(async () => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        throw new Error("ECONNRESET");
      }
      return new Response(
        JSON.stringify({ data: [], status: "completed" }),
        { status: 200 },
      );
    });

    const result = await runCrawl(createTestConfig(), createNoopLogger(), { url: "https://example.com" });

    expect(result.status).toBe("completed");
    expect(fetchCallCount).toBe(2);
  });
});
// END_BLOCK_RETRY_TESTS_M_SPIDER_CLOUD_CLIENT_TEST_007

// START_BLOCK_IS_TRANSIENT_TESTS_M_SPIDER_CLOUD_CLIENT_TEST_008
describe("isTransientSpiderError", () => {
  it("returns true for SpiderTimeoutError", () => {
    const error = new SpiderTimeoutError("timeout");
    expect(isTransientSpiderError(error)).toBe(true);
  });

  it("returns true for 5xx SpiderProxyError", () => {
    const error = new SpiderProxyError("server error", 500);
    expect(isTransientSpiderError(error)).toBe(true);

    const error503 = new SpiderProxyError("service unavailable", 503);
    expect(isTransientSpiderError(error503)).toBe(true);
  });

  it("returns true for network error (no status)", () => {
    const error = new SpiderProxyError("network error", undefined);
    expect(isTransientSpiderError(error)).toBe(true);
  });

  it("returns false for 4xx SpiderProxyError", () => {
    const error400 = new SpiderProxyError("bad request", 400);
    expect(isTransientSpiderError(error400)).toBe(false);

    const error429 = new SpiderProxyError("rate limited", 429);
    expect(isTransientSpiderError(error429)).toBe(false);

    const error404 = new SpiderProxyError("not found", 404);
    expect(isTransientSpiderError(error404)).toBe(false);
  });
});
// END_BLOCK_IS_TRANSIENT_TESTS_M_SPIDER_CLOUD_CLIENT_TEST_008

// START_BLOCK_COMPUTE_RETRY_DELAY_TESTS_M_SPIDER_CLOUD_CLIENT_TEST_009
describe("computeRetryDelay", () => {
  it("returns delay >= base for attempt 0", () => {
    const delay = computeRetryDelay(0);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(1500); // 1000 + 500 jitter max
  });

  it("returns delay >= 2*base for attempt 1", () => {
    const delay = computeRetryDelay(1);
    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThanOrEqual(2500);
  });

  it("returns delay >= 4*base for attempt 2", () => {
    const delay = computeRetryDelay(2);
    expect(delay).toBeGreaterThanOrEqual(4000);
    expect(delay).toBeLessThanOrEqual(4500);
  });
});
// END_BLOCK_COMPUTE_RETRY_DELAY_TESTS_M_SPIDER_CLOUD_CLIENT_TEST_009
