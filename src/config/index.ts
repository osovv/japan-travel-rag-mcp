// FILE: src/config/index.ts
// VERSION: 1.2.0
// START_MODULE_CONTRACT
//   PURPOSE: Load and validate runtime configuration for MCP proxy transport, admin auth, OAuth resource metadata, and OAuth token validation behavior.
//   SCOPE: Parse and validate runtime env values for server port, tg-chat-rag upstream settings, root auth, database URL, public resource URL, and OAuth issuer/audience/scopes/JWKS timing controls.
//   DEPENDS: none
//   LINKS: M-CONFIG, M-OAUTH-DISCOVERY, M-OAUTH-JWKS, M-OAUTH-TOKEN-VALIDATOR
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   AppConfig - Typed runtime configuration for MCP, tg-chat-rag, root auth, database, public URL, and OAuth settings.
//   ConfigValidationError - Typed validation error carrying CONFIG_VALIDATION_ERROR code.
//   loadConfig - Validate process environment and return AppConfig.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.2.0 - Added PUBLIC_URL and OAuth env parsing/validation with typed oauth config defaults for scopes, JWKS cache/timeout, and clock skew.
// END_CHANGE_SUMMARY

export type AppConfig = {
  port: number;
  publicUrl: string;
  rootAuthToken: string;
  databaseUrl: string;
  oauth: {
    issuer: string;
    audience: string;
    requiredScopes: string[];
    jwksCacheTtlMs: number;
    jwksTimeoutMs: number;
    clockSkewSec: number;
  };
  tgChatRag: {
    baseUrl: string;
    bearerToken: string;
    chatIds: string[];
    timeoutMs: number;
  };
};

export class ConfigValidationError extends Error {
  public readonly code = "CONFIG_VALIDATION_ERROR" as const;
  public readonly details: string[];

  public constructor(details: string[]) {
    super(`Configuration validation failed: ${details.join("; ")}`);
    this.name = "ConfigValidationError";
    this.details = details;
  }
}

