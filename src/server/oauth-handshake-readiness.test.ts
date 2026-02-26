// FILE: src/server/oauth-handshake-readiness.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify server OAuth discovery and unauthorized challenge surfaces are coherent for DCR-style client bootstrap flows.
//   SCOPE: Assert /mcp discovery metadata fields, unauthorized /mcp Bearer challenge metadata, and issuer/resource/scope coherence across discovery and challenge outputs.
//   DEPENDS: M-SERVER, M-OAUTH-DISCOVERY, M-CONFIG, M-LOGGER
//   LINKS: M-SERVER, M-OAUTH-DISCOVERY, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build deterministic no-op logger implementation for route tests.
//   createTestConfig - Build deterministic AppConfig fixture for handshake readiness checks.
//   parseWwwAuthenticateHeader - Parse Bearer challenge header into auth-params for assertions.
//   parseScopeSet - Normalize scope string into deduplicated set for order-insensitive checks.
//   ServerOAuthHandshakeReadinessTests - Validate discovery + challenge coherence for Logto/Claude-style bootstrap.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Added focused server handshake readiness tests for discovery metadata and WWW-Authenticate coherence.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import { handleOAuthProtectedResourceMetadata } from "../auth/oauth-discovery-routes";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import { createUnauthorizedMcpResponse } from "./index";

type OAuthDiscoveryPayload = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
};

type ParsedWwwAuthenticateHeader = {
  scheme: string;
  params: Record<string, string>;
};

// START_CONTRACT: createNoopLogger
//   PURPOSE: Create no-op logger implementation for deterministic server route tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - Logger with inert methods and child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_FOR_SERVER_HANDSHAKE_TESTS_M_SERVER_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_FOR_SERVER_HANDSHAKE_TESTS_M_SERVER_TEST_001
}

// START_CONTRACT: createTestConfig
//   PURPOSE: Build deterministic runtime config fixture for OAuth handshake readiness assertions.
//   INPUTS: {}
//   OUTPUTS: { AppConfig - Runtime config fixture with OAuth metadata values }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG]
// END_CONTRACT: createTestConfig
function createTestConfig(): AppConfig {
  // START_BLOCK_BUILD_DETERMINISTIC_CONFIG_FIXTURE_FOR_HANDSHAKE_M_SERVER_TEST_002
  return {
    port: 3000,
    publicUrl: "https://travel.example.com/",
    rootAuthToken: "root-secret",
    databaseUrl: "postgresql://localhost:5432/testdb",
    oauth: {
      issuer: "https://issuer.example.com/",
      audience: "travel-mcp",
      requiredScopes: ["mcp:access", "profile:read", "mcp:access"],
      jwksCacheTtlMs: 300000,
      jwksTimeoutMs: 5000,
      clockSkewSec: 60,
    },
    tgChatRag: {
      baseUrl: "https://tg-rag.example.com/",
      bearerToken: "bearer-token",
      chatIds: ["chat-1"],
      timeoutMs: 15000,
    },
  };
  // END_BLOCK_BUILD_DETERMINISTIC_CONFIG_FIXTURE_FOR_HANDSHAKE_M_SERVER_TEST_002
}

