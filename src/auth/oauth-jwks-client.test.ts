// FILE: src/auth/oauth-jwks-client.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate JWKS cache/refresh behavior and typed error mapping for OAuth JWKS client module.
//   SCOPE: Cover fresh-cache key reuse, stale-cache refresh, kid-miss refresh, invalid kid rejection, and fetch/payload failure mapping without network access.
//   DEPENDS: M-OAUTH-JWKS, M-CONFIG, M-LOGGER
//   LINKS: M-OAUTH-JWKS, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build inert Logger implementation for deterministic JWKS tests.
//   createTestConfig - Build valid AppConfig fixture with OAuth JWKS settings.
//   createMockFetchSequence - Build deterministic sequenced fetch stub and call capture.
//   OAuthJwksClientTests - Focused tests for cache and refresh behavior plus typed error mapping.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Added focused tests for M-OAUTH-JWKS cache/refresh and typed error behaviors.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import {
  createOAuthJwksClient,
  OAUTH_JWKS_ERROR,
  OAuthJwksError,
} from "./oauth-jwks-client";

type MockFetchStep =
  | {
      type: "response";
      status?: number;
      body: unknown;
      headers?: Record<string, string>;
    }
  | {
      type: "throw";
      message: string;
    };

// START_CONTRACT: createNoopLogger
//   PURPOSE: Provide no-op logger implementation compatible with Logger interface.
//   INPUTS: {}
//   OUTPUTS: { Logger - Logger with inert log methods and child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_FOR_OAUTH_JWKS_TESTS_M_OAUTH_JWKS_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_FOR_OAUTH_JWKS_TESTS_M_OAUTH_JWKS_TEST_001
}

// START_CONTRACT: createTestConfig
//   PURPOSE: Build deterministic valid AppConfig fixture for JWKS client tests.
//   INPUTS: { overrides: Partial<AppConfig["oauth"]> | undefined - Optional OAuth overrides }
//   OUTPUTS: { AppConfig - Valid runtime config fixture with OAuth JWKS settings }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG, M-OAUTH-JWKS]
// END_CONTRACT: createTestConfig
function createTestConfig(overrides?: Partial<AppConfig["oauth"]>): AppConfig {
  // START_BLOCK_BUILD_TEST_CONFIG_FIXTURE_FOR_OAUTH_JWKS_M_OAUTH_JWKS_TEST_002
  return {
    port: 3000,
    publicUrl: "https://travel.example.com",
    rootAuthToken: "root-token",
    databaseUrl: "postgresql://localhost:5432/testdb",
    oauth: {
      issuer: "https://issuer.example.com",
      audience: "mcp-audience",
      requiredScopes: ["mcp:access"],
      jwksCacheTtlMs: 3000,
      jwksTimeoutMs: 5000,
      clockSkewSec: 60,
      ...overrides,
    },
    tgChatRag: {
      baseUrl: "https://tg.example.com",
      bearerToken: "tg-token",
      chatIds: ["chat-1"],
      timeoutMs: 15000,
    },
  };
  // END_BLOCK_BUILD_TEST_CONFIG_FIXTURE_FOR_OAUTH_JWKS_M_OAUTH_JWKS_TEST_002
}

// START_CONTRACT: createMockFetchSequence
//   PURPOSE: Create sequenced fetch stub to emulate JWKS endpoint behaviors and capture calls.
//   INPUTS: { steps: MockFetchStep[] - Ordered fetch outcomes }
//   OUTPUTS: { fetchImplementation: (input: string | URL, init?: RequestInit) => Promise<Response>, calls: Array<{ url: string; method: string }> - Stub and captured call metadata }
//   SIDE_EFFECTS: [Consumes mock step queue as fetch is called]
//   LINKS: [M-OAUTH-JWKS]
// END_CONTRACT: createMockFetchSequence
function createMockFetchSequence(steps: MockFetchStep[]): {
  fetchImplementation: (input: string | URL, init?: RequestInit) => Promise<Response>;
  calls: Array<{ url: string; method: string }>;
} {
  // START_BLOCK_CREATE_SEQUENCED_FETCH_MOCK_FOR_OAUTH_JWKS_M_OAUTH_JWKS_TEST_003
  const queue = [...steps];
  const calls: Array<{ url: string; method: string }> = [];

  return {
    fetchImplementation: async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({
        url,
        method: (init?.method ?? "GET").toUpperCase(),
      });

      const step = queue.shift();
      if (!step) {
        throw new Error("No mock fetch step remaining.");
      }

      if (step.type === "throw") {
        throw new Error(step.message);
      }

      return new Response(JSON.stringify(step.body), {
        status: step.status ?? 200,
        headers: {
          "content-type": "application/json",
          ...(step.headers ?? {}),
        },
      });
    },
    calls,
  };
  // END_BLOCK_CREATE_SEQUENCED_FETCH_MOCK_FOR_OAUTH_JWKS_M_OAUTH_JWKS_TEST_003
}

