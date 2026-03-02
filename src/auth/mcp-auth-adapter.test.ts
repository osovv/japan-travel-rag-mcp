// FILE: src/auth/mcp-auth-adapter.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify FastMCP auth adapter denied and allowed behaviors with deterministic OAuth challenge and session assertions.
//   SCOPE: Exercise authenticateFastMcpRequest directly with IncomingMessage-shaped authorization headers (undefined|string|string[]), mocked AppConfig/Logger/McpAuthContext dependencies, and deterministic 401/403/allow outcomes.
//   DEPENDS: M-MCP-AUTH-ADAPTER, M-MCP-AUTH-PROVIDER, M-CONFIG, M-LOGGER
//   LINKS: M-MCP-AUTH-ADAPTER-TEST, M-MCP-AUTH-ADAPTER, M-MCP-AUTH-PROVIDER, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build deterministic inert logger used by adapter unit tests.
//   createMockAppConfig - Build deterministic AppConfig with required OAuth scope/audience fields.
//   createIncomingMessage - Build IncomingMessage-shaped request with authorization header in string|string[]|undefined forms.
//   createMockAdapterDependencies - Build deterministic adapter dependencies and capture verify/issuer validation calls.
//   captureDeniedResponse - Execute adapter and capture thrown denied Response for assertion.
//   readJsonErrorPayload - Parse denied response JSON payload into normalized assertion shape.
//   McpAuthAdapterTests - Unit tests for missing header, malformed bearer, invalid token, insufficient scope, and valid token.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Added Phase-7 Step-6 unit tests for FastMCP auth adapter behavior and deterministic denied-response assertions.
// END_CHANGE_SUMMARY

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, it } from "bun:test";
import { MCPAuthTokenVerificationError } from "mcp-auth";
import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import { authenticateFastMcpRequest, type McpAuthSession } from "./mcp-auth-adapter";
import type { McpAuthContext } from "./mcp-auth-provider";

type MockAuthMode = "allow" | "invalid_token" | "insufficient_scope";

type JsonErrorPayload = {
  error: {
    code: string;
    message: string;
  };
};

type AuthenticateFastMcpDependencies = Parameters<typeof authenticateFastMcpRequest>[1];

// START_CONTRACT: createNoopLogger
//   PURPOSE: Build inert Logger implementation for deterministic adapter unit tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - Logger with no-op level methods and child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_FOR_ADAPTER_TESTS_M_MCP_AUTH_ADAPTER_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };

  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_FOR_ADAPTER_TESTS_M_MCP_AUTH_ADAPTER_TEST_001
}

// START_CONTRACT: createMockAppConfig
//   PURPOSE: Build deterministic AppConfig fixture used by adapter dependency mocks.
//   INPUTS: {}
//   OUTPUTS: { AppConfig - Config fixture with OAuth audience and required scopes }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG]
// END_CONTRACT: createMockAppConfig
function createMockAppConfig(): AppConfig {
  // START_BLOCK_CREATE_MOCK_APP_CONFIG_FOR_ADAPTER_TESTS_M_MCP_AUTH_ADAPTER_TEST_002
  return {
    port: 3000,
    publicUrl: "https://travel.example.com/",
    rootAuthToken: "root-token",
    databaseUrl: "postgresql://user:pass@localhost:5432/travel",
    oauth: {
      issuer: "https://issuer.example.com/",
      audience: "travel-mcp",
      requiredScopes: ["mcp:access", "profile:read"],
    },
    tgChatRag: {
      baseUrl: "https://upstream.example.com/",
      bearerToken: "upstream-token",

      timeoutMs: 15000,
    },
  };
  // END_BLOCK_CREATE_MOCK_APP_CONFIG_FOR_ADAPTER_TESTS_M_MCP_AUTH_ADAPTER_TEST_002
}

// START_CONTRACT: createIncomingMessage
//   PURPOSE: Build IncomingMessage-shaped test request with authorization header in undefined|string|string[] forms.
//   INPUTS: { authorizationHeader: string|string[]|undefined - Authorization header fixture value }
//   OUTPUTS: { IncomingMessage - IncomingMessage-shaped object for authenticateFastMcpRequest }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: createIncomingMessage
function createIncomingMessage(
  authorizationHeader: string | string[] | undefined,
): IncomingMessage {
  // START_BLOCK_BUILD_INCOMING_MESSAGE_SHAPE_WITH_AUTH_HEADER_M_MCP_AUTH_ADAPTER_TEST_003
  return {
    headers: {
      authorization: authorizationHeader,
    },
  } as IncomingMessage;
  // END_BLOCK_BUILD_INCOMING_MESSAGE_SHAPE_WITH_AUTH_HEADER_M_MCP_AUTH_ADAPTER_TEST_003
}

