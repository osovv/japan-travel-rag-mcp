// FILE: src/auth/oauth-proxy.test.ts
// VERSION: 1.3.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify OAuth proxy initialization exposes exact single-scope policy in authorization metadata.
//   SCOPE: Build deterministic logger/config fixtures, call createOauthProxy, and assert authorizationServerMetadata.scopesSupported equals ["mcp:access"].
//   DEPENDS: M-AUTH-PROXY, M-CONFIG, M-LOGGER
//   LINKS: M-AUTH-PROXY
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   EXPECTED_SCOPES_SUPPORTED - Canonical single-scope policy expected from oauth-proxy metadata.
//   createNoopLogger - Build deterministic inert logger dependency for oauth-proxy tests.
//   createMockAppConfig - Build deterministic AppConfig fixture with required Logto/public URL values.
//   OauthProxyTests - Focused coverage for exact scopesSupported propagation into authorization metadata.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.3.0 - Updated oauth-proxy metadata assertion to enforce exact scopesSupported policy ["mcp:access"].
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import { createOauthProxy } from "./oauth-proxy";

const EXPECTED_SCOPES_SUPPORTED = ["mcp:access"];

// START_CONTRACT: createNoopLogger
//   PURPOSE: Provide deterministic no-op Logger dependency for unit tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - Logger implementation with inert methods and child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER, M-AUTH-PROXY]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_M_AUTH_OAUTH_PROXY_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };

  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_M_AUTH_OAUTH_PROXY_TEST_001
}

// START_CONTRACT: createMockAppConfig
//   PURPOSE: Build deterministic AppConfig fixture with required oauth-proxy dependencies.
//   INPUTS: {}
//   OUTPUTS: { AppConfig - Stable config fixture }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG, M-AUTH-PROXY]
// END_CONTRACT: createMockAppConfig
function createMockAppConfig(): AppConfig {
  // START_BLOCK_BUILD_MOCK_APP_CONFIG_M_AUTH_OAUTH_PROXY_TEST_002
  return {
    port: 3000,
    publicUrl: "https://travel.example.com/",
    rootAuthToken: "root-auth-token-oauth-proxy-test",
    tgChatRag: {
      baseUrl: "https://tg-chat-rag.example.com/",
      bearerToken: "tg-chat-rag-token-oauth-proxy-test",
      chatIds: ["jp-chat-001"],
      timeoutMs: 15000,
    },
    logto: {
      tenantUrl: "https://issuer.example.com/",
      clientId: "logto-client-id-oauth-proxy-test",
      clientSecret: "logto-client-secret-oauth-proxy-test",
      oidcAuthEndpoint: "https://issuer.example.com/oidc/auth",
      oidcTokenEndpoint: "https://issuer.example.com/oidc/token",
    },
    oauthSessionSecret: "test-oauth-session-secret-at-least-32-characters",
    portal: {
      sessionSecret: "test-portal-session-secret",
      logtoAppId: "test-portal-app-id",
      logtoAppSecret: "test-portal-app-secret",
      sessionTtlSeconds: 604800,
    },
  };
  // END_BLOCK_BUILD_MOCK_APP_CONFIG_M_AUTH_OAUTH_PROXY_TEST_002
}

describe("M-AUTH-PROXY createOauthProxy", () => {
  it('returns authorization metadata with exact scopesSupported ["mcp:access"]', () => {
    const oauthProxyContext = createOauthProxy({
      config: createMockAppConfig(),
      logger: createNoopLogger(),
      db: {} as any,
    });

    expect(oauthProxyContext.authorizationServerMetadata.scopesSupported).toEqual(EXPECTED_SCOPES_SUPPORTED);
  });
});