describe("M-OAUTH-JWKS client contract", () => {
  it("serves key from fresh cache without repeated fetch", async () => {
    let nowEpochMs = 1000;
    const mockFetch = createMockFetchSequence([
      {
        type: "response",
        body: {
          keys: [{ kid: "kid-1", kty: "RSA", alg: "RS256", n: "n1", e: "AQAB" }],
        },
      },
    ]);
    const client = createOAuthJwksClient({
      config: createTestConfig({ jwksCacheTtlMs: 10000 }),
      logger: createNoopLogger(),
      fetchImplementation: mockFetch.fetchImplementation,
      now: () => nowEpochMs,
    });

    const keyFirst = await client.getSigningKey("kid-1");
    nowEpochMs += 1000;
    const keySecond = await client.getSigningKey("kid-1");

    expect(keyFirst.kid).toBe("kid-1");
    expect(keySecond.kid).toBe("kid-1");
    expect(mockFetch.calls.length).toBe(1);
    expect(mockFetch.calls[0]?.url).toBe("https://issuer.example.com/.well-known/jwks.json");
  });

  it("refreshes stale cache and rotates key material", async () => {
    let nowEpochMs = 10_000;
    const mockFetch = createMockFetchSequence([
      {
        type: "response",
        body: {
          keys: [{ kid: "kid-rotate", kty: "RSA", alg: "RS256", n: "old-n", e: "AQAB" }],
        },
      },
      {
        type: "response",
        body: {
          keys: [{ kid: "kid-rotate", kty: "RSA", alg: "RS256", n: "new-n", e: "AQAB" }],
        },
      },
    ]);
    const client = createOAuthJwksClient({
      config: createTestConfig({ jwksCacheTtlMs: 1000 }),
      logger: createNoopLogger(),
      fetchImplementation: mockFetch.fetchImplementation,
      now: () => nowEpochMs,
    });

    const firstKey = await client.getSigningKey("kid-rotate");
    nowEpochMs += 1100;
    const secondKey = await client.getSigningKey("kid-rotate");

    expect(firstKey.n).toBe("old-n");
    expect(secondKey.n).toBe("new-n");
    expect(mockFetch.calls.length).toBe(2);
  });

  it("refreshes on kid miss even when cache is fresh", async () => {
    let nowEpochMs = 50_000;
    const mockFetch = createMockFetchSequence([
      {
        type: "response",
        body: {
          keys: [{ kid: "kid-a", kty: "RSA", n: "n-a", e: "AQAB" }],
        },
      },
      {
        type: "response",
        body: {
          keys: [
            { kid: "kid-a", kty: "RSA", n: "n-a2", e: "AQAB" },
            { kid: "kid-b", kty: "RSA", n: "n-b", e: "AQAB" },
          ],
        },
      },
    ]);
    const client = createOAuthJwksClient({
      config: createTestConfig({ jwksCacheTtlMs: 10000 }),
      logger: createNoopLogger(),
      fetchImplementation: mockFetch.fetchImplementation,
      now: () => nowEpochMs,
    });

    await client.getSigningKey("kid-a");
    const missedKey = await client.getSigningKey("kid-b");

    expect(missedKey.kid).toBe("kid-b");
    expect(mockFetch.calls.length).toBe(2);
  });

  it("throws typed OAUTH_JWKS_ERROR for invalid kid, missing kid after refresh, and fetch failures", async () => {
    let nowEpochMs = 75_000;
    const missingKidFetch = createMockFetchSequence([
      {
        type: "response",
        body: {
          keys: [{ kid: "kid-x", kty: "RSA", n: "n-x", e: "AQAB" }],
        },
      },
      {
        type: "response",
        body: {
          keys: [{ kid: "kid-x", kty: "RSA", n: "n-x2", e: "AQAB" }],
        },
      },
    ]);
    const missingKidClient = createOAuthJwksClient({
      config: createTestConfig({ jwksCacheTtlMs: 10000 }),
      logger: createNoopLogger(),
      fetchImplementation: missingKidFetch.fetchImplementation,
      now: () => nowEpochMs,
    });

    await expect(missingKidClient.getSigningKey("   ")).rejects.toBeInstanceOf(OAuthJwksError);
    try {
      await missingKidClient.getSigningKey("kid-y");
      throw new Error("Expected missing kid lookup to throw.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(OAuthJwksError);
      const typedError = error as OAuthJwksError;
      expect(typedError.code).toBe(OAUTH_JWKS_ERROR);
      expect(typedError.details?.reason).toBe("KEY_NOT_FOUND");
    }

    const fetchFailure = createMockFetchSequence([{ type: "throw", message: "network down" }]);
    const fetchFailureClient = createOAuthJwksClient({
      config: createTestConfig(),
      logger: createNoopLogger(),
      fetchImplementation: fetchFailure.fetchImplementation,
      now: () => nowEpochMs,
    });

    try {
      await fetchFailureClient.refreshJwks();
      throw new Error("Expected refreshJwks to throw.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(OAuthJwksError);
      const typedError = error as OAuthJwksError;
      expect(typedError.code).toBe(OAUTH_JWKS_ERROR);
      expect(typedError.details?.reason).toBe("FETCH_FAILED");
    }
  });
});
