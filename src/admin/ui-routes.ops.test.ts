// FILE: src/admin/ui-routes.ops.test.ts
// VERSION: 1.4.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate admin UI route behavior after transitioning from API-key management to ops diagnostics surface.
//   SCOPE: Assert admin login/session redirect stability, /admin/login POST success/failure behavior, /admin redirect target, /admin/ops diagnostics rendering for full and HTMX requests, and default not-found behavior for removed /admin/api-keys* routes.
//   DEPENDS: M-ADMIN-UI, M-ADMIN-AUTH, M-LOGGER, M-CONFIG
//   LINKS: M-ADMIN-UI-OPS-TEST, M-ADMIN-UI, M-ADMIN-AUTH, M-LOGGER, M-CONFIG
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Create no-op logger implementation for deterministic route tests.
//   createTestConfig - Build valid AppConfig fixture with Logto diagnostics values.
//   createDependencies - Build AdminUiDependencies with overrideable auth helper behavior.
//   createLoginPostRequest - Build deterministic /admin/login POST request payload.
//   AdminUiOpsRouteTests - Focused tests for login/session stability, ops diagnostics route behavior, and removed API-key surface behavior.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.4.0 - Rebased AppConfig fixture and diagnostics assertions on logto.* fields after config.oauth removal and added secret redaction assertion.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import { ADMIN_OPS_PATH, handleAdminRequest } from "./ui-routes";

type AdminRouteDependencies = Parameters<typeof handleAdminRequest>[1];

