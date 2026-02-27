// FILE: src/server/server-integration.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Provide focused integration coverage for server auth/discovery flow after mcp-auth migration.
//   SCOPE: Validate protected-resource metadata coherence, initial unauthenticated challenge format, and token-based /mcp authorization decisions via Request-based guard integration.
//   DEPENDS: M-SERVER, M-MCP-AUTH-GUARD, M-MCP-AUTH-PROVIDER, M-LOGGER
//   LINKS: M-SERVER, M-MCP-AUTH-GUARD, M-MCP-AUTH-PROVIDER, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build inert logger for deterministic integration tests.
//   createMcpRequest - Build POST /mcp request with optional Authorization header.
//   createMockIntegrationDependencies - Build McpAuthContext-backed dependencies for allow/deny integration paths.
//   createServerLikeHandler - Emulate server route behavior for metadata and /mcp auth flow.
//   readJsonPayload - Parse JSON response payload for assertions.
//   ServerIntegrationTests - Focused tests for discovery coherence, initial challenge format, and token-based auth flow.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Added consolidated Phase-7 server integration tests for metadata, initial challenge, and token-auth flow.
// END_CHANGE_SUMMARY

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, it } from "bun:test";
import { MCPAuthTokenVerificationError } from "mcp-auth";
import { authorizeMcpRequest } from "../auth/mcp-auth-guard";
import type { McpAuthGuardDependencies } from "../auth/mcp-auth-guard";
import type { McpAuthContext } from "../auth/mcp-auth-provider";
import type { Logger } from "../logger/index";

type MockAuthMode = "allow" | "invalid_token";

type ServerLikeDependencies = {
  authDeps: McpAuthGuardDependencies;
  logger: Logger;
};

type GuardDecision = Awaited<ReturnType<typeof authorizeMcpRequest>>;

// START_CONTRACT: createNoopLogger
//   PURPOSE: Build no-op logger implementation for deterministic integration tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - Logger with inert methods and child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_FOR_SERVER_INTEGRATION_TESTS_M_SERVER_INTEGRATION_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };

  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_FOR_SERVER_INTEGRATION_TESTS_M_SERVER_INTEGRATION_TEST_001
}

// START_CONTRACT: createMcpRequest
//   PURPOSE: Build POST /mcp request with optional Authorization header.
//   INPUTS: { authorizationHeader: string|undefined - Optional Authorization header value }
//   OUTPUTS: { Request - Request object for /mcp route simulation }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SERVER]
// END_CONTRACT: createMcpRequest
function createMcpRequest(authorizationHeader?: string): Request {
  // START_BLOCK_BUILD_MCP_REQUEST_WITH_OPTIONAL_AUTH_HEADER_M_SERVER_INTEGRATION_TEST_002
  const headers = new Headers({
    "content-type": "application/json",
  });

  if (authorizationHeader !== undefined) {
    headers.set("authorization", authorizationHeader);
  }

  return new Request("https://travel.example.com/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
  // END_BLOCK_BUILD_MCP_REQUEST_WITH_OPTIONAL_AUTH_HEADER_M_SERVER_INTEGRATION_TEST_002
}

// START_CONTRACT: createMockIntegrationDependencies
//   PURPOSE: Build McpAuthContext-backed guard dependencies with deterministic token verification behavior.
//   INPUTS: { mode: MockAuthMode - allow or invalid_token behavior }
//   OUTPUTS: { deps: ServerLikeDependencies - Integration dependencies, verifyCalls: string[] - Captured token verification calls }
//   SIDE_EFFECTS: [Captures verifyAccessToken token values in memory]
//   LINKS: [M-MCP-AUTH-PROVIDER, M-MCP-AUTH-GUARD]
// END_CONTRACT: createMockIntegrationDependencies
function createMockIntegrationDependencies(mode: MockAuthMode): {
  deps: ServerLikeDependencies;
  verifyCalls: string[];
} {
  // START_BLOCK_BUILD_MOCK_SERVER_INTEGRATION_DEPS_M_SERVER_INTEGRATION_TEST_003
  const verifyCalls: string[] = [];
  const logger = createNoopLogger();

  const authContext: McpAuthContext = {
    mcpAuth: {} as McpAuthContext["mcpAuth"],
    verifyAccessToken: async (token: string): Promise<AuthInfo> => {
      verifyCalls.push(token);

      if (mode === "invalid_token") {
        throw new MCPAuthTokenVerificationError("invalid_token");
      }

      return {
        token,
        issuer: "https://issuer.example.com/",
        clientId: "client-123",
        scopes: ["mcp:access", "profile:read"],
        audience: "travel-mcp",
        subject: "user-123",
        claims: {
          scope: "mcp:access profile:read",
        },
      };
    },
    validateIssuer: () => {},
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
      authDeps: {
        authContext,
        audience: "travel-mcp",
        requiredScopes: ["mcp:access", "profile:read"],
        logger,
      },
      logger,
    },
    verifyCalls,
  };
  // END_BLOCK_BUILD_MOCK_SERVER_INTEGRATION_DEPS_M_SERVER_INTEGRATION_TEST_003
}

