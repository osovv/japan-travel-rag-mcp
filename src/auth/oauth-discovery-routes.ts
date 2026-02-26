// FILE: src/auth/oauth-discovery-routes.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Expose OAuth protected resource metadata endpoints required by MCP OAuth clients.
//   SCOPE: Match OAuth discovery route paths, enforce GET-only behavior, build protected resource metadata from runtime config, return safe non-match and internal-failure behaviors, and emit structured logs.
//   DEPENDS: M-CONFIG, M-LOGGER
//   LINKS: M-OAUTH-DISCOVERY, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   OAUTH_DISCOVERY_ERROR - Typed error code for OAuth discovery route internal failures.
//   OAuthDiscoveryError - Typed error for discovery contract/dependency/runtime failures.
//   handleOAuthProtectedResourceMetadata - Serve metadata for /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/mcp.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation from development plan for M-OAUTH-DISCOVERY with GET route handling and safe non-match behavior.
// END_CHANGE_SUMMARY

import { loadConfig } from "../config/index";
import type { AppConfig } from "../config/index";
import { createLogger } from "../logger/index";
import type { Logger } from "../logger/index";

const DISCOVERY_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
const DISCOVERY_RESOURCE_MCP_PATH = "/.well-known/oauth-protected-resource/mcp";
const BASELINE_REQUIRED_SCOPE = "mcp:access";

export const OAUTH_DISCOVERY_ERROR = "OAUTH_DISCOVERY_ERROR" as const;

type OAuthDiscoveryErrorDetails = {
  field?: string;
  cause?: string;
  path?: string;
  method?: string;
};

export class OAuthDiscoveryError extends Error {
  public readonly code = OAUTH_DISCOVERY_ERROR;
  public readonly details?: OAuthDiscoveryErrorDetails;

  public constructor(message: string, details?: OAuthDiscoveryErrorDetails) {
    super(message);
    this.name = "OAuthDiscoveryError";
    this.details = details;
  }
}

type OAuthProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
};

export type OAuthDiscoveryDependencies = {
  config: AppConfig;
  logger: Logger;
};

let defaultDependencies: OAuthDiscoveryDependencies | null = null;

// START_CONTRACT: normalizeOptionalString
//   PURPOSE: Normalize optional string values by trimming and dropping empty strings.
//   INPUTS: { value: unknown - Candidate value to normalize }
//   OUTPUTS: { string | undefined - Trimmed non-empty string or undefined }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-OAUTH-DISCOVERY]
// END_CONTRACT: normalizeOptionalString
function normalizeOptionalString(value: unknown): string | undefined {
  // START_BLOCK_NORMALIZE_OPTIONAL_STRING_VALUES_M_OAUTH_DISCOVERY_001
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
  // END_BLOCK_NORMALIZE_OPTIONAL_STRING_VALUES_M_OAUTH_DISCOVERY_001
}

// START_CONTRACT: normalizeScopes
//   PURPOSE: Build normalized required scope list including baseline mcp:access.
//   INPUTS: { configuredScopes: readonly string[] - Config-provided required scopes }
//   OUTPUTS: { string[] - Ordered unique required scopes including baseline }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-OAUTH-DISCOVERY, M-CONFIG]
// END_CONTRACT: normalizeScopes
function normalizeScopes(configuredScopes: readonly string[]): string[] {
  // START_BLOCK_NORMALIZE_DISCOVERY_SCOPE_VALUES_M_OAUTH_DISCOVERY_002
  const uniqueScopes = new Set<string>();
  uniqueScopes.add(BASELINE_REQUIRED_SCOPE);

  for (const scope of configuredScopes) {
    const normalizedScope = normalizeOptionalString(scope);
    if (normalizedScope) {
      uniqueScopes.add(normalizedScope);
    }
  }

  return [...uniqueScopes];
  // END_BLOCK_NORMALIZE_DISCOVERY_SCOPE_VALUES_M_OAUTH_DISCOVERY_002
}

// START_CONTRACT: isDiscoveryPath
//   PURPOSE: Determine whether request pathname belongs to supported OAuth discovery metadata routes.
//   INPUTS: { pathname: string - Parsed URL pathname from request }
//   OUTPUTS: { boolean - True when path is one of supported discovery endpoints }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-OAUTH-DISCOVERY]
// END_CONTRACT: isDiscoveryPath
function isDiscoveryPath(pathname: string): boolean {
  // START_BLOCK_MATCH_SUPPORTED_DISCOVERY_PATHS_M_OAUTH_DISCOVERY_003
  return pathname === DISCOVERY_RESOURCE_PATH || pathname === DISCOVERY_RESOURCE_MCP_PATH;
  // END_BLOCK_MATCH_SUPPORTED_DISCOVERY_PATHS_M_OAUTH_DISCOVERY_003
}