// START_CONTRACT: createMockAdapterDependencies
//   PURPOSE: Build deterministic adapter dependencies and capture auth verifier/issuer validator call arguments.
//   INPUTS: { mode: MockAuthMode - Adapter mock behavior mode }
//   OUTPUTS: { deps: AuthenticateFastMcpDependencies - Adapter dependencies, verifyCalls: string[] - Captured verify token values, validateIssuerCalls: string[] - Captured issuer validation values }
//   SIDE_EFFECTS: [Captures verify/issuer call values in local arrays]
//   LINKS: [M-MCP-AUTH-ADAPTER, M-MCP-AUTH-PROVIDER, M-CONFIG, M-LOGGER]
// END_CONTRACT: createMockAdapterDependencies
function createMockAdapterDependencies(mode: MockAuthMode): {
  deps: AuthenticateFastMcpDependencies;
  verifyCalls: string[];
  validateIssuerCalls: string[];
} {
  // START_BLOCK_CREATE_MOCK_ADAPTER_DEPENDENCIES_AND_CALL_CAPTURES_M_MCP_AUTH_ADAPTER_TEST_004
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
      tenant_id: "JP",
    },
    expiresAt: 1735689600,
  };

  const authContext: McpAuthContext = {
    mcpAuth: {} as McpAuthContext["mcpAuth"],
    verifyAccessToken: async (token: string): Promise<AuthInfo> => {
      verifyCalls.push(token);

      if (mode === "invalid_token") {
        throw new MCPAuthTokenVerificationError("invalid_token");
      }

      if (mode === "insufficient_scope") {
        return {
          ...baseAuthInfo,
          scopes: ["mcp:access"],
          claims: {
            scope: "mcp:access",
            tenant_id: "JP",
          },
        };
      }

      return baseAuthInfo;
    },
    validateIssuer: (issuer: string): void => {
      validateIssuerCalls.push(issuer);
    },
    resourceMetadataUrl:
      "https://travel.example.com/.well-known/oauth-protected-resource/mcp",
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
      config: createMockAppConfig(),
      logger: createNoopLogger(),
    },
    verifyCalls,
    validateIssuerCalls,
  };
  // END_BLOCK_CREATE_MOCK_ADAPTER_DEPENDENCIES_AND_CALL_CAPTURES_M_MCP_AUTH_ADAPTER_TEST_004
}

// START_CONTRACT: captureDeniedResponse
//   PURPOSE: Execute adapter authentication and return thrown denied Response for assertions.
//   INPUTS: { request: IncomingMessage - Incoming request fixture, deps: AuthenticateFastMcpDependencies - Adapter dependencies }
//   OUTPUTS: { Promise<Response> - Thrown denied Response }
//   SIDE_EFFECTS: [Consumes adapter invocation and rethrows unexpected non-Response errors]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: captureDeniedResponse
async function captureDeniedResponse(
  request: IncomingMessage,
  deps: AuthenticateFastMcpDependencies,
): Promise<Response> {
  // START_BLOCK_CAPTURE_THROWN_DENIED_RESPONSE_FROM_ADAPTER_M_MCP_AUTH_ADAPTER_TEST_005
  try {
    await authenticateFastMcpRequest(request, deps);
  } catch (error: unknown) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected authenticateFastMcpRequest to throw denied Response.");
  // END_BLOCK_CAPTURE_THROWN_DENIED_RESPONSE_FROM_ADAPTER_M_MCP_AUTH_ADAPTER_TEST_005
}

// START_CONTRACT: readJsonErrorPayload
//   PURPOSE: Parse denied response body JSON into normalized error payload shape for assertions.
//   INPUTS: { response: Response - Denied auth response }
//   OUTPUTS: { Promise<JsonErrorPayload> - Parsed JSON payload }
//   SIDE_EFFECTS: [Consumes Response body stream]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: readJsonErrorPayload
async function readJsonErrorPayload(response: Response): Promise<JsonErrorPayload> {
  // START_BLOCK_PARSE_DENIED_RESPONSE_JSON_PAYLOAD_M_MCP_AUTH_ADAPTER_TEST_006
  return (await response.json()) as JsonErrorPayload;
  // END_BLOCK_PARSE_DENIED_RESPONSE_JSON_PAYLOAD_M_MCP_AUTH_ADAPTER_TEST_006
}

