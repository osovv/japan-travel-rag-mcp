// FILE: src/auth/mcp-auth-guard.test.ts
// VERSION: 2.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate Request-based mcp-auth guard behavior and response-ready deny decisions.
//   SCOPE: Cover missing header, invalid token, insufficient scope, valid token, and denied response formatting for WWW-Authenticate and JSON payloads.
//   DEPENDS: M-MCP-AUTH-GUARD, M-MCP-AUTH-PROVIDER, M-LOGGER
//   LINKS: M-MCP-AUTH-GUARD, M-MCP-AUTH-PROVIDER, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build inert logger for focused auth guard tests.
//   createMcpRequest - Build Request instances with optional Authorization header.
//   createMockAuthDependencies - Build deterministic McpAuthContext-backed dependencies for each auth test mode.
//   readJsonErrorPayload - Parse denied response body and return normalized error payload for assertions.
//   McpAuthGuardTests - Focused tests for Request-based auth decisions and deny response formatting.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v2.0.0 - Rewrote tests to Request-based guard API with mocked McpAuthContext and denied Response assertions.
// END_CHANGE_SUMMARY

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, it } from "bun:test";
import { MCPAuthBearerAuthError, MCPAuthTokenVerificationError } from "mcp-auth";
import { authorizeMcpRequest } from "./mcp-auth-guard";
import type { McpAuthGuardDependencies } from "./mcp-auth-guard";
import type { McpAuthDecision } from "./mcp-auth-guard";
import type { McpAuthContext } from "./mcp-auth-provider";
import type { Logger } from "../logger/index";

type MockAuthMode =
  | "allow"
  | "invalid_token"
  | "insufficient_scope"
  | "invalid_issuer"
  | "internal_throw";

type JsonErrorPayload = {
  error: {
    code: string;
    message: string;
  };
};

// START_CONTRACT: createNoopLogger
//   PURPOSE: Provide no-op logger implementation for deterministic auth guard tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - Logger with inert methods and child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_FOR_GUARD_TESTS_M_MCP_AUTH_GUARD_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };

  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_FOR_GUARD_TESTS_M_MCP_AUTH_GUARD_TEST_001
}

// START_CONTRACT: createMcpRequest
//   PURPOSE: Build POST /mcp Request objects with optional Authorization header for guard invocation.
//   INPUTS: { authorizationHeader: string|undefined - Optional Authorization header value }
//   OUTPUTS: { Request - Request instance for authorizeMcpRequest }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: createMcpRequest
function createMcpRequest(authorizationHeader?: string): Request {
  // START_BLOCK_BUILD_REQUEST_WITH_OPTIONAL_AUTHORIZATION_HEADER_M_MCP_AUTH_GUARD_TEST_002
  const headers = new Headers();
  if (authorizationHeader !== undefined) {
    headers.set("authorization", authorizationHeader);
  }

  return new Request("https://travel.example.com/mcp", {
    method: "POST",
    headers,
  });
  // END_BLOCK_BUILD_REQUEST_WITH_OPTIONAL_AUTHORIZATION_HEADER_M_MCP_AUTH_GUARD_TEST_002
}

// START_CONTRACT: createMockAuthDependencies
//   PURPOSE: Build deterministic auth guard dependencies backed by mocked McpAuthContext behavior and call capture.
//   INPUTS: { mode: MockAuthMode - Mock auth flow mode }
//   OUTPUTS: { deps: McpAuthGuardDependencies - Guard dependencies, verifyCalls: string[] - Captured verify token values, validateIssuerCalls: string[] - Captured issuer validation values }
//   SIDE_EFFECTS: [Captures verifyAccessToken and validateIssuer call values in memory]
//   LINKS: [M-MCP-AUTH-GUARD, M-MCP-AUTH-PROVIDER]
// END_CONTRACT: createMockAuthDependencies
function createMockAuthDependencies(mode: MockAuthMode): {
  deps: McpAuthGuardDependencies;
  verifyCalls: string[];
  validateIssuerCalls: string[];
} {
  // START_BLOCK_CREATE_MOCK_AUTH_CONTEXT_DEPENDENCIES_M_MCP_AUTH_GUARD_TEST_003
  const verifyCalls: string[] = [];
  const validateIssuerCalls: string[] = [];

  const baseAuthInfo: AuthInfo = {
    token: "jwt-token",
    issuer: "https://issuer.example.com/",
    clientId: "client-123",
    scopes: ["mcp:access", "profile:read"],
    audience: "travel-mcp",
    subject: "user-123",
    claims: {
      scope: "mcp:access profile:read",
    },
  };

  const authContext: McpAuthContext = {
    mcpAuth: {} as McpAuthContext["mcpAuth"],
    verifyAccessToken: async (token: string): Promise<AuthInfo> => {
      verifyCalls.push(token);

      if (mode === "invalid_token") {
        throw new MCPAuthTokenVerificationError("invalid_token");
      }

      if (mode === "internal_throw") {
        throw new Error("unexpected verifier failure");
      }

      if (mode === "insufficient_scope") {
        return {
          ...baseAuthInfo,
          scopes: ["mcp:access"],
          claims: {
            scope: "mcp:access",
          },
        };
      }

      return baseAuthInfo;
    },
    validateIssuer: (issuer: string): void => {
      validateIssuerCalls.push(issuer);

      if (mode === "invalid_issuer") {
        throw new MCPAuthBearerAuthError("invalid_issuer", {
          expected: "https://issuer.example.com/",
          actual: issuer,
        });
      }
    },
    resourceMetadataUrl: "https://travel.example.com/.well-known/oauth-protected-resource/mcp",
    protectedResourceMetadata: {
      resource: "https://travel.example.com/mcp",
      authorization_servers: ["https://issuer.example.com/"],
      scopes_supported: ["mcp:access", "profile:read"],
      bearer_methods_supported: ["header"],
    },
    authorizationServerMetadata: {
      issuer: "https://issuer.example.com/",
      authorization_endpoint: "https://issuer.example.com/authorize",
      token_endpoint: "https://issuer.example.com/token",
      jwks_uri: "https://issuer.example.com/jwks",
    },
  };

  return {
    deps: {
      authContext,
      audience: "travel-mcp",
      requiredScopes: ["mcp:access", "profile:read"],
      logger: createNoopLogger(),
    },
    verifyCalls,
    validateIssuerCalls,
  };
  // END_BLOCK_CREATE_MOCK_AUTH_CONTEXT_DEPENDENCIES_M_MCP_AUTH_GUARD_TEST_003
}