// START_CONTRACT: toOAuthDiscoveryError
//   PURPOSE: Normalize unknown runtime failures into typed OAuthDiscoveryError instances.
//   INPUTS: { error: unknown - Caught runtime failure, message: string - Stable error message, details: OAuthDiscoveryErrorDetails | undefined - Optional context details }
//   OUTPUTS: { OAuthDiscoveryError - Typed discovery error value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-OAUTH-DISCOVERY]
// END_CONTRACT: toOAuthDiscoveryError
function toOAuthDiscoveryError(
  error: unknown,
  message: string,
  details?: OAuthDiscoveryErrorDetails,
): OAuthDiscoveryError {
  // START_BLOCK_MAP_UNKNOWN_FAILURES_TO_TYPED_DISCOVERY_ERROR_M_OAUTH_DISCOVERY_004
  if (error instanceof OAuthDiscoveryError) {
    return error;
  }
  const cause = error instanceof Error ? error.message : String(error);
  return new OAuthDiscoveryError(message, {
    ...details,
    cause,
  });
  // END_BLOCK_MAP_UNKNOWN_FAILURES_TO_TYPED_DISCOVERY_ERROR_M_OAUTH_DISCOVERY_004
}

// START_CONTRACT: assertDependencies
//   PURPOSE: Validate discovery dependency wiring contract before route processing.
//   INPUTS: { dependencies: OAuthDiscoveryDependencies - Config and logger dependencies }
//   OUTPUTS: { void - Throws when dependency contract is invalid }
//   SIDE_EFFECTS: [Throws OAuthDiscoveryError on invalid dependency contract]
//   LINKS: [M-OAUTH-DISCOVERY, M-CONFIG, M-LOGGER]
// END_CONTRACT: assertDependencies
function assertDependencies(dependencies: OAuthDiscoveryDependencies): void {
  // START_BLOCK_VALIDATE_DISCOVERY_DEPENDENCIES_M_OAUTH_DISCOVERY_005
  if (!dependencies || typeof dependencies !== "object") {
    throw new OAuthDiscoveryError("OAuth discovery dependencies are required.", {
      field: "dependencies",
    });
  }

  if (!dependencies.config || typeof dependencies.config !== "object") {
    throw new OAuthDiscoveryError("OAuth discovery requires config dependency.", {
      field: "config",
    });
  }

  if (
    !dependencies.logger ||
    typeof dependencies.logger.info !== "function" ||
    typeof dependencies.logger.warn !== "function" ||
    typeof dependencies.logger.error !== "function"
  ) {
    throw new OAuthDiscoveryError("OAuth discovery requires logger dependency.", {
      field: "logger",
    });
  }
  // END_BLOCK_VALIDATE_DISCOVERY_DEPENDENCIES_M_OAUTH_DISCOVERY_005
}

// START_CONTRACT: resolveDependencies
//   PURPOSE: Resolve provided dependencies or lazily initialize defaults from config/logger modules.
//   INPUTS: { dependencies: OAuthDiscoveryDependencies | undefined - Optional injected dependencies }
//   OUTPUTS: { OAuthDiscoveryDependencies - Resolved dependencies for discovery handling }
//   SIDE_EFFECTS: [Loads config and creates logger when defaults are first needed]
//   LINKS: [M-OAUTH-DISCOVERY, M-CONFIG, M-LOGGER]
// END_CONTRACT: resolveDependencies
function resolveDependencies(dependencies?: OAuthDiscoveryDependencies): OAuthDiscoveryDependencies {
  // START_BLOCK_RESOLVE_DISCOVERY_DEPENDENCIES_M_OAUTH_DISCOVERY_006
  if (dependencies) {
    assertDependencies(dependencies);
    return dependencies;
  }

  if (defaultDependencies) {
    return defaultDependencies;
  }

  const config = loadConfig();
  const logger = createLogger(config, "OAuthDiscoveryRoutes");
  defaultDependencies = { config, logger };
  assertDependencies(defaultDependencies);
  return defaultDependencies;
  // END_BLOCK_RESOLVE_DISCOVERY_DEPENDENCIES_M_OAUTH_DISCOVERY_006
}

// START_CONTRACT: buildMetadataPayload
//   PURPOSE: Build protected resource metadata payload bound to requested discovery route and runtime config.
//   INPUTS: { pathname: string - Matched discovery path, config: AppConfig - Runtime config }
//   OUTPUTS: { OAuthProtectedResourceMetadata - Discovery payload for OAuth clients }
//   SIDE_EFFECTS: [Throws OAuthDiscoveryError on invalid payload prerequisites]
//   LINKS: [M-OAUTH-DISCOVERY, M-CONFIG]
// END_CONTRACT: buildMetadataPayload
function buildMetadataPayload(pathname: string, config: AppConfig): OAuthProtectedResourceMetadata {
  // START_BLOCK_BUILD_DISCOVERY_METADATA_PAYLOAD_M_OAUTH_DISCOVERY_007
  const resourcePath = pathname === DISCOVERY_RESOURCE_MCP_PATH ? "/mcp" : "/";
  let resourceUrl: string;
  let issuerUrl: string;

  try {
    resourceUrl = new URL(resourcePath, config.publicUrl).toString();
    issuerUrl = new URL(config.oauth.issuer).toString();
  } catch {
    throw new OAuthDiscoveryError("Failed to construct OAuth discovery URLs from config.", {
      field: "config.publicUrl|config.oauth.issuer",
      path: pathname,
    });
  }

  return {
    resource: resourceUrl,
    authorization_servers: [issuerUrl],
    scopes_supported: normalizeScopes(config.oauth.requiredScopes),
    bearer_methods_supported: ["header"],
  };
  // END_BLOCK_BUILD_DISCOVERY_METADATA_PAYLOAD_M_OAUTH_DISCOVERY_007
}