describe("M-MCP-AUTH-ADAPTER FastMCP authenticate hook", () => {
  it("throws 401 Response with resource_metadata challenge when Authorization header is missing", async () => {
    const { deps, verifyCalls, validateIssuerCalls } = createMockAdapterDependencies("allow");

    const response = await captureDeniedResponse(createIncomingMessage(undefined), deps);

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");

    const wwwAuthenticate = response.headers.get("www-authenticate") ?? "";
    expect(wwwAuthenticate).toContain("Bearer");
    expect(wwwAuthenticate).toContain(
      'resource_metadata="https://travel.example.com/.well-known/oauth-protected-resource/mcp"',
    );
    expect(wwwAuthenticate).not.toContain("error=");

    const payload = await readJsonErrorPayload(response);
    expect(payload.error.code).toBe("UNAUTHORIZED");
    expect(payload.error.message).toBe("Invalid or missing OAuth access token.");

    expect(verifyCalls).toEqual([]);
    expect(validateIssuerCalls).toEqual([]);
  });

  it("throws 401 Response for malformed bearer header from IncomingMessage string[] input", async () => {
    const { deps, verifyCalls, validateIssuerCalls } = createMockAdapterDependencies("allow");

    const response = await captureDeniedResponse(
      createIncomingMessage(["Bearer first.jwt", "Bearer second.jwt"]),
      deps,
    );

    expect(response.status).toBe(401);

    const wwwAuthenticate = response.headers.get("www-authenticate") ?? "";
    expect(wwwAuthenticate).toContain("Bearer");
    expect(wwwAuthenticate).toContain(
      'resource_metadata="https://travel.example.com/.well-known/oauth-protected-resource/mcp"',
    );
    expect(wwwAuthenticate).not.toContain("error=");

    const payload = await readJsonErrorPayload(response);
    expect(payload.error.code).toBe("UNAUTHORIZED");
    expect(payload.error.message).toBe("Invalid or missing OAuth access token.");

    expect(verifyCalls).toEqual([]);
    expect(validateIssuerCalls).toEqual([]);
  });

  it("throws 401 invalid_token Response when token verification fails", async () => {
    const { deps, verifyCalls, validateIssuerCalls } = createMockAdapterDependencies("invalid_token");

    const response = await captureDeniedResponse(createIncomingMessage("Bearer broken.jwt"), deps);

    expect(response.status).toBe(401);

    const wwwAuthenticate = response.headers.get("www-authenticate") ?? "";
    expect(wwwAuthenticate).toContain('error="invalid_token"');
    expect(wwwAuthenticate).toContain(
      'error_description="OAuth access token verification failed."',
    );
    expect(wwwAuthenticate).toContain(
      'resource_metadata="https://travel.example.com/.well-known/oauth-protected-resource/mcp"',
    );

    const payload = await readJsonErrorPayload(response);
    expect(payload.error.code).toBe("UNAUTHORIZED");
    expect(payload.error.message).toBe("Invalid or missing OAuth access token.");

    expect(verifyCalls).toEqual(["broken.jwt"]);
    expect(validateIssuerCalls).toEqual([]);
  });

  it("throws 403 insufficient_scope Response with scope challenge when token lacks required scopes", async () => {
    const { deps, verifyCalls, validateIssuerCalls } = createMockAdapterDependencies(
      "insufficient_scope",
    );

    const response = await captureDeniedResponse(createIncomingMessage(["Bearer limited.jwt"]), deps);

    expect(response.status).toBe(403);

    const wwwAuthenticate = response.headers.get("www-authenticate") ?? "";
    expect(wwwAuthenticate).toContain('error="insufficient_scope"');
    expect(wwwAuthenticate).toContain('scope="mcp:access profile:read"');
    expect(wwwAuthenticate).toContain(
      'resource_metadata="https://travel.example.com/.well-known/oauth-protected-resource/mcp"',
    );

    const payload = await readJsonErrorPayload(response);
    expect(payload.error.code).toBe("FORBIDDEN");
    expect(payload.error.message).toBe("OAuth access token does not include required scopes.");

    expect(verifyCalls).toEqual(["limited.jwt"]);
    expect(validateIssuerCalls).toEqual(["https://issuer.example.com/"]);
  });

  it("returns typed McpAuthSession with expected subject/scopes/audience/issuer for valid token", async () => {
    const { deps, verifyCalls, validateIssuerCalls } = createMockAdapterDependencies("allow");

    const session: McpAuthSession = await authenticateFastMcpRequest(
      createIncomingMessage("Bearer valid.jwt"),
      deps,
    );

    expect(session.subject).toBe("user-123");
    expect(session.grantedScopes).toEqual(["mcp:access", "profile:read"]);
    expect(session.audience).toBe("travel-mcp");
    expect(session.issuer).toBe("https://issuer.example.com/");

    expect(verifyCalls).toEqual(["valid.jwt"]);
    expect(validateIssuerCalls).toEqual(["https://issuer.example.com/"]);
  });
});
