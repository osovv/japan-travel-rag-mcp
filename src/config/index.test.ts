// FILE: src/config/index.test.ts
// VERSION: 1.2.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate M-CONFIG runtime parsing for tg-chat-rag, admin root auth, public URL, and Logto OAuth proxy settings.
//   SCOPE: Assert required env validation, normalized URL parsing, derived OIDC endpoint construction, chat-id CSV behavior, and legacy env ignore behavior.
//   DEPENDS: M-CONFIG
//   LINKS: M-CONFIG-TEST, M-CONFIG
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createBaseEnv - Build a valid baseline env map for config tests with optional overrides.
//   captureConfigValidationError - Execute loadConfig and return ConfigValidationError for assertions.
//   ConfigParsingTests - Focused tests for Logto/public URL/tg-chat-rag parsing and validation behavior.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.4.0 - Extended tests for M2M provisioning credentials (LOGTO_M2M_APP_ID, LOGTO_M2M_APP_SECRET) and configurable role ID (LOGTO_MCP_USER_ROLE_ID).
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import { ConfigValidationError, loadConfig } from "./index";

type EnvOverrides = Record<string, string | undefined>;

// START_CONTRACT: createBaseEnv
//   PURPOSE: Build baseline valid env values and allow targeted overrides for focused config tests.
//   INPUTS: { overrides: EnvOverrides - Optional env key overrides }
//   OUTPUTS: { NodeJS.ProcessEnv - Env object accepted by loadConfig }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG]
// END_CONTRACT: createBaseEnv
function createBaseEnv(overrides: EnvOverrides = {}): NodeJS.ProcessEnv {
  // START_BLOCK_BUILD_BASE_ENV_FOR_CONFIG_TESTS_M_CONFIG_TEST_001
  return {
    PORT: "3001",
    TG_CHAT_RAG_BASE_URL: "https://tg-rag.internal.example.com",
    TG_CHAT_RAG_BEARER_TOKEN: "tg-token",
    TG_CHAT_RAG_CHAT_IDS: "chat-1,chat-2",
    TG_CHAT_RAG_TIMEOUT_MS: "15000",
    ROOT_AUTH_TOKEN: "root-secret",
    PUBLIC_URL: "https://travel.example.com",
    LOGTO_TENANT_URL: "https://tenant.logto.app",
    LOGTO_CLIENT_ID: "logto-client-id",
    LOGTO_CLIENT_SECRET: "logto-client-secret",
    PORTAL_SESSION_SECRET: "portal-session-secret-value",
    LOGTO_PORTAL_APP_ID: "portal-app-id",
    LOGTO_PORTAL_APP_SECRET: "portal-app-secret",
    LOGTO_M2M_APP_ID: "m2m-app-id",
    LOGTO_M2M_APP_SECRET: "m2m-app-secret",
    LOGTO_MCP_USER_ROLE_ID: "role-uuid-1234",
    ...overrides,
  };
  // END_BLOCK_BUILD_BASE_ENV_FOR_CONFIG_TESTS_M_CONFIG_TEST_001
}

