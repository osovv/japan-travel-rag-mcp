// FILE: src/config/index.test.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate M-CONFIG runtime parsing for PUBLIC_URL and OAuth environment settings after Phase-7 removal of JWKS/clock-skew env controls.
//   SCOPE: Assert defaults for required OAuth/public settings, CSV scope parsing behavior, strict CONFIG_VALIDATION_ERROR outcomes for invalid OAuth/public inputs, and ignore behavior for removed JWKS/clock-skew vars.
//   DEPENDS: M-CONFIG
//   LINKS: M-CONFIG, M-OAUTH-DISCOVERY, M-OAUTH-JWKS, M-OAUTH-TOKEN-VALIDATOR
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createBaseEnv - Build a valid baseline env map for config tests with optional overrides.
//   captureConfigValidationError - Execute loadConfig and return ConfigValidationError for assertions.
//   ConfigParsingTests - Focused tests for OAuth and public URL parsing/validation behavior.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Removed JWKS/clock-skew assertions and added coverage that legacy JWKS/clock-skew env vars are ignored by loadConfig.
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
    DATABASE_URL: "postgresql://user:pass@localhost:5432/japan_travel",
    PUBLIC_URL: "https://travel.example.com",
    OAUTH_ISSUER: "https://issuer.example.com",
    OAUTH_AUDIENCE: "travel-mcp",
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

describe("M-CONFIG OAuth/public settings", () => {
  it("applies defaults for optional OAuth settings", () => {
    const config = loadConfig(createBaseEnv());

    expect(config.publicUrl).toBe("https://travel.example.com/");
    expect(config.oauth.issuer).toBe("https://issuer.example.com/");
    expect(config.oauth.audience).toBe("travel-mcp");
    expect(config.oauth.requiredScopes).toEqual(["mcp:access"]);
    expect(config.tgChatRag.chatIds).toEqual(["chat-1", "chat-2"]);
  });

  it("parses custom OAuth scope CSV", () => {
    const config = loadConfig(
      createBaseEnv({
        OAUTH_REQUIRED_SCOPES: "mcp:access, profile:read, mcp:access",
      }),
    );

    expect(config.oauth.requiredScopes).toEqual(["mcp:access", "profile:read"]);
  });

  it("ignores removed OAuth JWKS/clock-skew env vars", () => {
    const config = loadConfig(
      createBaseEnv({
        OAUTH_JWKS_CACHE_TTL_MS: "1",
        OAUTH_JWKS_TIMEOUT_MS: "0",
        OAUTH_CLOCK_SKEW_SEC: "-999",
      }),
    );

    expect(config.oauth.requiredScopes).toEqual(["mcp:access"]);
    expect(config.oauth.issuer).toBe("https://issuer.example.com/");
    expect(config.oauth.audience).toBe("travel-mcp");
  });

  it("throws CONFIG_VALIDATION_ERROR for invalid public URL and OAuth values", () => {
    const error = captureConfigValidationError(
      createBaseEnv({
        PUBLIC_URL: "not-a-url",
        OAUTH_ISSUER: "issuer-without-scheme",
        OAUTH_AUDIENCE: "   ",
        OAUTH_REQUIRED_SCOPES: " , , ",
      }),
    );

    expect(error.code).toBe("CONFIG_VALIDATION_ERROR");
    expect(error.details).toContain("PUBLIC_URL must be a valid URL.");
    expect(error.details).toContain("OAUTH_ISSUER must be a valid URL.");
    expect(error.details).toContain("OAUTH_AUDIENCE is required.");
    expect(error.details).toContain("OAUTH_REQUIRED_SCOPES must contain at least one non-empty value.");
  });
});
