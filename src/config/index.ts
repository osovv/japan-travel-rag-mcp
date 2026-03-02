// FILE: src/config/index.ts
// VERSION: 1.12.0
// START_MODULE_CONTRACT
//   PURPOSE: Load and validate runtime configuration for FastMCP OAuth Proxy, tg-chat-rag proxy calls, admin root auth, portal session/identity settings, database connection, and unified proxy for Spider/Voyage API access.
//   SCOPE: Parse required env values for tg-chat-rag integration, root-token admin auth, public base URL, Logto tenant/client credentials with derived OIDC endpoints, portal session/identity config, M2M provisioning credentials for self-serve onboarding, DATABASE_URL for PostgreSQL connectivity, and proxy settings.
//   DEPENDS: none
//   LINKS: M-CONFIG, M-TG-CHAT-RAG-CLIENT, M-AUTH-PROXY, M-ADMIN-AUTH, M-PORTAL-AUTH, M-PORTAL-IDENTITY, M-DB
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   AppConfig - Typed runtime configuration for tg-chat-rag, admin root auth, public URL, Logto OAuth proxy, portal session/identity settings, M2M provisioning credentials, database connection, and proxy settings for Spider/Voyage API access.
//   ConfigValidationError - Typed validation error carrying CONFIG_VALIDATION_ERROR code.
//   loadConfig - Validate process environment and return AppConfig.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.12.0 - Add DEV_MODE support: when true, external service env vars (Logto, proxy, Spider, Voyage, tg-chat-rag) get placeholder defaults so the app starts with only DATABASE_URL and ROOT_AUTH_TOKEN.
//   PREVIOUS: v1.11.0 - Removed PLATFORM_NAME env var (hardcoded in portal); removed TG_CHAT_RAG_CHAT_IDS from config (chat_ids live in country_settings only).
// END_CHANGE_SUMMARY

