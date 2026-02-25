// FILE: src/admin/ui-routes.ops.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate admin UI route behavior after transitioning from API-key management to ops diagnostics surface.
//   SCOPE: Assert /admin redirect target, /admin/ops diagnostics rendering for full and HTMX requests, and consistent /admin/api-keys* deprecation responses.
//   DEPENDS: M-ADMIN-UI, M-ADMIN-AUTH, M-LOGGER, M-CONFIG
//   LINKS: M-ADMIN-UI, M-ADMIN-AUTH, M-LOGGER, M-CONFIG
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Create no-op logger implementation for deterministic route tests.
//   createTestConfig - Build valid AppConfig fixture with OAuth diagnostics values.
//   createDependencies - Build AdminUiDependencies with overrideable auth helper behavior.
//   AdminUiOpsRouteTests - Focused tests for ops diagnostics route and API-key deprecation behavior.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Added focused tests for /admin/ops routing and /admin/api-keys deprecation behavior.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import type { ApiKeyRepository } from "./api-key-repository";
import { ADMIN_OPS_PATH, handleAdminRequest } from "./ui-routes";

type DependencyOverrides = {
  requireAdminSession?: (
    request: Request,
    config: AppConfig,
    logger: Logger,
  ) =>
    | { isAuthenticated: true }
    | {
        isAuthenticated: false;
        reason: "MISSING_SESSION_COOKIE" | "INVALID_SESSION_COOKIE" | "EXPIRED_SESSION_COOKIE";
        status: 302;
        location: "/admin/login";
        setCookie?: string;
      };
};

// START_CONTRACT: createNoopLogger
//   PURPOSE: Provide a no-op logger compatible with Logger interface for isolated tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - Logger with inert methods and child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_FOR_ADMIN_UI_TESTS_M_ADMIN_UI_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_FOR_ADMIN_UI_TESTS_M_ADMIN_UI_TEST_001
}

// START_CONTRACT: createTestConfig
//   PURPOSE: Build deterministic AppConfig fixture for admin UI route tests.
//   INPUTS: {}
//   OUTPUTS: { AppConfig - Runtime config fixture with OAuth diagnostics values }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG]
// END_CONTRACT: createTestConfig
function createTestConfig(): AppConfig {
  // START_BLOCK_BUILD_APP_CONFIG_FIXTURE_FOR_ADMIN_UI_TESTS_M_ADMIN_UI_TEST_002
  return {
    port: 3000,
    publicUrl: "https://travel.example.com/",
    rootAuthToken: "root-secret",
    databaseUrl: "postgresql://user:pass@localhost:5432/db",
    oauth: {
      issuer: "https://issuer.example.com/",
      audience: "travel-mcp",
      requiredScopes: ["mcp:access", "profile:read"],
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
  // END_BLOCK_BUILD_APP_CONFIG_FIXTURE_FOR_ADMIN_UI_TESTS_M_ADMIN_UI_TEST_002
}

// START_CONTRACT: createDependencies
//   PURPOSE: Build admin UI dependencies with overrideable auth session behavior.
//   INPUTS: { overrides: DependencyOverrides|undefined - Optional overrides for auth helper behavior }
//   OUTPUTS: { Parameters<typeof handleAdminRequest>[1] - Dependency object for handleAdminRequest }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: createDependencies
function createDependencies(overrides?: DependencyOverrides): Parameters<typeof handleAdminRequest>[1] {
  // START_BLOCK_BUILD_ADMIN_UI_DEPENDENCIES_FOR_ROUTE_TESTS_M_ADMIN_UI_TEST_003
  const requireAdminSession =
    overrides?.requireAdminSession ??
    (() => {
      return { isAuthenticated: true } as const;
    });

  return {
    config: createTestConfig(),
    logger: createNoopLogger(),
    apiKeyRepository: {} as ApiKeyRepository,
    authenticateAdmin: () => {
      return { isAuthenticated: false, sessionCookie: null, reason: "INVALID_LOGIN_TOKEN" } as const;
    },
    requireAdminSession,
    clearAdminSession: () => "admin_session=; Path=/; Max-Age=0",
  };
  // END_BLOCK_BUILD_ADMIN_UI_DEPENDENCIES_FOR_ROUTE_TESTS_M_ADMIN_UI_TEST_003
}

describe("M-ADMIN-UI ops diagnostics routing", () => {
  it("redirects authenticated /admin GET requests to /admin/ops", async () => {
    const response = await handleAdminRequest(
      new Request("http://localhost/admin", { method: "GET" }),
      createDependencies(),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(ADMIN_OPS_PATH);
  });

  it("renders full diagnostics layout for non-HTMX /admin/ops GET", async () => {
    const response = await handleAdminRequest(
      new Request("http://localhost/admin/ops", { method: "GET" }),
      createDependencies(),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Ops diagnostics");
    expect(html).toContain("https://travel.example.com/");
    expect(html).toContain("https://issuer.example.com/");
    expect(html).toContain("travel-mcp");
    expect(html).toContain("mcp:access, profile:read");
    expect(html).toContain("https://travel.example.com/mcp");
    expect(html).toContain("https://travel.example.com/.well-known/oauth-protected-resource");
    expect(html).toContain("https://travel.example.com/.well-known/oauth-protected-resource/mcp");
    expect(html).not.toContain("Create API key");
  });

  it("renders diagnostics fragment for HTMX /admin/ops GET", async () => {
    const response = await handleAdminRequest(
      new Request("http://localhost/admin/ops", {
        method: "GET",
        headers: {
          "HX-Request": "true",
        },
      }),
      createDependencies(),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(`id="ops-status-panel"`);
    expect(html).toContain("Configuration status");
    expect(html).not.toContain("<!doctype html>");
  });

  it("returns 410 deprecation response for /admin/api-keys and child routes", async () => {
    const listResponse = await handleAdminRequest(
      new Request("http://localhost/admin/api-keys", { method: "GET" }),
      createDependencies(),
    );
    const listHtml = await listResponse.text();

    const childResponse = await handleAdminRequest(
      new Request("http://localhost/admin/api-keys/some-id/revoke", { method: "POST" }),
      createDependencies(),
    );
    const childHtml = await childResponse.text();

    expect(listResponse.status).toBe(410);
    expect(childResponse.status).toBe(410);
    expect(listHtml).toContain("API key management deprecated");
    expect(listHtml).toContain(ADMIN_OPS_PATH);
    expect(listHtml).not.toContain("Create API key");
    expect(listHtml).not.toContain('action="/admin/api-keys"');
    expect(childHtml).toContain("API key management deprecated");
    expect(childHtml).not.toContain("Revoke");
  });
});