// START_CONTRACT: captureConfigValidationError
//   PURPOSE: Run loadConfig and capture ConfigValidationError for detailed assertion of strict validation behavior.
//   INPUTS: { env: NodeJS.ProcessEnv - Environment object passed to loadConfig }
//   OUTPUTS: { ConfigValidationError - Captured typed validation error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CONFIG]
// END_CONTRACT: captureConfigValidationError
function captureConfigValidationError(env: NodeJS.ProcessEnv): ConfigValidationError {
  // START_BLOCK_CAPTURE_TYPED_CONFIG_VALIDATION_ERROR_M_CONFIG_TEST_002
  try {
    loadConfig(env);
  } catch (error: unknown) {
    if (error instanceof ConfigValidationError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected loadConfig to throw ConfigValidationError.");
  // END_BLOCK_CAPTURE_TYPED_CONFIG_VALIDATION_ERROR_M_CONFIG_TEST_002
}

describe("M-CONFIG runtime settings", () => {
  it("loads required env and derives OIDC endpoints", () => {
    const config = loadConfig(createBaseEnv());

    expect(config.publicUrl).toBe("https://travel.example.com/");
    expect(config.rootAuthToken).toBe("root-secret");
    expect(config.tgChatRag.chatIds).toEqual(["chat-1", "chat-2"]);
    expect(config.logto.tenantUrl).toBe("https://tenant.logto.app/");
    expect(config.logto.clientId).toBe("logto-client-id");
    expect(config.logto.clientSecret).toBe("logto-client-secret");
    expect(config.logto.oidcAuthEndpoint).toBe("https://tenant.logto.app/oidc/auth");
    expect(config.logto.oidcTokenEndpoint).toBe("https://tenant.logto.app/oidc/token");
    expect(config.portal.sessionSecret).toBe("portal-session-secret-value");
    expect(config.portal.logtoAppId).toBe("portal-app-id");
    expect(config.portal.logtoAppSecret).toBe("portal-app-secret");
    expect(config.portal.logtoM2mAppId).toBe("m2m-app-id");
    expect(config.portal.logtoM2mAppSecret).toBe("m2m-app-secret");
    expect(config.portal.mcpUserRoleId).toBe("role-uuid-1234");
    expect(config.portal.sessionTtlSeconds).toBe(604800);
  });

  it("parses custom port/timeout and deduplicates chat IDs", () => {
    const config = loadConfig(
      createBaseEnv({
        PORT: "8088",
        TG_CHAT_RAG_TIMEOUT_MS: "31000",
        TG_CHAT_RAG_CHAT_IDS: "chat-1, chat-2, chat-1, chat-3",
      }),
    );

    expect(config.port).toBe(8088);
    expect(config.tgChatRag.timeoutMs).toBe(31000);
    expect(config.tgChatRag.chatIds).toEqual(["chat-1", "chat-2", "chat-3"]);
  });

  it("ignores legacy DATABASE_URL and OAUTH_* env vars", () => {
    const config = loadConfig(
      createBaseEnv({
        DATABASE_URL: "not-a-postgres-url",
        OAUTH_ISSUER: "issuer-without-scheme",
        OAUTH_AUDIENCE: "",
        OAUTH_REQUIRED_SCOPES: " , , ",
      }),
    );

    expect(config.logto.tenantUrl).toBe("https://tenant.logto.app/");
    expect((config as Record<string, unknown>).oauth).toBeUndefined();
    expect((config as Record<string, unknown>).databaseUrl).toBeUndefined();
  });

  it("throws CONFIG_VALIDATION_ERROR for missing required env vars", () => {
    const error = captureConfigValidationError(
      createBaseEnv({
        TG_CHAT_RAG_BASE_URL: " ",
        TG_CHAT_RAG_BEARER_TOKEN: " ",
        TG_CHAT_RAG_CHAT_IDS: " ",
        ROOT_AUTH_TOKEN: " ",
        PUBLIC_URL: " ",
        LOGTO_TENANT_URL: " ",
        LOGTO_CLIENT_ID: " ",
        LOGTO_CLIENT_SECRET: " ",
        PORTAL_SESSION_SECRET: " ",
        LOGTO_PORTAL_APP_ID: " ",
        LOGTO_PORTAL_APP_SECRET: " ",
        LOGTO_M2M_APP_ID: " ",
        LOGTO_M2M_APP_SECRET: " ",
        LOGTO_MCP_USER_ROLE_ID: " ",
      }),
    );

    expect(error.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(error.details).toContain("TG_CHAT_RAG_BASE_URL is required.");
    expect(error.details).toContain("TG_CHAT_RAG_BEARER_TOKEN is required.");
    expect(error.details).toContain("TG_CHAT_RAG_CHAT_IDS is required.");
    expect(error.details).toContain("ROOT_AUTH_TOKEN is required.");
    expect(error.details).toContain("PUBLIC_URL is required.");
    expect(error.details).toContain("LOGTO_TENANT_URL is required.");
    expect(error.details).toContain("LOGTO_CLIENT_ID is required.");
    expect(error.details).toContain("LOGTO_CLIENT_SECRET is required.");
    expect(error.details).toContain("PORTAL_SESSION_SECRET is required.");
    expect(error.details).toContain("LOGTO_PORTAL_APP_ID is required.");
    expect(error.details).toContain("LOGTO_PORTAL_APP_SECRET is required.");
    expect(error.details).toContain("LOGTO_M2M_APP_ID is required.");
    expect(error.details).toContain("LOGTO_M2M_APP_SECRET is required.");
    expect(error.details).toContain("LOGTO_MCP_USER_ROLE_ID is required.");
  });

  it("throws CONFIG_VALIDATION_ERROR for invalid URL values", () => {
    const error = captureConfigValidationError(
      createBaseEnv({
        TG_CHAT_RAG_BASE_URL: "invalid-url",
        PUBLIC_URL: "also-invalid",
        LOGTO_TENANT_URL: "still-invalid",
      }),
    );

    expect(error.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(error.details).toContain("TG_CHAT_RAG_BASE_URL must be a valid URL.");
    expect(error.details).toContain("PUBLIC_URL must be a valid URL.");
    expect(error.details).toContain("LOGTO_TENANT_URL must be a valid URL.");
  });
});
