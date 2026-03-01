// FILE: src/auth/oauth-proxy.ts
// VERSION: 1.8.0
// START_MODULE_CONTRACT
//   PURPOSE: Create and configure FastMCP OAuthProxy bound to Logto OIDC endpoints for /mcp authentication.
//   SCOPE: Validate runtime config/logger dependencies, build deterministic OAuthProxy configuration from AppConfig Logto/public URL fields, instantiate OAuthProxy, expose authorization server metadata, and map init failures to OAUTH_PROXY_INIT_ERROR.
//   DEPENDS: M-CONFIG, M-LOGGER, M-AUTH-CONSENT-PATCH
//   LINKS: M-AUTH-PROXY, M-CONFIG, M-LOGGER, M-AUTH-CONSENT-PATCH
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   OauthProxyDeps - Dependency bundle for OAuth proxy initialization (config + logger).
//   OauthProxyContext - Initialized OAuthProxy and derived authorization-server metadata payload.
//   OauthProxyInitError - Typed initialization failure with stable OAUTH_PROXY_INIT_ERROR code.
//   DEFAULT_OAUTH_PROXY_SCOPES - Deterministic default upstream scopes forwarded to authorization requests.
//   createOauthProxy - Build and return OAuthProxy plus authorization server metadata; applies portal consent screen patch.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.8.0 - Integrated patchOAuthProxyConsent from M-AUTH-CONSENT-PATCH to replace default consent screen with portal-styled HTML after OAuthProxy construction.
// END_CHANGE_SUMMARY

import { createHmac } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { OAuthProxy, type OAuthProxyConfig } from "fastmcp/auth";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import { patchOAuthProxyConsent } from "./consent-patch";
import { PostgresTokenStorage } from "./pg-token-storage";

type OauthProxyInitErrorDetails = {
  field?: string;
  cause?: string;
};

type ResolvedOauthProxyConfig = {
  baseUrl: string;
  upstreamAuthorizationEndpoint: string;
  upstreamTokenEndpoint: string;
  upstreamClientId: string;
  upstreamClientSecret: string;
  scopes: string[];
};

const DEFAULT_OAUTH_PROXY_SCOPES = Object.freeze(["mcp:access"]);

export type OauthProxyDeps = {
  config: AppConfig;
  logger: Logger;
  db: NodePgDatabase;
};

export type OauthProxyContext = {
  oauthProxy: OAuthProxy;
  authorizationServerMetadata: ReturnType<OAuthProxy["getAuthorizationServerMetadata"]>;
};

export class OauthProxyInitError extends Error {
  public readonly code = "OAUTH_PROXY_INIT_ERROR" as const;
  public readonly details?: OauthProxyInitErrorDetails;

  public constructor(message: string, details?: OauthProxyInitErrorDetails) {
    super(message);
    this.name = "OauthProxyInitError";
    this.details = details;
  }
}