type DependencyOverrides = {
  requireAdminSession?: NonNullable<AdminRouteDependencies["requireAdminSession"]>;
  authenticateAdmin?: NonNullable<AdminRouteDependencies["authenticateAdmin"]>;
  clearAdminSession?: NonNullable<AdminRouteDependencies["clearAdminSession"]>;
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
//   OUTPUTS: { AppConfig - Runtime config fixture with Logto diagnostics values }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG]
// END_CONTRACT: createTestConfig
function createTestConfig(): AppConfig {
  // START_BLOCK_BUILD_APP_CONFIG_FIXTURE_FOR_ADMIN_UI_TESTS_M_ADMIN_UI_TEST_002
  return {
    port: 3000,
    publicUrl: "https://travel.example.com/",
    rootAuthToken: "root-secret",
    databaseUrl: "postgres://localhost:5432/test",
    oauthSessionSecret: "test-oauth-session-secret-at-least-32-characters",
    devMode: false,
    logto: {
      tenantUrl: "https://travel-app.logto.app/",
      clientId: "travel-client-id",
      clientSecret: "travel-client-secret",
      oidcAuthEndpoint: "https://travel-app.logto.app/oidc/auth",
      oidcTokenEndpoint: "https://travel-app.logto.app/oidc/token",
    },
    tgChatRag: {
      baseUrl: "https://tg-rag.example.com/",
      bearerToken: "bearer-token",

      timeoutMs: 15000,
    },
    portal: {
      sessionSecret: "test-portal-session-secret",
      logtoAppId: "test-portal-app-id",
      logtoAppSecret: "test-portal-app-secret",
      logtoM2mAppId: "test-m2m-app-id",
      logtoM2mAppSecret: "test-m2m-app-secret",
      logtoManagementApiResource: "https://test-mgmt-api.example.com",
      mcpUserRoleId: "test-mcp-user-role-id",
      sessionTtlSeconds: 604800,
    },
    proxy: {
      baseUrl: "https://proxy.example.com/",
      secret: "test-proxy-secret",
      voyageApiKey: "test-voyage-key",
      spiderApiKey: "test-spider-key",
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
function createDependencies(overrides?: DependencyOverrides): AdminRouteDependencies {
  // START_BLOCK_BUILD_ADMIN_UI_DEPENDENCIES_FOR_ROUTE_TESTS_M_ADMIN_UI_TEST_003
  const requireAdminSession =
    overrides?.requireAdminSession ??
    (() => {
      return { isAuthenticated: true } as const;
    });
  const authenticateAdmin =
    overrides?.authenticateAdmin ??
    (() => {
      return { isAuthenticated: false, sessionCookie: null, reason: "INVALID_LOGIN_TOKEN" } as const;
    });
  const clearAdminSession = overrides?.clearAdminSession ?? (() => "admin_session=; Path=/; Max-Age=0");

  return {
    config: createTestConfig(),
    logger: createNoopLogger(),
    authenticateAdmin,
    requireAdminSession,
    clearAdminSession,
  };
  // END_BLOCK_BUILD_ADMIN_UI_DEPENDENCIES_FOR_ROUTE_TESTS_M_ADMIN_UI_TEST_003
}

// START_CONTRACT: createLoginPostRequest
//   PURPOSE: Build deterministic URL-encoded /admin/login POST request payload.
//   INPUTS: { token: string - Login token form value }
//   OUTPUTS: { Request - POST request targeting /admin/login with form payload }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-UI]
// END_CONTRACT: createLoginPostRequest
function createLoginPostRequest(token: string): Request {
  // START_BLOCK_BUILD_ADMIN_LOGIN_POST_REQUEST_M_ADMIN_UI_TEST_004
  return new Request("http://localhost/admin/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({ token }).toString(),
  });
  // END_BLOCK_BUILD_ADMIN_LOGIN_POST_REQUEST_M_ADMIN_UI_TEST_004
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

  it("redirects unauthenticated /admin/ops requests to /admin/login", async () => {
    const clearCookie = "admin_session=; Path=/; Max-Age=0";
    const response = await handleAdminRequest(
      new Request("http://localhost/admin/ops", { method: "GET" }),
      createDependencies({
        requireAdminSession: () => ({
          isAuthenticated: false,
          reason: "MISSING_SESSION_COOKIE",
          status: 302,
          location: "/admin/login",
          setCookie: clearCookie,
        }),
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin/login");
    expect(response.headers.get("set-cookie")).toBe(clearCookie);
  });

  it("redirects authenticated /admin/login GET requests to /admin/ops", async () => {
    const response = await handleAdminRequest(
      new Request("http://localhost/admin/login", { method: "GET" }),
      createDependencies({
        requireAdminSession: () => ({ isAuthenticated: true }),
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(ADMIN_OPS_PATH);
  });

  it("redirects successful /admin/login POST requests to /admin/ops with session cookie", async () => {
    const sessionCookie = "admin_session=signed-cookie; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax";
    const response = await handleAdminRequest(
      createLoginPostRequest("root-secret"),
      createDependencies({
        authenticateAdmin: () => ({
          isAuthenticated: true,
          sessionCookie,
        }),
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(ADMIN_OPS_PATH);
    expect(response.headers.get("set-cookie")).toBe(sessionCookie);
  });

  it("returns 401 /admin/login POST failure with cleared session cookie and invalid token message", async () => {
    const clearCookie = "admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax";
    const response = await handleAdminRequest(
      createLoginPostRequest("invalid-token"),
      createDependencies({
        authenticateAdmin: () => ({
          isAuthenticated: false,
          sessionCookie: null,
          reason: "INVALID_LOGIN_TOKEN",
        }),
        clearAdminSession: () => clearCookie,
      }),
    );
    const html = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBe(clearCookie);
    expect(html).toContain("Admin Login");
    expect(html).toContain("Invalid root admin token.");
  });

  it("returns 401 /admin/login POST bearer-format failure with guidance message", async () => {
    const response = await handleAdminRequest(
      createLoginPostRequest("Bearer ignored"),
      createDependencies({
        authenticateAdmin: () => ({
          isAuthenticated: false,
          sessionCookie: null,
          reason: "DISALLOWED_MCP_BEARER_FORMAT",
        }),
      }),
    );
    const html = await response.text();

    expect(response.status).toBe(401);
    expect(html).toContain("Use the root admin token value directly (without Bearer prefix).");
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
    expect(html).toContain("https://travel-app.logto.app/");
    expect(html).toContain("travel-client-id");
    expect(html).toContain("[REDACTED]");
    expect(html).not.toContain("travel-client-secret");
    expect(html).toContain("https://travel-app.logto.app/oidc/auth");
    expect(html).toContain("https://travel-app.logto.app/oidc/token");
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

  it("returns default 404 response for removed /admin/api-keys routes", async () => {
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

    expect(listResponse.status).toBe(404);
    expect(childResponse.status).toBe(404);
    expect(listHtml).toContain("<h1>Not Found</h1>");
    expect(childHtml).toContain("<h1>Not Found</h1>");
  });
});