// START_CONTRACT: createServerLikeHandler
//   PURPOSE: Emulate server routing for protected-resource metadata and /mcp auth flow integration checks.
//   INPUTS: { deps: ServerLikeDependencies - Mocked server dependencies }
//   OUTPUTS: { (request: Request) => Promise<Response> - Route-like request handler }
//   SIDE_EFFECTS: [Invokes authorizeMcpRequest and emits logs]
//   LINKS: [M-SERVER, M-MCP-AUTH-GUARD]
// END_CONTRACT: createServerLikeHandler
function createServerLikeHandler(
  deps: ServerLikeDependencies,
): (request: Request) => Promise<Response> {
  // START_BLOCK_CREATE_ROUTE_LIKE_HANDLER_FOR_INTEGRATION_TESTS_M_SERVER_INTEGRATION_TEST_004
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (
      request.method === "GET" &&
      (url.pathname === "/.well-known/oauth-protected-resource" ||
        url.pathname === "/.well-known/oauth-protected-resource/mcp")
    ) {
      return new Response(JSON.stringify(deps.authDeps.authContext.protectedResourceMetadata), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/mcp") {
      const decision = await authorizeMcpRequest(request, deps.authDeps);

      if (isDeniedGuardDecision(decision)) {
        return decision.response;
      }

      return new Response(
        JSON.stringify({
          ok: true,
          subject: decision.subject ?? null,
          grantedScopes: decision.grantedScopes,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        },
      );
    }

    return new Response(
      JSON.stringify({
        error: {
          code: "NOT_FOUND",
          message: "Route not found.",
        },
      }),
      {
        status: 404,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  };
  // END_BLOCK_CREATE_ROUTE_LIKE_HANDLER_FOR_INTEGRATION_TESTS_M_SERVER_INTEGRATION_TEST_004
}

// START_CONTRACT: readJsonPayload
//   PURPOSE: Parse JSON payload from a response for deterministic assertion helpers.
//   INPUTS: { response: Response - HTTP response from server-like handler }
//   OUTPUTS: { Promise<Record<string, unknown>> - Parsed JSON payload }
//   SIDE_EFFECTS: [Consumes response body stream]
//   LINKS: [M-SERVER]
// END_CONTRACT: readJsonPayload
async function readJsonPayload(response: Response): Promise<Record<string, unknown>> {
  // START_BLOCK_PARSE_JSON_PAYLOAD_FOR_INTEGRATION_ASSERTIONS_M_SERVER_INTEGRATION_TEST_005
  return (await response.json()) as Record<string, unknown>;
  // END_BLOCK_PARSE_JSON_PAYLOAD_FOR_INTEGRATION_ASSERTIONS_M_SERVER_INTEGRATION_TEST_005
}

// START_CONTRACT: isDeniedGuardDecision
//   PURPOSE: Narrow guard decision union to denied branch for type-safe response passthrough.
//   INPUTS: { decision: GuardDecision - Decision returned by authorizeMcpRequest }
//   OUTPUTS: { decision is Extract<GuardDecision, { isAuthorized: false }> - True when denied branch is active }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: isDeniedGuardDecision
function isDeniedGuardDecision(
  decision: GuardDecision,
): decision is Extract<GuardDecision, { isAuthorized: false }> {
  // START_BLOCK_NARROW_DENIED_DECISION_FOR_SERVER_INTEGRATION_M_SERVER_INTEGRATION_TEST_006
  return !decision.isAuthorized;
  // END_BLOCK_NARROW_DENIED_DECISION_FOR_SERVER_INTEGRATION_M_SERVER_INTEGRATION_TEST_006
}

describe("M-SERVER integration flow", () => {
  it("returns coherent protected-resource metadata payload for discovery routes", async () => {
    const { deps } = createMockIntegrationDependencies("allow");
    const handleRequest = createServerLikeHandler(deps);

    const response = await handleRequest(
      new Request("https://travel.example.com/.well-known/oauth-protected-resource/mcp", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await readJsonPayload(response)) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };

    expect(payload.resource).toBe("https://travel.example.com/mcp");
    expect(payload.authorization_servers).toEqual(["https://issuer.example.com/"]);
    expect(payload.scopes_supported).toEqual(["mcp:access", "profile:read"]);
  });

  it("returns initial 401 challenge with resource_metadata for missing Authorization header", async () => {
    const { deps, verifyCalls } = createMockIntegrationDependencies("allow");
    const handleRequest = createServerLikeHandler(deps);

    const response = await handleRequest(createMcpRequest());

    expect(response.status).toBe(401);
    const header = response.headers.get("www-authenticate") ?? "";
    expect(header).toContain("Bearer");
    expect(header).toContain(
      'resource_metadata="https://travel.example.com/.well-known/oauth-protected-resource/mcp"',
    );
    expect(header).not.toContain("error=");

    const payload = (await readJsonPayload(response)) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe("UNAUTHORIZED");
    expect(payload.error.message).toBe("Invalid or missing OAuth access token.");
    expect(verifyCalls).toEqual([]);
  });

  it("denies invalid token and allows valid token in /mcp auth flow", async () => {
    const invalid = createMockIntegrationDependencies("invalid_token");
    const allow = createMockIntegrationDependencies("allow");
    const handleInvalid = createServerLikeHandler(invalid.deps);
    const handleAllow = createServerLikeHandler(allow.deps);

    const invalidResponse = await handleInvalid(createMcpRequest("Bearer bad.jwt"));
    expect(invalidResponse.status).toBe(401);
    const invalidHeader = invalidResponse.headers.get("www-authenticate") ?? "";
    expect(invalidHeader).toContain('error="invalid_token"');
    expect(invalid.verifyCalls).toEqual(["bad.jwt"]);

    const allowResponse = await handleAllow(createMcpRequest("Bearer good.jwt"));
    expect(allowResponse.status).toBe(200);
    const allowPayload = (await readJsonPayload(allowResponse)) as {
      ok: boolean;
      subject: string | null;
      grantedScopes: string[];
    };
    expect(allowPayload.ok).toBe(true);
    expect(allowPayload.subject).toBe("user-123");
    expect(allowPayload.grantedScopes).toEqual(["mcp:access", "profile:read"]);
    expect(allow.verifyCalls).toEqual(["good.jwt"]);
  });
});
