// FILE: src/config/index.ts
// VERSION: 1.7.0
// START_MODULE_CONTRACT
//   PURPOSE: Load and validate runtime configuration for FastMCP OAuth Proxy, tg-chat-rag proxy calls, admin root auth, and portal session/identity settings.
//   SCOPE: Parse required env values for tg-chat-rag integration, root-token admin auth, public base URL, Logto tenant/client credentials with derived OIDC endpoints, portal session/identity config, and M2M provisioning credentials for self-serve onboarding.
//   DEPENDS: none
//   LINKS: M-CONFIG, M-TG-CHAT-RAG-CLIENT, M-AUTH-PROXY, M-ADMIN-AUTH, M-PORTAL-AUTH, M-PORTAL-IDENTITY
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   AppConfig - Typed runtime configuration for tg-chat-rag, admin root auth, public URL, Logto OAuth proxy, portal session/identity settings, and M2M provisioning credentials.
//   ConfigValidationError - Typed validation error carrying CONFIG_VALIDATION_ERROR code.
//   loadConfig - Validate process environment and return AppConfig.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.7.0 - Added M2M provisioning credentials (LOGTO_M2M_APP_ID, LOGTO_M2M_APP_SECRET) and configurable role ID (LOGTO_MCP_USER_ROLE_ID) to portal config for Logto Management API role assignment.
// END_CHANGE_SUMMARY

export type AppConfig = {
  port: number;
  publicUrl: string;
  rootAuthToken: string;
  tgChatRag: {
    baseUrl: string;
    bearerToken: string;
    chatIds: string[];
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
//   OUTPUTS: { AppConfig - Typed config for tg-chat-rag integration, root auth, public URL, Logto OAuth proxy credentials/endpoints, portal session/identity settings, and M2M provisioning credentials }
//   SIDE_EFFECTS: [Throws ConfigValidationError with code CONFIG_VALIDATION_ERROR when validation fails]
//   LINKS: [M-CONFIG, M-TG-CHAT-RAG-CLIENT, M-AUTH-PROXY, M-ADMIN-AUTH, M-PORTAL-AUTH, M-PORTAL-IDENTITY]
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
  const publicUrlRaw = (env.PUBLIC_URL ?? "").trim();
  const logtoTenantUrlRaw = (env.LOGTO_TENANT_URL ?? "").trim();
  const logtoClientId = (env.LOGTO_CLIENT_ID ?? "").trim();
  const logtoClientSecret = (env.LOGTO_CLIENT_SECRET ?? "").trim();
  const portalSessionSecret = (env.PORTAL_SESSION_SECRET ?? "").trim();
  const portalLogtoAppId = (env.LOGTO_PORTAL_APP_ID ?? "").trim();
  const portalLogtoAppSecret = (env.LOGTO_PORTAL_APP_SECRET ?? "").trim();
  const portalLogtoM2mAppId = (env.LOGTO_M2M_APP_ID ?? "").trim();
  const portalLogtoM2mAppSecret = (env.LOGTO_M2M_APP_SECRET ?? "").trim();
  const portalLogtoManagementApiResource = (env.LOGTO_MANAGEMENT_API_RESOURCE ?? "").trim();
  const portalMcpUserRoleId = (env.LOGTO_MCP_USER_ROLE_ID ?? "").trim();
  const portalSessionTtlRaw = (env.PORTAL_SESSION_TTL_SECONDS ?? "").trim();
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
    port,
    publicUrl,
    rootAuthToken,
    tgChatRag: {
      baseUrl: normalizedBaseUrl,
      bearerToken,
      chatIds,
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
  };
  // END_BLOCK_BUILD_APP_CONFIG_RESULT_M_CONFIG_008
}
