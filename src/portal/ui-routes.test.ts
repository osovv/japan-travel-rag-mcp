// FILE: src/portal/ui-routes.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate landing page rendering for the public route in plain-language onboarding flow.
//   SCOPE: Test `handleLandingRequest` output, required sections, and CTA placement.
//   DEPENDS: M-PORTAL-UI
//   LINKS: M-PORTAL-UI, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Logger stub used by landing route tests.
//   createLandingDeps - Build minimal portal UI dependencies for handleLandingRequest.
//   createTestConfig - Deterministic AppConfig fixture.
//   landingPage - Route-level tests for `/` landing page rendering.
// END_MODULE_MAP

import { describe, expect, it } from "bun:test";
import type { AppConfig } from "../config/index";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "../logger/index";
import type { UsageTracker } from "../usage/tracker";
import type { PortalIdentityClient } from "./identity-client";
import type { PortalUiDependencies } from "./ui-routes";
import { handleLandingRequest } from "./ui-routes";

// START_CONTRACT: createNoopLogger
//   PURPOSE: Build a logger stub that matches Logger interface for route tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - Logger with no-op methods and child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_FOR_LANDING_TESTS_M_PORTAL_UI_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_FOR_LANDING_TESTS_M_PORTAL_UI_TEST_001
}

// START_CONTRACT: createTestConfig
//   PURPOSE: Build a deterministic config fixture for handleLandingRequest tests.
//   INPUTS: {}
//   OUTPUTS: { AppConfig - Runtime config fixture with required fields }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG]
// END_CONTRACT: createTestConfig
function createTestConfig(): AppConfig {
  // START_BLOCK_BUILD_TEST_APP_CONFIG_FOR_LANDING_PAGE_TESTS_M_PORTAL_UI_TEST_002
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
  // END_BLOCK_BUILD_TEST_APP_CONFIG_FOR_LANDING_PAGE_TESTS_M_PORTAL_UI_TEST_002
}

// START_CONTRACT: createLandingDeps
//   PURPOSE: Build minimal dependencies for public landing route execution.
//   INPUTS: {}
//   OUTPUTS: { PortalUiDependencies - Route dependency object }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-UI]
// END_CONTRACT: createLandingDeps
function createLandingDeps(): PortalUiDependencies {
  // START_BLOCK_BUILD_LANDING_ROUTE_DEPS_FOR_TESTS_M_PORTAL_UI_TEST_003
  return {
    config: createTestConfig(),
    logger: createNoopLogger(),
    identityClient: {} as unknown as PortalIdentityClient,
    usageTracker: {} as unknown as UsageTracker,
    db: {} as unknown as NodePgDatabase,
  };
  // END_BLOCK_BUILD_LANDING_ROUTE_DEPS_FOR_TESTS_M_PORTAL_UI_TEST_003
}

describe("M-PORTAL-UI landing page", () => {
  it("renders the full explanatory landing content", async () => {
    const response = await handleLandingRequest(new Request("http://localhost/", { method: "GET" }), createLandingDeps());

    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain("Understand Japan faster with trusted travel context");
    expect(html).toContain("Travel advice is everywhere. Clarity is not.");
    expect(html).toContain("What you get");
    expect(html).toContain("How it works");
    expect(html).toContain("Who it's for");
    expect(html).toContain("Start with Japan");
    expect(html).toContain("Ready to explore?");
    expect(html).toContain("Connect and explore");
    expect(html).toContain("href=\"/portal\"");
    expect(html).toContain('href="#how-it-works"');
  });

  it("includes both hero and final CTA actions", async () => {
    const response = await handleLandingRequest(new Request("http://localhost/", { method: "GET" }), createLandingDeps());

    const html = await response.text();
    const ctaMatches = html.match(/href=\"\/portal\"/g);

    expect(ctaMatches).not.toBeNull();
    expect(ctaMatches?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toContain('id="how-it-works"');
    expect(html).toContain("Curated sources");
    expect(html).toContain("Better context");
  });
});