// START_CONTRACT: readJsonErrorPayload
//   PURPOSE: Parse denied response JSON body and normalize to { error: { code, message } } shape.
//   INPUTS: { response: Response - Denied auth response }
//   OUTPUTS: { Promise<JsonErrorPayload> - Parsed error payload }
//   SIDE_EFFECTS: [Consumes response body stream]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: readJsonErrorPayload
async function readJsonErrorPayload(response: Response): Promise<JsonErrorPayload> {
  // START_BLOCK_PARSE_DENIED_RESPONSE_JSON_PAYLOAD_M_MCP_AUTH_GUARD_TEST_004
  const payload = (await response.json()) as JsonErrorPayload;
  return payload;
  // END_BLOCK_PARSE_DENIED_RESPONSE_JSON_PAYLOAD_M_MCP_AUTH_GUARD_TEST_004
}

// START_CONTRACT: isDeniedDecision
//   PURPOSE: Narrow McpAuthDecision union to denied branch for type-safe response assertions.
//   INPUTS: { decision: McpAuthDecision - Auth decision returned by authorizeMcpRequest }
//   OUTPUTS: { decision is Extract<McpAuthDecision, { isAuthorized: false }> - True when decision is denied }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: isDeniedDecision
function isDeniedDecision(
  decision: McpAuthDecision,
): decision is Extract<McpAuthDecision, { isAuthorized: false }> {
  // START_BLOCK_NARROW_DENIED_AUTH_DECISION_IN_TESTS_M_MCP_AUTH_GUARD_TEST_005
  return !decision.isAuthorized;
  // END_BLOCK_NARROW_DENIED_AUTH_DECISION_IN_TESTS_M_MCP_AUTH_GUARD_TEST_005
}

// START_CONTRACT: isAuthorizedDecision
//   PURPOSE: Narrow McpAuthDecision union to authorized branch for type-safe AuthInfo assertions.
//   INPUTS: { decision: McpAuthDecision - Auth decision returned by authorizeMcpRequest }
//   OUTPUTS: { decision is Extract<McpAuthDecision, { isAuthorized: true }> - True when decision is authorized }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: isAuthorizedDecision
function isAuthorizedDecision(
  decision: McpAuthDecision,
): decision is Extract<McpAuthDecision, { isAuthorized: true }> {
  // START_BLOCK_NARROW_AUTHORIZED_AUTH_DECISION_IN_TESTS_M_MCP_AUTH_GUARD_TEST_006
  return decision.isAuthorized;
  // END_BLOCK_NARROW_AUTHORIZED_AUTH_DECISION_IN_TESTS_M_MCP_AUTH_GUARD_TEST_006
}