// START_CONTRACT: parseWwwAuthenticateHeader
//   PURPOSE: Parse WWW-Authenticate Bearer challenge into a stable map for deterministic assertions.
//   INPUTS: { headerValue: string - Raw WWW-Authenticate response header value }
//   OUTPUTS: { ParsedWwwAuthenticateHeader - Parsed scheme and auth-param key/value map }
//   SIDE_EFFECTS: [Throws when header format is not valid Bearer challenge]
//   LINKS: [M-SERVER]
// END_CONTRACT: parseWwwAuthenticateHeader
function parseWwwAuthenticateHeader(headerValue: string): ParsedWwwAuthenticateHeader {
  // START_BLOCK_PARSE_WWW_AUTHENTICATE_HEADER_FOR_ASSERTIONS_M_SERVER_TEST_003
  const trimmed = headerValue.trim();
  if (!trimmed.startsWith("Bearer ")) {
    throw new Error(`Expected Bearer challenge, received: ${trimmed}`);
  }

  const paramsText = trimmed.slice("Bearer ".length);
  const params: Record<string, string> = {};
  for (const segment of paramsText.split(/,\s*/)) {
    const separatorIndex = segment.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = segment.slice(0, separatorIndex).trim();
    let value = segment.slice(separatorIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    if (key) {
      params[key] = value;
    }
  }

  return {
    scheme: "Bearer",
    params,
  };
  // END_BLOCK_PARSE_WWW_AUTHENTICATE_HEADER_FOR_ASSERTIONS_M_SERVER_TEST_003
}

// START_CONTRACT: parseScopeSet
//   PURPOSE: Normalize scope string into a deduplicated set for order-insensitive assertions.
//   INPUTS: { scopeValue: string | undefined - Scope auth-param value from Bearer challenge }
//   OUTPUTS: { Set<string> - Deduplicated scope token set }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SERVER]
// END_CONTRACT: parseScopeSet
function parseScopeSet(scopeValue: string | undefined): Set<string> {
  // START_BLOCK_NORMALIZE_SCOPE_AUTH_PARAM_FOR_ASSERTIONS_M_SERVER_TEST_004
  if (typeof scopeValue !== "string") {
    return new Set<string>();
  }

  const scopes = scopeValue
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  return new Set(scopes);
  // END_BLOCK_NORMALIZE_SCOPE_AUTH_PARAM_FOR_ASSERTIONS_M_SERVER_TEST_004
}

describe("M-SERVER OAuth handshake readiness", () => {
  it("returns /mcp discovery metadata with OAuth bootstrap resource/issuer/scope fields", async () => {
    const config = createTestConfig();
    const response = handleOAuthProtectedResourceMetadata(
      new Request("https://travel.example.com/.well-known/oauth-protected-resource/mcp", {
        method: "GET",
      }),
      {
        config,
        logger: createNoopLogger(),
      },
    );

    expect(response).not.toBeNull();
    if (response === null) {
      throw new Error("Expected discovery metadata response.");
    }

    const payload = (await response.json()) as OAuthDiscoveryPayload;
    expect(response.status).toBe(200);
    expect(payload.resource).toBe("https://travel.example.com/mcp");
    expect(payload.authorization_servers).toEqual(["https://issuer.example.com/"]);
    expect(payload.scopes_supported).toEqual(["mcp:access", "profile:read"]);
    expect(payload.bearer_methods_supported).toEqual(["header"]);
  });

  it("returns /mcp unauthorized challenge with Bearer issuer/resource/scope metadata", () => {
    const config = createTestConfig();
    const response = createUnauthorizedMcpResponse({
      error: "invalid_token",
      errorDescription: "Access token is invalid for handshake readiness checks.",
      requiredScopes: config.oauth.requiredScopes,
      issuer: config.oauth.issuer,
      resource: new URL("/mcp", config.publicUrl).toString(),
    });

    const challengeHeader = response.headers.get("www-authenticate");
    expect(challengeHeader).not.toBeNull();
    if (challengeHeader === null) {
      throw new Error("Expected WWW-Authenticate header.");
    }

    const parsedChallenge = parseWwwAuthenticateHeader(challengeHeader);
    expect(parsedChallenge.scheme).toBe("Bearer");
    expect(parsedChallenge.params.error).toBe("invalid_token");
    expect(parsedChallenge.params.issuer).toBe("https://issuer.example.com/");
    expect(parsedChallenge.params.resource).toBe("https://travel.example.com/mcp");
    expect(parseScopeSet(parsedChallenge.params.scope)).toEqual(
      new Set(["mcp:access", "profile:read"]),
    );
  });

  it("keeps discovery and challenge issuer/resource/scope contract coherent for /mcp", async () => {
    const config = createTestConfig();
    const discoveryResponse = handleOAuthProtectedResourceMetadata(
      new Request("https://travel.example.com/.well-known/oauth-protected-resource/mcp", {
        method: "GET",
      }),
      {
        config,
        logger: createNoopLogger(),
      },
    );

    expect(discoveryResponse).not.toBeNull();
    if (discoveryResponse === null) {
      throw new Error("Expected discovery metadata response.");
    }

    const discoveryPayload = (await discoveryResponse.json()) as OAuthDiscoveryPayload;
    const challengeResponse = createUnauthorizedMcpResponse({
      error: "insufficient_scope",
      errorDescription: "Token does not include required scope.",
      requiredScopes: discoveryPayload.scopes_supported,
      issuer: discoveryPayload.authorization_servers[0],
      resource: discoveryPayload.resource,
    });

    const challengeHeader = challengeResponse.headers.get("www-authenticate");
    expect(challengeHeader).not.toBeNull();
    if (challengeHeader === null) {
      throw new Error("Expected WWW-Authenticate header.");
    }

    const parsedChallenge = parseWwwAuthenticateHeader(challengeHeader);
    expect(parsedChallenge.params.error).toBe("insufficient_scope");
    expect(parsedChallenge.params.issuer).toBe(discoveryPayload.authorization_servers[0]);
    expect(parsedChallenge.params.resource).toBe(discoveryPayload.resource);
    expect(parseScopeSet(parsedChallenge.params.scope)).toEqual(
      new Set(discoveryPayload.scopes_supported),
    );
  });
});
