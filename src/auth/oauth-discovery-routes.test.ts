// FILE: src/auth/oauth-discovery-routes.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate OAuth discovery route metadata payloads and route/method behavior.
//   SCOPE: Cover GET metadata responses for both protected resource routes, non-match null behavior, and non-GET method handling for matched paths.
//   DEPENDS: M-OAUTH-DISCOVERY, M-CONFIG, M-LOGGER
//   LINKS: M-OAUTH-DISCOVERY, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Create no-op logger implementation for deterministic route tests.
//   createTestConfig - Build valid AppConfig fixture for discovery route tests.
//   OAuthDiscoveryRouteTests - Focused tests for discovery payload correctness and route matching behavior.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Added focused tests for M-OAUTH-DISCOVERY route behavior and metadata payloads.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import {
  handleOAuthProtectedResourceMetadata,
  OAUTH_DISCOVERY_ERROR,
} from "./oauth-discovery-routes";

// START_CONTRACT: createNoopLogger
//   PURPOSE: Build no-op logger for isolated discovery route tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - Logger implementation with inert methods and child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_FOR_DISCOVERY_TESTS_M_OAUTH_DISCOVERY_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_FOR_DISCOVERY_TESTS_M_OAUTH_DISCOVERY_TEST_001
}

// START_CONTRACT: createTestConfig
//   PURPOSE: Build deterministic config fixture with OAuth discovery fields.
//   INPUTS: {}
//   OUTPUTS: { AppConfig - Runtime config fixture for discovery metadata tests }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG]
// END_CONTRACT: createTestConfig
function createTestConfig(): AppConfig {
  // START_BLOCK_BUILD_DISCOVERY_TEST_CONFIG_FIXTURE_M_OAUTH_DISCOVERY_TEST_002
  return {
    port: 3000,
    publicUrl: "https://travel.example.com/",
    rootAuthToken: "root-token",
    databaseUrl: "postgresql://localhost:5432/testdb",
    oauth: {
      issuer: "https://issuer.example.com/",
      audience: "travel-mcp",
      requiredScopes: ["profile:read", "mcp:access", "profile:read"],
      jwksCacheTtlMs: 300000,
      jwksTimeoutMs: 5000,
      clockSkewSec: 60,
    },
    tgChatRag: {
      baseUrl: "https://tg.example.com/",
      bearerToken: "tg-token",
      chatIds: ["chat-1"],
      timeoutMs: 15000,
    },
  };
  // END_BLOCK_BUILD_DISCOVERY_TEST_CONFIG_FIXTURE_M_OAUTH_DISCOVERY_TEST_002
}

describe("M-OAUTH-DISCOVERY route handling", () => {
  it("returns expected metadata payload for GET /.well-known/oauth-protected-resource", async () => {
    const response = handleOAuthProtectedResourceMetadata(
      new Request("https://travel.example.com/.well-known/oauth-protected-resource", {
        method: "GET",
      }),
      {
        config: createTestConfig(),
        logger: createNoopLogger(),
      },
    );

    expect(response).not.toBeNull();
    if (response === null) {
      throw new Error("Expected metadata response.");
    }

    const payload = (await response.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
      bearer_methods_supported: string[];
    };

    expect(response.status).toBe(200);
    expect(payload.resource).toBe("https://travel.example.com/");
    expect(payload.authorization_servers).toEqual(["https://issuer.example.com/"]);
    expect(payload.scopes_supported).toEqual(["mcp:access", "profile:read"]);
    expect(payload.bearer_methods_supported).toEqual(["header"]);
  });

  it("returns expected metadata payload for GET /.well-known/oauth-protected-resource/mcp", async () => {
    const response = handleOAuthProtectedResourceMetadata(
      new Request("https://travel.example.com/.well-known/oauth-protected-resource/mcp", {
        method: "GET",
      }),
      {
        config: createTestConfig(),
        logger: createNoopLogger(),
      },
    );

    expect(response).not.toBeNull();
    if (response === null) {
      throw new Error("Expected metadata response.");
    }

    const payload = (await response.json()) as { resource: string };
    expect(response.status).toBe(200);
    expect(payload.resource).toBe("https://travel.example.com/mcp");
  });

  it("returns null for non-discovery routes to allow caller routing fallback", () => {
    const response = handleOAuthProtectedResourceMetadata(
      new Request("https://travel.example.com/healthz", {
        method: "GET",
      }),
      {
        config: createTestConfig(),
        logger: createNoopLogger(),
      },
    );

    expect(response).toBeNull();
  });

  it("returns 405 for non-GET methods on discovery routes with Allow header", async () => {
    const response = handleOAuthProtectedResourceMetadata(
      new Request("https://travel.example.com/.well-known/oauth-protected-resource", {
        method: "POST",
      }),
      {
        config: createTestConfig(),
        logger: createNoopLogger(),
      },
    );

    expect(response).not.toBeNull();
    if (response === null) {
      throw new Error("Expected method-not-allowed response.");
    }

    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(payload.error.code).toBe("METHOD_NOT_ALLOWED");
    expect(payload.error.message).toContain("GET only");
  });

  it("maps internal failures to OAUTH_DISCOVERY_ERROR safe response", async () => {
    const invalidConfig = createTestConfig();
    invalidConfig.publicUrl = "://invalid-url";

    const response = handleOAuthProtectedResourceMetadata(
      new Request("https://travel.example.com/.well-known/oauth-protected-resource", {
        method: "GET",
      }),
      {
        config: invalidConfig,
        logger: createNoopLogger(),
      },
    );

    expect(response).not.toBeNull();
    if (response === null) {
      throw new Error("Expected internal-error response.");
    }

    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(response.status).toBe(500);
    expect(payload.error.code).toBe(OAUTH_DISCOVERY_ERROR);
  });
});