// START_CONTRACT: redactSensitiveDiagnostics
//   PURPOSE: Sanitize diagnostic messages before attaching them to structured logs or typed init errors.
//   INPUTS: { text: string - Raw diagnostic text }
//   OUTPUTS: { string - Redacted and length-capped diagnostic text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-AUTH-PROXY]
// END_CONTRACT: redactSensitiveDiagnostics
function redactSensitiveDiagnostics(text: string): string {
  // START_BLOCK_REDACT_SENSITIVE_DIAGNOSTICS_M_AUTH_PROXY_001
  const normalized = text.trim();
  if (!normalized) {
    return "unknown";
  }

  const redacted = normalized
    .replace(/\b[Bb]earer\s+[A-Za-z0-9\-._~+/]+=*/g, "Bearer <redacted-token>")
    .replace(/[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, "<redacted-jwt>")
    .replace(/\b[a-f0-9]{32,}\b/gi, "<redacted-digest>");

  return redacted.length > 240 ? `${redacted.slice(0, 240)}...` : redacted;
  // END_BLOCK_REDACT_SENSITIVE_DIAGNOSTICS_M_AUTH_PROXY_001
}

// START_CONTRACT: toOauthProxyInitError
//   PURPOSE: Convert unknown runtime failures into typed OauthProxyInitError values with sanitized cause details.
//   INPUTS: { error: unknown - Runtime failure, message: string - Stable high-level failure message, field: string|undefined - Optional field hint }
//   OUTPUTS: { OauthProxyInitError - Typed initialization error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-AUTH-PROXY]
// END_CONTRACT: toOauthProxyInitError
function toOauthProxyInitError(
  error: unknown,
  message: string,
  field?: string,
): OauthProxyInitError {
  // START_BLOCK_MAP_UNKNOWN_FAILURE_TO_OAUTH_PROXY_INIT_ERROR_M_AUTH_PROXY_002
  if (error instanceof OauthProxyInitError) {
    return error;
  }

  const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new OauthProxyInitError(message, {
    field,
    cause: redactSensitiveDiagnostics(cause),
  });
  // END_BLOCK_MAP_UNKNOWN_FAILURE_TO_OAUTH_PROXY_INIT_ERROR_M_AUTH_PROXY_002
}

// START_CONTRACT: normalizeRequiredText
//   PURPOSE: Validate required text values as non-empty trimmed strings.
//   INPUTS: { value: unknown - Candidate value, field: string - Diagnostic field path }
//   OUTPUTS: { string - Normalized non-empty text value }
//   SIDE_EFFECTS: [Throws OauthProxyInitError when value is missing or blank]
//   LINKS: [M-AUTH-PROXY]
// END_CONTRACT: normalizeRequiredText
function normalizeRequiredText(value: unknown, field: string): string {
  // START_BLOCK_VALIDATE_REQUIRED_TEXT_FIELD_M_AUTH_PROXY_003
  if (typeof value !== "string") {
    throw new OauthProxyInitError(
      `OAuth proxy initialization requires ${field} to be a non-empty string.`,
      { field },
    );
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new OauthProxyInitError(
      `OAuth proxy initialization requires ${field} to be a non-empty string.`,
      { field },
    );
  }

  return normalized;
  // END_BLOCK_VALIDATE_REQUIRED_TEXT_FIELD_M_AUTH_PROXY_003
}

// START_CONTRACT: normalizeRequiredUrl
//   PURPOSE: Validate required URL-like values and return normalized absolute URL strings.
//   INPUTS: { value: unknown - Candidate value, field: string - Diagnostic field path }
//   OUTPUTS: { string - Normalized URL string }
//   SIDE_EFFECTS: [Throws OauthProxyInitError when value is missing/invalid URL]
//   LINKS: [M-AUTH-PROXY]
// END_CONTRACT: normalizeRequiredUrl
function normalizeRequiredUrl(value: unknown, field: string): string {
  // START_BLOCK_VALIDATE_REQUIRED_URL_FIELD_M_AUTH_PROXY_004
  const normalizedText = normalizeRequiredText(value, field);
  try {
    return new URL(normalizedText).toString();
  } catch {
    throw new OauthProxyInitError(`OAuth proxy initialization requires ${field} to be a valid URL.`, {
      field,
    });
  }
  // END_BLOCK_VALIDATE_REQUIRED_URL_FIELD_M_AUTH_PROXY_004
}

// START_CONTRACT: normalizeBaseUrlWithoutTrailingSlash
//   PURPOSE: Normalize OAuth proxy base URL by removing trailing slash characters to prevent double-slash endpoint joins.
//   INPUTS: { value: string - Valid absolute URL string }
//   OUTPUTS: { string - URL string without trailing slash }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-AUTH-PROXY]
// END_CONTRACT: normalizeBaseUrlWithoutTrailingSlash
function normalizeBaseUrlWithoutTrailingSlash(value: string): string {
  // START_BLOCK_NORMALIZE_BASE_URL_WITHOUT_TRAILING_SLASH_M_AUTH_PROXY_010
  return value.replace(/\/+$/, "");
  // END_BLOCK_NORMALIZE_BASE_URL_WITHOUT_TRAILING_SLASH_M_AUTH_PROXY_010
}

// START_CONTRACT: validateLoggerDependency
//   PURPOSE: Validate logger dependency shape to ensure structured log emission is safe at runtime.
//   INPUTS: { logger: Logger|undefined - Logger dependency from caller }
//   OUTPUTS: { Logger - Validated logger dependency }
//   SIDE_EFFECTS: [Throws OauthProxyInitError when logger contract is invalid]
//   LINKS: [M-AUTH-PROXY, M-LOGGER]
// END_CONTRACT: validateLoggerDependency
function validateLoggerDependency(logger: Logger | undefined): Logger {
  // START_BLOCK_VALIDATE_LOGGER_DEPENDENCY_SHAPE_M_AUTH_PROXY_005
  if (!logger || typeof logger !== "object") {
    throw new OauthProxyInitError("OAuth proxy initialization requires a valid logger dependency.", {
      field: "logger",
    });
  }

  const hasMethods =
    typeof logger.info === "function" &&
    typeof logger.warn === "function" &&
    typeof logger.error === "function";

  if (!hasMethods) {
    throw new OauthProxyInitError(
      "OAuth proxy initialization requires logger.info/logger.warn/logger.error methods.",
      {
        field: "logger",
      },
    );
  }

  return logger;
  // END_BLOCK_VALIDATE_LOGGER_DEPENDENCY_SHAPE_M_AUTH_PROXY_005
}

// START_CONTRACT: resolveOauthProxyConfig
//   PURPOSE: Validate AppConfig values and map them into OAuthProxy constructor config fields with deterministic default upstream scopes.
//   INPUTS: { config: AppConfig - Runtime app config with public URL and Logto OIDC endpoints/credentials }
//   OUTPUTS: { ResolvedOauthProxyConfig - Normalized OAuthProxy constructor fields including upstream scopes }
//   SIDE_EFFECTS: [Throws OauthProxyInitError when required fields are missing/invalid]
//   LINKS: [M-AUTH-PROXY, M-CONFIG]
// END_CONTRACT: resolveOauthProxyConfig
function resolveOauthProxyConfig(config: AppConfig): ResolvedOauthProxyConfig {
  // START_BLOCK_VALIDATE_AND_RESOLVE_OAUTH_PROXY_CONFIG_M_AUTH_PROXY_006
  if (!config || typeof config !== "object") {
    throw new OauthProxyInitError("OAuth proxy initialization requires a valid AppConfig object.", {
      field: "config",
    });
  }

  const baseUrl = normalizeBaseUrlWithoutTrailingSlash(
    normalizeRequiredUrl(config.publicUrl, "config.publicUrl"),
  );
  const upstreamAuthorizationEndpoint = normalizeRequiredUrl(
    config.logto?.oidcAuthEndpoint,
    "config.logto.oidcAuthEndpoint",
  );
  const upstreamTokenEndpoint = normalizeRequiredUrl(
    config.logto?.oidcTokenEndpoint,
    "config.logto.oidcTokenEndpoint",
  );
  const upstreamClientId = normalizeRequiredText(config.logto?.clientId, "config.logto.clientId");
  const upstreamClientSecret = normalizeRequiredText(
    config.logto?.clientSecret,
    "config.logto.clientSecret",
  );

  return {
    baseUrl,
    upstreamAuthorizationEndpoint,
    upstreamTokenEndpoint,
    upstreamClientId,
    upstreamClientSecret,
    scopes: [...DEFAULT_OAUTH_PROXY_SCOPES],
  };
  // END_BLOCK_VALIDATE_AND_RESOLVE_OAUTH_PROXY_CONFIG_M_AUTH_PROXY_006
}

function deriveKey(secret: string, label: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(label);
  return hmac.digest("hex");
}

// START_CONTRACT: createOauthProxy
//   PURPOSE: Create FastMCP OAuthProxy instance with deterministic default upstream scopes and derive authorization-server metadata for runtime oauth config wiring.
//   INPUTS: { deps: OauthProxyDeps - Dependency bundle with AppConfig and logger }
//   OUTPUTS: { OauthProxyContext - OAuthProxy instance plus authorization server metadata object }
//   SIDE_EFFECTS: [Writes structured logs via logger; throws OauthProxyInitError on invalid input or proxy construction failure]
//   LINKS: [M-AUTH-PROXY, M-CONFIG, M-LOGGER]
// END_CONTRACT: createOauthProxy
export function createOauthProxy(deps: OauthProxyDeps): OauthProxyContext {
  // START_BLOCK_VALIDATE_INIT_DEPENDENCIES_M_AUTH_PROXY_007
  if (!deps || typeof deps !== "object") {
    throw new OauthProxyInitError("OAuth proxy initialization requires dependency object.", {
      field: "deps",
    });
  }
  const logger = validateLoggerDependency(deps.logger);
  const resolvedConfig = resolveOauthProxyConfig(deps.config);
  // END_BLOCK_VALIDATE_INIT_DEPENDENCIES_M_AUTH_PROXY_007

  // START_BLOCK_EMIT_OAUTH_PROXY_INIT_START_LOG_M_AUTH_PROXY_008
  logger.info(
    "Initializing FastMCP OAuthProxy with Logto upstream endpoints.",
    "createOauthProxy",
    "EMIT_OAUTH_PROXY_INIT_START_LOG_M_AUTH_PROXY_008",
    {
      baseUrl: resolvedConfig.baseUrl,
      upstreamAuthorizationEndpoint: resolvedConfig.upstreamAuthorizationEndpoint,
      upstreamTokenEndpoint: resolvedConfig.upstreamTokenEndpoint,
      upstreamClientId: resolvedConfig.upstreamClientId,
      scopes: resolvedConfig.scopes,
    },
  );
  // END_BLOCK_EMIT_OAUTH_PROXY_INIT_START_LOG_M_AUTH_PROXY_008

  // START_BLOCK_CONSTRUCT_OAUTH_PROXY_AND_METADATA_M_AUTH_PROXY_009
  try {
    const secret = deps.config.oauthSessionSecret;
    const encryptionKey = deriveKey(secret, "fastmcp:encryption");
    const jwtSigningKey = deriveKey(secret, "fastmcp:jwt");
    const consentSigningKey = deriveKey(secret, "fastmcp:consent");
    const tokenStorage = new PostgresTokenStorage(deps.db, logger);

    const oauthProxyConfig: OAuthProxyConfig = {
      baseUrl: resolvedConfig.baseUrl,
      upstreamAuthorizationEndpoint: resolvedConfig.upstreamAuthorizationEndpoint,
      upstreamTokenEndpoint: resolvedConfig.upstreamTokenEndpoint,
      upstreamClientId: resolvedConfig.upstreamClientId,
      upstreamClientSecret: resolvedConfig.upstreamClientSecret,
      scopes: resolvedConfig.scopes,
      tokenStorage,
      encryptionKey,
      jwtSigningKey,
      consentSigningKey,
    };

    const oauthProxy = new OAuthProxy(oauthProxyConfig);

    patchOAuthProxyConsent(oauthProxy);
    logger.info(
      "Applied portal consent screen patch to OAuthProxy.",
      "createOauthProxy",
      "APPLY_PORTAL_CONSENT_PATCH_M_AUTH_PROXY_011",
    );

    const authorizationServerMetadata = oauthProxy.getAuthorizationServerMetadata();

    logger.info(
      "Initialized FastMCP OAuthProxy and resolved authorization server metadata.",
      "createOauthProxy",
      "CONSTRUCT_OAUTH_PROXY_AND_METADATA_M_AUTH_PROXY_009",
      {
        issuer: authorizationServerMetadata.issuer,
        authorizationEndpoint: authorizationServerMetadata.authorizationEndpoint,
        tokenEndpoint: authorizationServerMetadata.tokenEndpoint,
      },
    );

    return {
      oauthProxy,
      authorizationServerMetadata,
    };
  } catch (error: unknown) {
    const mappedError = toOauthProxyInitError(
      error,
      "Failed to initialize FastMCP OAuthProxy from runtime configuration.",
    );

    logger.error(
      `OAuth proxy initialization failed with ${mappedError.code}.`,
      "createOauthProxy",
      "CONSTRUCT_OAUTH_PROXY_AND_METADATA_M_AUTH_PROXY_009",
      mappedError.details
        ? {
            field: mappedError.details.field,
            cause: mappedError.details.cause,
          }
        : undefined,
    );

    throw mappedError;
  }
  // END_BLOCK_CONSTRUCT_OAUTH_PROXY_AND_METADATA_M_AUTH_PROXY_009
}