// START_CONTRACT: loadConfig
//   PURPOSE: Validate runtime environment values and return typed AppConfig.
//   INPUTS: { env: NodeJS.ProcessEnv | undefined - Source env map, defaults to process.env }
//   OUTPUTS: { AppConfig - Typed config with validated MCP proxy, tg-chat-rag, root auth, database, and OAuth settings }
//   SIDE_EFFECTS: [Throws ConfigValidationError with code CONFIG_VALIDATION_ERROR when validation fails]
//   LINKS: [M-CONFIG, M-OAUTH-DISCOVERY, M-OAUTH-JWKS, M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: loadConfig
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const errors: string[] = [];

  // START_BLOCK_NORMALIZE_ENV_INPUT_VALUES_M_CONFIG_001
  const baseUrlRaw = (env.TG_CHAT_RAG_BASE_URL ?? "").trim();
  const bearerToken = (env.TG_CHAT_RAG_BEARER_TOKEN ?? "").trim();
  const chatIdsRaw = (env.TG_CHAT_RAG_CHAT_IDS ?? "").trim();
  const portRaw = (env.PORT ?? "").trim();
  const timeoutRaw = (env.TG_CHAT_RAG_TIMEOUT_MS ?? "").trim();
  const rootAuthToken = (env.ROOT_AUTH_TOKEN ?? "").trim();
  const databaseUrlRaw = (env.DATABASE_URL ?? "").trim();
  const publicUrlRaw = (env.PUBLIC_URL ?? "").trim();
  const oauthIssuerRaw = (env.OAUTH_ISSUER ?? "").trim();
  const oauthAudienceRaw = (env.OAUTH_AUDIENCE ?? "").trim();
  const oauthRequiredScopesRaw = (env.OAUTH_REQUIRED_SCOPES ?? "").trim();
  const oauthJwksCacheTtlRaw = (env.OAUTH_JWKS_CACHE_TTL_MS ?? "").trim();
  const oauthJwksTimeoutRaw = (env.OAUTH_JWKS_TIMEOUT_MS ?? "").trim();
  const oauthClockSkewRaw = (env.OAUTH_CLOCK_SKEW_SEC ?? "").trim();
  // END_BLOCK_NORMALIZE_ENV_INPUT_VALUES_M_CONFIG_001

  // START_BLOCK_VALIDATE_TG_CHAT_RAG_BASE_URL_M_CONFIG_002
  let normalizedBaseUrl = "";
  if (!baseUrlRaw) {
    errors.push("TG_CHAT_RAG_BASE_URL is required.");
  } else {
    try {
      normalizedBaseUrl = new URL(baseUrlRaw).toString();
    } catch {
      errors.push("TG_CHAT_RAG_BASE_URL must be a valid URL.");
    }
  }
  // END_BLOCK_VALIDATE_TG_CHAT_RAG_BASE_URL_M_CONFIG_002

  // START_BLOCK_VALIDATE_TG_CHAT_RAG_BEARER_TOKEN_M_CONFIG_003
  if (!bearerToken) {
    errors.push("TG_CHAT_RAG_BEARER_TOKEN is required.");
  }
  // END_BLOCK_VALIDATE_TG_CHAT_RAG_BEARER_TOKEN_M_CONFIG_003

  // START_BLOCK_VALIDATE_ROOT_AUTH_TOKEN_M_CONFIG_009
  if (!rootAuthToken) {
    errors.push("ROOT_AUTH_TOKEN is required.");
  }
  // END_BLOCK_VALIDATE_ROOT_AUTH_TOKEN_M_CONFIG_009

  // START_BLOCK_PARSE_TG_CHAT_RAG_CHAT_IDS_M_CONFIG_004
  let chatIds: string[] = [];
  if (!chatIdsRaw) {
    errors.push("TG_CHAT_RAG_CHAT_IDS is required.");
  } else {
    const uniqueChatIds = new Set<string>();
    for (const value of chatIdsRaw.split(",")) {
      const trimmedValue = value.trim();
      if (trimmedValue) {
        uniqueChatIds.add(trimmedValue);
      }
    }
    chatIds = [...uniqueChatIds];
    if (chatIds.length === 0) {
      errors.push("TG_CHAT_RAG_CHAT_IDS must contain at least one non-empty value.");
    }
  }
  // END_BLOCK_PARSE_TG_CHAT_RAG_CHAT_IDS_M_CONFIG_004

  // START_BLOCK_PARSE_PORT_M_CONFIG_005
  let port = 3000;
  if (portRaw) {
    const parsedPort = Number.parseInt(portRaw, 10);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      errors.push("PORT must be an integer between 1 and 65535.");
    } else {
      port = parsedPort;
    }
  }
  // END_BLOCK_PARSE_PORT_M_CONFIG_005

  // START_BLOCK_PARSE_TG_CHAT_RAG_TIMEOUT_MS_M_CONFIG_006
  let timeoutMs = 15000;
  if (timeoutRaw) {
    const parsedTimeout = Number.parseInt(timeoutRaw, 10);
    if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1000 || parsedTimeout > 120000) {
      errors.push("TG_CHAT_RAG_TIMEOUT_MS must be an integer between 1000 and 120000.");
    } else {
      timeoutMs = parsedTimeout;
    }
  }
  // END_BLOCK_PARSE_TG_CHAT_RAG_TIMEOUT_MS_M_CONFIG_006

  // START_BLOCK_VALIDATE_DATABASE_URL_M_CONFIG_010
  let databaseUrl = "";
  if (!databaseUrlRaw) {
    errors.push("DATABASE_URL is required.");
  } else {
    try {
      const parsedDatabaseUrl = new URL(databaseUrlRaw);
      if (parsedDatabaseUrl.protocol !== "postgres:" && parsedDatabaseUrl.protocol !== "postgresql:") {
        errors.push("DATABASE_URL must use postgres:// or postgresql:// scheme.");
      } else {
        databaseUrl = parsedDatabaseUrl.toString();
      }
    } catch {
      errors.push("DATABASE_URL must be a valid URL.");
    }
  }
  // END_BLOCK_VALIDATE_DATABASE_URL_M_CONFIG_010

  // START_BLOCK_VALIDATE_PUBLIC_URL_M_CONFIG_011
  let publicUrl = "";
  if (!publicUrlRaw) {
    errors.push("PUBLIC_URL is required.");
  } else {
    try {
      publicUrl = new URL(publicUrlRaw).toString();
    } catch {
      errors.push("PUBLIC_URL must be a valid URL.");
    }
  }
  // END_BLOCK_VALIDATE_PUBLIC_URL_M_CONFIG_011

  // START_BLOCK_VALIDATE_OAUTH_ISSUER_M_CONFIG_012
  let oauthIssuer = "";
  if (!oauthIssuerRaw) {
    errors.push("OAUTH_ISSUER is required.");
  } else {
    try {
      oauthIssuer = new URL(oauthIssuerRaw).toString();
    } catch {
      errors.push("OAUTH_ISSUER must be a valid URL.");
    }
  }
  // END_BLOCK_VALIDATE_OAUTH_ISSUER_M_CONFIG_012

  // START_BLOCK_VALIDATE_OAUTH_AUDIENCE_M_CONFIG_013
  let oauthAudience = "";
  if (!oauthAudienceRaw) {
    errors.push("OAUTH_AUDIENCE is required.");
  } else {
    oauthAudience = oauthAudienceRaw;
  }
  // END_BLOCK_VALIDATE_OAUTH_AUDIENCE_M_CONFIG_013

  // START_BLOCK_PARSE_OAUTH_REQUIRED_SCOPES_M_CONFIG_014
  let oauthRequiredScopes: string[] = ["mcp:access"];
  if (oauthRequiredScopesRaw) {
    const uniqueScopes = new Set<string>();
    for (const value of oauthRequiredScopesRaw.split(",")) {
      const trimmedValue = value.trim();
      if (trimmedValue) {
        uniqueScopes.add(trimmedValue);
      }
    }
    oauthRequiredScopes = [...uniqueScopes];
    if (oauthRequiredScopes.length === 0) {
      errors.push("OAUTH_REQUIRED_SCOPES must contain at least one non-empty value.");
    }
  }
  // END_BLOCK_PARSE_OAUTH_REQUIRED_SCOPES_M_CONFIG_014

  // START_BLOCK_PARSE_OAUTH_JWKS_CACHE_TTL_MS_M_CONFIG_015
  let oauthJwksCacheTtlMs = 300000;
  if (oauthJwksCacheTtlRaw) {
    const parsedTtl = Number.parseInt(oauthJwksCacheTtlRaw, 10);
    if (!Number.isInteger(parsedTtl) || parsedTtl < 1000 || parsedTtl > 86400000) {
      errors.push("OAUTH_JWKS_CACHE_TTL_MS must be an integer between 1000 and 86400000.");
    } else {
      oauthJwksCacheTtlMs = parsedTtl;
    }
  }
  // END_BLOCK_PARSE_OAUTH_JWKS_CACHE_TTL_MS_M_CONFIG_015

  // START_BLOCK_PARSE_OAUTH_JWKS_TIMEOUT_MS_M_CONFIG_016
  let oauthJwksTimeoutMs = 5000;
  if (oauthJwksTimeoutRaw) {
    const parsedTimeout = Number.parseInt(oauthJwksTimeoutRaw, 10);
    if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1000 || parsedTimeout > 120000) {
      errors.push("OAUTH_JWKS_TIMEOUT_MS must be an integer between 1000 and 120000.");
    } else {
      oauthJwksTimeoutMs = parsedTimeout;
    }
  }
  // END_BLOCK_PARSE_OAUTH_JWKS_TIMEOUT_MS_M_CONFIG_016

  // START_BLOCK_PARSE_OAUTH_CLOCK_SKEW_SEC_M_CONFIG_017
  let oauthClockSkewSec = 60;
  if (oauthClockSkewRaw) {
    const parsedClockSkew = Number.parseInt(oauthClockSkewRaw, 10);
    if (!Number.isInteger(parsedClockSkew) || parsedClockSkew < 0 || parsedClockSkew > 300) {
      errors.push("OAUTH_CLOCK_SKEW_SEC must be an integer between 0 and 300.");
    } else {
      oauthClockSkewSec = parsedClockSkew;
    }
  }
  // END_BLOCK_PARSE_OAUTH_CLOCK_SKEW_SEC_M_CONFIG_017

  // START_BLOCK_THROW_CONFIG_VALIDATION_ERROR_M_CONFIG_007
  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }
  // END_BLOCK_THROW_CONFIG_VALIDATION_ERROR_M_CONFIG_007

  // START_BLOCK_BUILD_APP_CONFIG_RESULT_M_CONFIG_008
  return {
    port,
    publicUrl,
    rootAuthToken,
    databaseUrl,
    oauth: {
      issuer: oauthIssuer,
      audience: oauthAudience,
      requiredScopes: oauthRequiredScopes,
      jwksCacheTtlMs: oauthJwksCacheTtlMs,
      jwksTimeoutMs: oauthJwksTimeoutMs,
      clockSkewSec: oauthClockSkewSec,
    },
    tgChatRag: {
      baseUrl: normalizedBaseUrl,
      bearerToken,
      chatIds,
      timeoutMs,
    },
  };
  // END_BLOCK_BUILD_APP_CONFIG_RESULT_M_CONFIG_008
}
