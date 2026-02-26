// FILE: src/auth/mcp-auth-guard.test.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate OAuth-only authorization guard behavior and deterministic WWW-Authenticate challenge generation.
//   SCOPE: Cover strict Bearer parsing deny paths, OAuth validator deny/allow mapping, challenge header formatting, and MCP_AUTH_ERROR propagation.
//   DEPENDS: M-MCP-AUTH-GUARD, M-OAUTH-TOKEN-VALIDATOR, M-LOGGER
//   LINKS: M-MCP-AUTH-GUARD, M-OAUTH-TOKEN-VALIDATOR, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build inert logger for focused auth guard tests.
//   createMockAuthDependencies - Build deterministic OAuth validator dependencies for each guard test mode.
//   McpAuthGuardTests - Focused tests for deny metadata, success mapping, header generation, and typed internal errors.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Updated mock validator contract to header-based M-OAUTH-TOKEN-VALIDATOR signature.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import {
  authorizeMcpRequest,
  buildWwwAuthenticateHeader,
  McpAuthError,
} from "./mcp-auth-guard";
import type { McpAuthGuardDependencies } from "./mcp-auth-guard";
import type { Logger } from "../logger/index";
import type { ValidateAccessTokenContext } from "./oauth-token-validator";

type MockValidationMode = "allow" | "invalid_token" | "insufficient_scope" | "throw";

// START_CONTRACT: createNoopLogger
//   PURPOSE: Provide no-op logger implementation for deterministic unit tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - Logger with inert methods and child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_FOR_AUTH_TESTS_M_MCP_AUTH_GUARD_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_FOR_AUTH_TESTS_M_MCP_AUTH_GUARD_TEST_001
}

// START_CONTRACT: createMockAuthDependencies
//   PURPOSE: Build auth guard dependencies with deterministic token validation behavior and call capture.
//   INPUTS: { mode: MockValidationMode - Validation behavior mode for oauthTokenValidator }
//   OUTPUTS: { deps: McpAuthGuardDependencies - Auth guard dependencies, validateCalls: string[] - Captured validateAccessToken token values }
//   SIDE_EFFECTS: [Captures token validation calls in memory]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: createMockAuthDependencies
function createMockAuthDependencies(mode: MockValidationMode): {
  deps: McpAuthGuardDependencies;
  validateCalls: string[];
} {
  // START_BLOCK_CREATE_MOCK_AUTH_GUARD_DEPENDENCIES_M_MCP_AUTH_GUARD_TEST_002
  const validateCalls: string[] = [];

  return {
    deps: {
      logger: createNoopLogger(),
      requiredScopes: ["mcp:access", "profile:read"],
      issuer: "https://issuer.example.com",
      resource: "https://resource.example.com/mcp",
      oauthTokenValidator: {
        validateAccessToken: async (
          authorizationHeader: string | null,
          context?: ValidateAccessTokenContext,
        ) => {
          if (authorizationHeader === null) {
            validateCalls.push("<null>");
          } else {
            validateCalls.push(authorizationHeader);
          }
          if (mode === "throw") {
            throw new Error("validator upstream failure");
          }
          if (mode === "invalid_token") {
            return {
              isValid: false as const,
              error: "invalid_token" as const,
              errorDescription: "Access token signature verification failed.",
            };
          }
          if (mode === "insufficient_scope") {
            return {
              isValid: false as const,
              error: "insufficient_scope" as const,
              errorDescription: "Token does not include required scope.",
            };
          }

          return {
            isValid: true as const,
            subject: "user-123",
            grantedScopes: context?.requiredScopes ?? ["mcp:access"],
          };
        },
      },
    },
    validateCalls,
  };
  // END_BLOCK_CREATE_MOCK_AUTH_GUARD_DEPENDENCIES_M_MCP_AUTH_GUARD_TEST_002
}

describe("M-MCP-AUTH-GUARD OAuth contract", () => {
  it("returns invalid_request challenge for missing Authorization header", async () => {
    const { deps, validateCalls } = createMockAuthDependencies("allow");
    const decision = await authorizeMcpRequest(null, deps);

    expect(decision.isAuthorized).toBe(false);
    if (decision.isAuthorized) {
      throw new Error("Expected denied decision.");
    }

    expect(decision.reason).toBe("MISSING_AUTH_HEADER");
    expect(decision.challenge.error).toBe("invalid_request");
    expect(decision.challenge.requiredScopes).toEqual(["mcp:access", "profile:read"]);
    expect(validateCalls).toEqual([]);
  });

  it("maps invalid_token validator response to deny decision and challenge header", async () => {
    const { deps } = createMockAuthDependencies("invalid_token");
    const decision = await authorizeMcpRequest("Bearer invalid-token", deps);

    expect(decision.isAuthorized).toBe(false);
    if (decision.isAuthorized) {
      throw new Error("Expected denied decision.");
    }

    expect(decision.reason).toBe("INVALID_TOKEN");
    const header = buildWwwAuthenticateHeader(decision.challenge);
    expect(header).toContain('Bearer error="invalid_token"');
    expect(header).toContain('scope="mcp:access profile:read"');
    expect(header).toContain('issuer="https://issuer.example.com"');
    expect(header).toContain('resource="https://resource.example.com/mcp"');
  });

  it("maps insufficient_scope validator response to deny decision", async () => {
    const { deps } = createMockAuthDependencies("insufficient_scope");
    const decision = await authorizeMcpRequest("Bearer limited-token", deps);

    expect(decision.isAuthorized).toBe(false);
    if (decision.isAuthorized) {
      throw new Error("Expected denied decision.");
    }

    expect(decision.reason).toBe("INSUFFICIENT_SCOPE");
    expect(decision.challenge.error).toBe("insufficient_scope");
  });

  it("returns authorized decision with subject and granted scopes for valid token", async () => {
    const { deps, validateCalls } = createMockAuthDependencies("allow");
    const decision = await authorizeMcpRequest("Bearer valid-token", deps);

    expect(decision.isAuthorized).toBe(true);
    if (!decision.isAuthorized) {
      throw new Error("Expected authorized decision.");
    }

    expect(decision.subject).toBe("user-123");
    expect(decision.grantedScopes).toEqual(["mcp:access", "profile:read"]);
    expect(validateCalls).toEqual(["Bearer valid-token"]);
  });

  it("throws typed MCP_AUTH_ERROR for internal validator failures", async () => {
    const { deps } = createMockAuthDependencies("throw");

    try {
      await authorizeMcpRequest("Bearer valid-token", deps);
      throw new Error("Expected authorizeMcpRequest to throw.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(McpAuthError);
      const typedError = error as McpAuthError;
      expect(typedError.code).toBe("MCP_AUTH_ERROR");
      expect(typedError.details?.field).toBe("oauthTokenValidator.validateAccessToken");
    }
  });
});