export type AppConfig = {
  devMode: boolean;
  port: number;
  publicUrl: string;
  rootAuthToken: string;
  databaseUrl: string;
  oauthSessionSecret: string;
  tgChatRag: {
    baseUrl: string;
    bearerToken: string;
    timeoutMs: number;
  };
  logto: {
    tenantUrl: string;
    clientId: string;
    clientSecret: string;
    oidcAuthEndpoint: string;
    oidcTokenEndpoint: string;
  };
  portal: {
    sessionSecret: string;
    logtoAppId: string;
    logtoAppSecret: string;
    logtoM2mAppId: string;
    logtoM2mAppSecret: string;
    logtoManagementApiResource: string;
    mcpUserRoleId: string;
    sessionTtlSeconds: number;
  };
  proxy: {
    baseUrl: string;
    secret: string;
    voyageApiKey: string;
    spiderApiKey: string;
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
//   OUTPUTS: { AppConfig - Typed config for tg-chat-rag integration, root auth, public URL, Logto OAuth proxy credentials/endpoints, portal session/identity settings, M2M provisioning credentials, database connection URL, and proxy settings for Spider/Voyage API access }
//   SIDE_EFFECTS: [Throws ConfigValidationError with code CONFIG_VALIDATION_ERROR when validation fails]
//   LINKS: [M-CONFIG, M-TG-CHAT-RAG-CLIENT, M-AUTH-PROXY, M-ADMIN-AUTH, M-PORTAL-AUTH, M-PORTAL-IDENTITY]
// END_CONTRACT: loadConfig
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const errors: string[] = [];
  const devMode = (env.DEV_MODE ?? "").trim().toLowerCase() === "true";

  // START_BLOCK_NORMALIZE_ENV_INPUT_VALUES_M_CONFIG_001
  const DEV_PLACEHOLDER_URL = "https://placeholder.dev.local";
  const DEV_PLACEHOLDER = "dev-placeholder";

  let baseUrlRaw = (env.TG_CHAT_RAG_BASE_URL ?? "").trim();
  let bearerToken = (env.TG_CHAT_RAG_BEARER_TOKEN ?? "").trim();
  const portRaw = (env.PORT ?? "").trim();
  const timeoutRaw = (env.TG_CHAT_RAG_TIMEOUT_MS ?? "").trim();
  const rootAuthToken = (env.ROOT_AUTH_TOKEN ?? "").trim();
  let publicUrlRaw = (env.PUBLIC_URL ?? "").trim();
  let logtoTenantUrlRaw = (env.LOGTO_TENANT_URL ?? "").trim();
  let logtoClientId = (env.LOGTO_CLIENT_ID ?? "").trim();
  let logtoClientSecret = (env.LOGTO_CLIENT_SECRET ?? "").trim();
  let portalSessionSecret = (env.PORTAL_SESSION_SECRET ?? "").trim();
  let portalLogtoAppId = (env.LOGTO_PORTAL_APP_ID ?? "").trim();
  let portalLogtoAppSecret = (env.LOGTO_PORTAL_APP_SECRET ?? "").trim();
  let portalLogtoM2mAppId = (env.LOGTO_M2M_APP_ID ?? "").trim();
  let portalLogtoM2mAppSecret = (env.LOGTO_M2M_APP_SECRET ?? "").trim();
  let portalLogtoManagementApiResource = (env.LOGTO_MANAGEMENT_API_RESOURCE ?? "").trim();
  let portalMcpUserRoleId = (env.LOGTO_MCP_USER_ROLE_ID ?? "").trim();
  const portalSessionTtlRaw = (env.PORTAL_SESSION_TTL_SECONDS ?? "").trim();
  const databaseUrlRaw = (env.DATABASE_URL ?? "").trim();
  let proxyBaseUrlRaw = (env.PROXY_BASE_URL ?? "").trim();
  let proxySecret = (env.PROXY_SECRET ?? "").trim();
  let voyageApiKey = (env.VOYAGE_API_KEY ?? "").trim();
  let spiderApiKey = (env.SPIDER_API_KEY ?? "").trim();
  let oauthSessionSecret = (env.OAUTH_SESSION_SECRET ?? "").trim();

  // In DEV_MODE, fill missing external service values with placeholders
  if (devMode) {
    if (!baseUrlRaw) baseUrlRaw = "http://localhost:8787";
    if (!bearerToken) bearerToken = DEV_PLACEHOLDER;
    if (!publicUrlRaw) publicUrlRaw = `http://localhost:${portRaw || "3000"}`;
    if (!logtoTenantUrlRaw) logtoTenantUrlRaw = DEV_PLACEHOLDER_URL;
    if (!logtoClientId) logtoClientId = DEV_PLACEHOLDER;
    if (!logtoClientSecret) logtoClientSecret = DEV_PLACEHOLDER;
    if (!portalSessionSecret) portalSessionSecret = DEV_PLACEHOLDER;
    if (!portalLogtoAppId) portalLogtoAppId = DEV_PLACEHOLDER;
    if (!portalLogtoAppSecret) portalLogtoAppSecret = DEV_PLACEHOLDER;
    if (!portalLogtoM2mAppId) portalLogtoM2mAppId = DEV_PLACEHOLDER;
    if (!portalLogtoM2mAppSecret) portalLogtoM2mAppSecret = DEV_PLACEHOLDER;
    if (!portalLogtoManagementApiResource) portalLogtoManagementApiResource = DEV_PLACEHOLDER_URL;
    if (!portalMcpUserRoleId) portalMcpUserRoleId = DEV_PLACEHOLDER;
    if (!proxyBaseUrlRaw) proxyBaseUrlRaw = DEV_PLACEHOLDER_URL;
    if (!proxySecret) proxySecret = DEV_PLACEHOLDER;
    if (!voyageApiKey) voyageApiKey = DEV_PLACEHOLDER;
    if (!spiderApiKey) spiderApiKey = DEV_PLACEHOLDER;
    if (!oauthSessionSecret) oauthSessionSecret = "dev-oauth-session-secret-placeholder-32chars-min";
  }
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

  // START_BLOCK_VALIDATE_PUBLIC_URL_M_CONFIG_010
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
  // END_BLOCK_VALIDATE_PUBLIC_URL_M_CONFIG_010

  // START_BLOCK_VALIDATE_LOGTO_TENANT_URL_M_CONFIG_011
  let logtoTenantUrl = "";
  if (!logtoTenantUrlRaw) {
    errors.push("LOGTO_TENANT_URL is required.");
  } else {
    try {
      logtoTenantUrl = new URL(logtoTenantUrlRaw).toString();
    } catch {
      errors.push("LOGTO_TENANT_URL must be a valid URL.");
    }
  }
  // END_BLOCK_VALIDATE_LOGTO_TENANT_URL_M_CONFIG_011

  // START_BLOCK_VALIDATE_LOGTO_CLIENT_CREDENTIALS_M_CONFIG_012
  if (!logtoClientId) {
    errors.push("LOGTO_CLIENT_ID is required.");
  }
  if (!logtoClientSecret) {
    errors.push("LOGTO_CLIENT_SECRET is required.");
  }
  // END_BLOCK_VALIDATE_LOGTO_CLIENT_CREDENTIALS_M_CONFIG_012

  // START_BLOCK_DERIVE_LOGTO_OIDC_ENDPOINTS_M_CONFIG_013
  let oidcAuthEndpoint = "";
  let oidcTokenEndpoint = "";
  if (logtoTenantUrl) {
    const tenantBaseUrl = logtoTenantUrl.replace(/\/+$/, "");
    oidcAuthEndpoint = `${tenantBaseUrl}/oidc/auth`;
    oidcTokenEndpoint = `${tenantBaseUrl}/oidc/token`;
  }
  // END_BLOCK_DERIVE_LOGTO_OIDC_ENDPOINTS_M_CONFIG_013

  // START_BLOCK_VALIDATE_PORTAL_SESSION_SECRET_M_CONFIG_014
  if (!portalSessionSecret) {
    errors.push("PORTAL_SESSION_SECRET is required.");
  }
  // END_BLOCK_VALIDATE_PORTAL_SESSION_SECRET_M_CONFIG_014

  // START_BLOCK_VALIDATE_PORTAL_LOGTO_APP_CREDENTIALS_M_CONFIG_015
  if (!portalLogtoAppId) {
    errors.push("LOGTO_PORTAL_APP_ID is required.");
  }
  if (!portalLogtoAppSecret) {
    errors.push("LOGTO_PORTAL_APP_SECRET is required.");
  }
  // END_BLOCK_VALIDATE_PORTAL_LOGTO_APP_CREDENTIALS_M_CONFIG_015

  // START_BLOCK_VALIDATE_PORTAL_M2M_CREDENTIALS_M_CONFIG_017
  if (!portalLogtoM2mAppId) {
    errors.push("LOGTO_M2M_APP_ID is required.");
  }
  if (!portalLogtoM2mAppSecret) {
    errors.push("LOGTO_M2M_APP_SECRET is required.");
  }
  if (!portalLogtoManagementApiResource) {
    errors.push("LOGTO_MANAGEMENT_API_RESOURCE is required.");
  }
  // END_BLOCK_VALIDATE_PORTAL_M2M_CREDENTIALS_M_CONFIG_017

  // START_BLOCK_VALIDATE_MCP_USER_ROLE_ID_M_CONFIG_018
  if (!portalMcpUserRoleId) {
    errors.push("LOGTO_MCP_USER_ROLE_ID is required.");
  }
  // END_BLOCK_VALIDATE_MCP_USER_ROLE_ID_M_CONFIG_018

  // START_BLOCK_VALIDATE_DATABASE_URL_M_CONFIG_019
  if (!databaseUrlRaw) {
    errors.push("DATABASE_URL is required.");
  }
  // END_BLOCK_VALIDATE_DATABASE_URL_M_CONFIG_019

  // START_BLOCK_VALIDATE_PROXY_BASE_URL_M_CONFIG_020
  let proxyBaseUrl = "";
  if (!proxyBaseUrlRaw) {
    errors.push("PROXY_BASE_URL is required.");
  } else {
    try {
      proxyBaseUrl = new URL(proxyBaseUrlRaw).toString();
    } catch {
      errors.push("PROXY_BASE_URL must be a valid URL.");
    }
  }
  // END_BLOCK_VALIDATE_PROXY_BASE_URL_M_CONFIG_020

  // START_BLOCK_VALIDATE_PROXY_SECRET_M_CONFIG_021
  if (!proxySecret) {
    errors.push("PROXY_SECRET is required.");
  }
  // END_BLOCK_VALIDATE_PROXY_SECRET_M_CONFIG_021

  // START_BLOCK_VALIDATE_VOYAGE_API_KEY_M_CONFIG_022
  if (!voyageApiKey) {
    errors.push("VOYAGE_API_KEY is required.");
  }
  // END_BLOCK_VALIDATE_VOYAGE_API_KEY_M_CONFIG_022

  // START_BLOCK_VALIDATE_SPIDER_API_KEY_M_CONFIG_023
  if (!spiderApiKey) {
    errors.push("SPIDER_API_KEY is required.");
  }
  // END_BLOCK_VALIDATE_SPIDER_API_KEY_M_CONFIG_023

  // START_BLOCK_VALIDATE_OAUTH_SESSION_SECRET_M_CONFIG_024
  if (!oauthSessionSecret) {
    errors.push("OAUTH_SESSION_SECRET is required.");
  } else if (oauthSessionSecret.length < 32) {
    errors.push("OAUTH_SESSION_SECRET must be at least 32 characters.");
  }
  // END_BLOCK_VALIDATE_OAUTH_SESSION_SECRET_M_CONFIG_024

  // START_BLOCK_PARSE_PORTAL_SESSION_TTL_M_CONFIG_016
  let portalSessionTtlSeconds = 604800; // 7 days default
  if (portalSessionTtlRaw) {
    const parsedTtl = Number.parseInt(portalSessionTtlRaw, 10);
    if (!Number.isInteger(parsedTtl) || parsedTtl < 300 || parsedTtl > 2592000) {
      errors.push("PORTAL_SESSION_TTL_SECONDS must be an integer between 300 and 2592000.");
    } else {
      portalSessionTtlSeconds = parsedTtl;
    }
  }
  // END_BLOCK_PARSE_PORTAL_SESSION_TTL_M_CONFIG_016

  // START_BLOCK_THROW_CONFIG_VALIDATION_ERROR_M_CONFIG_007
  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }
  // END_BLOCK_THROW_CONFIG_VALIDATION_ERROR_M_CONFIG_007

  // START_BLOCK_BUILD_APP_CONFIG_RESULT_M_CONFIG_008
  return {
    devMode,
    port,
    publicUrl,
    rootAuthToken,
    databaseUrl: databaseUrlRaw,
    oauthSessionSecret,
    tgChatRag: {
      baseUrl: normalizedBaseUrl,
      bearerToken,
      timeoutMs,
    },
    logto: {
      tenantUrl: logtoTenantUrl,
      clientId: logtoClientId,
      clientSecret: logtoClientSecret,
      oidcAuthEndpoint,
      oidcTokenEndpoint,
    },
    portal: {
      sessionSecret: portalSessionSecret,
      logtoAppId: portalLogtoAppId,
      logtoAppSecret: portalLogtoAppSecret,
      logtoM2mAppId: portalLogtoM2mAppId,
      logtoM2mAppSecret: portalLogtoM2mAppSecret,
      logtoManagementApiResource: portalLogtoManagementApiResource,
      mcpUserRoleId: portalMcpUserRoleId,
      sessionTtlSeconds: portalSessionTtlSeconds,
    },
    proxy: {
      baseUrl: proxyBaseUrl,
      secret: proxySecret,
      voyageApiKey,
      spiderApiKey,
    },
  };
  // END_BLOCK_BUILD_APP_CONFIG_RESULT_M_CONFIG_008
}