// START_CONTRACT: createJsonResponse
//   PURPOSE: Build JSON responses with consistent content type and payload serialization.
//   INPUTS: { status: number - HTTP status code, payload: Record<string, unknown> - Response JSON payload, extraHeaders: Record<string, string> | undefined - Optional extra headers }
//   OUTPUTS: { Response - JSON response object }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-OAUTH-DISCOVERY]
// END_CONTRACT: createJsonResponse
function createJsonResponse(
  status: number,
  payload: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  // START_BLOCK_BUILD_JSON_RESPONSE_OBJECT_M_OAUTH_DISCOVERY_008
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers.set(key, value);
    }
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
  // END_BLOCK_BUILD_JSON_RESPONSE_OBJECT_M_OAUTH_DISCOVERY_008
}

// START_CONTRACT: handleOAuthProtectedResourceMetadata
//   PURPOSE: Handle OAuth protected resource metadata routes and return non-match/null for unrelated paths.
//   INPUTS: { request: Request - Incoming HTTP request, dependencies: OAuthDiscoveryDependencies | undefined - Optional config/logger dependencies }
//   OUTPUTS: { Response | null - Discovery response for matched path, otherwise null for non-match }
//   SIDE_EFFECTS: [May load config/logger defaults, emits structured logs]
//   LINKS: [M-OAUTH-DISCOVERY, M-CONFIG, M-LOGGER]
// END_CONTRACT: handleOAuthProtectedResourceMetadata
export function handleOAuthProtectedResourceMetadata(
  request: Request,
  dependencies?: OAuthDiscoveryDependencies,
): Response | null {
  // START_BLOCK_MATCH_DISCOVERY_PATH_AND_VALIDATE_METHOD_M_OAUTH_DISCOVERY_009
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!isDiscoveryPath(pathname)) {
    return null;
  }

  const resolvedDependencies = resolveDependencies(dependencies);
  const logger = resolvedDependencies.logger;
  const functionName = "handleOAuthProtectedResourceMetadata";

  logger.info(
    "Matched OAuth discovery metadata route.",
    functionName,
    "MATCH_DISCOVERY_PATH_AND_VALIDATE_METHOD",
    {
      path: pathname,
      method: request.method,
    },
  );

  if (request.method !== "GET") {
    logger.warn(
      "Rejected non-GET request for OAuth discovery route.",
      functionName,
      "MATCH_DISCOVERY_PATH_AND_VALIDATE_METHOD",
      {
        path: pathname,
        method: request.method,
      },
    );
    return createJsonResponse(
      405,
      {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "OAuth protected resource metadata endpoint supports GET only.",
        },
      },
      { Allow: "GET" },
    );
  }
  // END_BLOCK_MATCH_DISCOVERY_PATH_AND_VALIDATE_METHOD_M_OAUTH_DISCOVERY_009

  // START_BLOCK_BUILD_AND_RETURN_DISCOVERY_METADATA_RESPONSE_M_OAUTH_DISCOVERY_010
  try {
    const payload = buildMetadataPayload(pathname, resolvedDependencies.config);
    logger.info(
      "Returning OAuth discovery metadata response.",
      functionName,
      "BUILD_AND_RETURN_DISCOVERY_METADATA_RESPONSE",
      {
        path: pathname,
        resource: payload.resource,
        scopesSupported: payload.scopes_supported,
      },
    );
    return createJsonResponse(200, payload);
  } catch (error: unknown) {
    const typedError = toOAuthDiscoveryError(
      error,
      "Failed to build OAuth protected resource metadata response.",
      {
        path: pathname,
        method: request.method,
      },
    );
    logger.error(
      "OAuth discovery metadata route failed internally.",
      functionName,
      "BUILD_AND_RETURN_DISCOVERY_METADATA_RESPONSE",
      {
        code: typedError.code,
        details: typedError.details ?? null,
      },
    );
    return createJsonResponse(500, {
      error: {
        code: typedError.code,
        message: "Failed to serve OAuth protected resource metadata.",
      },
    });
  }
  // END_BLOCK_BUILD_AND_RETURN_DISCOVERY_METADATA_RESPONSE_M_OAUTH_DISCOVERY_010
}