describe("M-MCP-AUTH-GUARD Request contract", () => {
  it("returns 401 denied response for missing Authorization header", async () => {
    const { deps, verifyCalls, validateIssuerCalls } = createMockAuthDependencies("allow");

    const decision = await authorizeMcpRequest(createMcpRequest(), deps);

    expect(decision.isAuthorized).toBe(false);
    if (!isDeniedDecision(decision)) {
      throw new Error("Expected denied decision.");
    }

    expect(decision.reason).toBe("MISSING_AUTH_HEADER");
    expect(decision.response.status).toBe(401);
    expect(decision.response.headers.get("content-type")).toContain("application/json");

    const wwwAuthenticate = decision.response.headers.get("www-authenticate") ?? "";
    expect(wwwAuthenticate).toContain("Bearer");
    expect(wwwAuthenticate).toContain('resource_metadata="https://travel.example.com/.well-known/oauth-protected-resource/mcp"');
    expect(wwwAuthenticate).not.toContain("error=");

    const payload = await readJsonErrorPayload(decision.response);
    expect(payload.error.code).toBe("UNAUTHORIZED");
    expect(payload.error.message).toBe("Invalid or missing OAuth access token.");

    expect(verifyCalls).toEqual([]);
    expect(validateIssuerCalls).toEqual([]);
  });

  it("returns 401 invalid_token response when verifyAccessToken throws MCPAuthTokenVerificationError", async () => {
    const { deps, verifyCalls, validateIssuerCalls } = createMockAuthDependencies("invalid_token");

    const decision = await authorizeMcpRequest(createMcpRequest("Bearer broken.jwt"), deps);

    expect(decision.isAuthorized).toBe(false);
    if (!isDeniedDecision(decision)) {
      throw new Error("Expected denied decision.");
    }

    expect(decision.reason).toBe("INVALID_TOKEN");
    expect(decision.response.status).toBe(401);

    const wwwAuthenticate = decision.response.headers.get("www-authenticate") ?? "";
    expect(wwwAuthenticate).toContain('error="invalid_token"');
    expect(wwwAuthenticate).toContain('resource_metadata="https://travel.example.com/.well-known/oauth-protected-resource/mcp"');

    const payload = await readJsonErrorPayload(decision.response);
    expect(payload.error.code).toBe("UNAUTHORIZED");

    expect(verifyCalls).toEqual(["broken.jwt"]);
    expect(validateIssuerCalls).toEqual([]);
  });

  it("returns 403 insufficient_scope response when token lacks required scopes", async () => {
    const { deps, verifyCalls, validateIssuerCalls } = createMockAuthDependencies("insufficient_scope");

    const decision = await authorizeMcpRequest(createMcpRequest("Bearer limited.jwt"), deps);

    expect(decision.isAuthorized).toBe(false);
    if (!isDeniedDecision(decision)) {
      throw new Error("Expected denied decision.");
    }

    expect(decision.reason).toBe("INSUFFICIENT_SCOPE");
    expect(decision.response.status).toBe(403);

    const wwwAuthenticate = decision.response.headers.get("www-authenticate") ?? "";
    expect(wwwAuthenticate).toContain('error="insufficient_scope"');
    expect(wwwAuthenticate).toContain('scope="mcp:access profile:read"');

    const payload = await readJsonErrorPayload(decision.response);
    expect(payload.error.code).toBe("FORBIDDEN");
    expect(payload.error.message).toBe("OAuth access token does not include required scopes.");

    expect(verifyCalls).toEqual(["limited.jwt"]);
    expect(validateIssuerCalls).toEqual(["https://issuer.example.com/"]);
  });

  it("returns authorized decision with AuthInfo, subject, and grantedScopes for valid token", async () => {
    const { deps, verifyCalls, validateIssuerCalls } = createMockAuthDependencies("allow");

    const decision = await authorizeMcpRequest(createMcpRequest("Bearer valid.jwt"), deps);

    expect(decision.isAuthorized).toBe(true);
    if (!isAuthorizedDecision(decision)) {
      throw new Error("Expected authorized decision.");
    }

    expect(decision.subject).toBe("user-123");
    expect(decision.grantedScopes).toEqual(["mcp:access", "profile:read"]);
    expect(decision.authInfo.issuer).toBe("https://issuer.example.com/");
    expect(decision.authInfo.audience).toBe("travel-mcp");

    expect(verifyCalls).toEqual(["valid.jwt"]);
    expect(validateIssuerCalls).toEqual(["https://issuer.example.com/"]);
  });

  it("formats denied response with WWW-Authenticate and JSON error payload for invalid issuer", async () => {
    const { deps } = createMockAuthDependencies("invalid_issuer");

    const decision = await authorizeMcpRequest(createMcpRequest("Bearer issuer-mismatch.jwt"), deps);

    expect(decision.isAuthorized).toBe(false);
    if (!isDeniedDecision(decision)) {
      throw new Error("Expected denied decision.");
    }

    expect(decision.reason).toBe("INVALID_ISSUER");
    expect(decision.response.status).toBe(401);
    expect(decision.response.headers.get("content-type")).toContain("application/json");

    const wwwAuthenticate = decision.response.headers.get("www-authenticate") ?? "";
    expect(wwwAuthenticate).toContain("Bearer");
    expect(wwwAuthenticate).toContain('error="invalid_token"');
    expect(wwwAuthenticate).toContain('error_description="OAuth access token issuer is not trusted."');
    expect(wwwAuthenticate).toContain('resource="https://travel.example.com/mcp"');

    const payload = await readJsonErrorPayload(decision.response);
    expect(payload.error.code).toBe("UNAUTHORIZED");
    expect(payload.error.message).toBe("Invalid or missing OAuth access token.");
  });
});
