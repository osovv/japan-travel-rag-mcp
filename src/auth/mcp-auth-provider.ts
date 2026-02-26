// FILE: src/auth/mcp-auth-provider.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Initialize mcp-auth in protected resource mode and expose framework-agnostic token verification and resource metadata context for Bun.serve() integration.
//   SCOPE: Validate runtime auth config inputs, fetch OIDC server metadata, construct MCPAuth/TokenVerifier wiring, build snake_case protected resource metadata payload, and map initialization failures to MCP_AUTH_INIT_ERROR.
//   DEPENDS: M-CONFIG, M-LOGGER
//   LINKS: M-MCP-AUTH-PROVIDER, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   McpAuthInitError - Typed initialization error with stable MCP_AUTH_INIT_ERROR code and sanitized details.
//   McpAuthContext - Initialized auth context with MCPAuth instance, token verification functions, metadata URL, and protected resource payload.
//   initMcpAuth - Async bootstrap that fetches OIDC metadata, builds MCPAuth + TokenVerifier, and returns framework-agnostic auth context.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Added M-MCP-AUTH-PROVIDER for Phase-7 mcp-auth migration with deep-import TokenVerifier wiring and protected resource metadata context.
// END_CHANGE_SUMMARY

import { MCPAuth, fetchServerConfig } from "mcp-auth";
import type {
  ProtectedResourceMetadata,
  ValidateIssuerFunction,
  VerifyAccessTokenFunction,
} from "mcp-auth";
import { TokenVerifier } from "mcp-auth/auth/token-verifier.js";
import { createResourceMetadataEndpoint } from "mcp-auth/utils/create-resource-metadata-endpoint.js";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";

const RESOURCE_PATH = "/mcp";
const BEARER_METHODS_SUPPORTED = ["header"] as const;

type McpAuthInitErrorDetails = {
  field?: string;
  cause?: string;
};

type ResolvedMcpAuthInitInputs = {
  issuer: string;
  audience: string;
  resource: string;
  requiredScopes: string[];
};

export type McpAuthContext = {
  mcpAuth: MCPAuth;
  verifyAccessToken: VerifyAccessTokenFunction;
  validateIssuer: ValidateIssuerFunction;
  resourceMetadataUrl: string;
  protectedResourceMetadata: ProtectedResourceMetadata;
};

export class McpAuthInitError extends Error {
  public readonly code = "MCP_AUTH_INIT_ERROR" as const;
  public readonly details?: McpAuthInitErrorDetails;

  public constructor(message: string, details?: McpAuthInitErrorDetails) {
    super(message);
    this.name = "McpAuthInitError";
    this.details = details;
  }
}

// START_CONTRACT: redactSensitiveDiagnostics
//   PURPOSE: Remove token-like substrings from diagnostics before logging or attaching to typed init errors.
//   INPUTS: { text: string - Raw diagnostic text }
//   OUTPUTS: { string - Sanitized diagnostic text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-PROVIDER]
// END_CONTRACT: redactSensitiveDiagnostics
function redactSensitiveDiagnostics(text: string): string {
  // START_BLOCK_REDACT_SENSITIVE_DIAGNOSTICS_M_MCP_AUTH_PROVIDER_001
  const normalized = text.trim();
  if (!normalized) {
    return "unknown";
  }

  const redacted = normalized
    .replace(/\b[Bb]earer\s+[A-Za-z0-9\-._~+/]+=*/g, "Bearer <redacted-token>")
    .replace(/[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, "<redacted-jwt>")
    .replace(/\b[a-f0-9]{32,}\b/gi, "<redacted-digest>");

  return redacted.length > 240 ? `${redacted.slice(0, 240)}...` : redacted;
  // END_BLOCK_REDACT_SENSITIVE_DIAGNOSTICS_M_MCP_AUTH_PROVIDER_001
}

// START_CONTRACT: toMcpAuthInitError
//   PURPOSE: Convert unknown runtime failures into sanitized McpAuthInitError instances.
//   INPUTS: { error: unknown - Runtime failure, message: string - Stable high-level error message, field: string|undefined - Optional field hint }
//   OUTPUTS: { McpAuthInitError - Typed initialization error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-PROVIDER]
// END_CONTRACT: toMcpAuthInitError
function toMcpAuthInitError(
  error: unknown,
  message: string,
  field?: string,
): McpAuthInitError {
  // START_BLOCK_MAP_UNKNOWN_FAILURE_TO_MCP_AUTH_INIT_ERROR_M_MCP_AUTH_PROVIDER_002
  if (error instanceof McpAuthInitError) {
    return error;
  }

  const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new McpAuthInitError(message, {
    field,
    cause: redactSensitiveDiagnostics(cause),
  });
  // END_BLOCK_MAP_UNKNOWN_FAILURE_TO_MCP_AUTH_INIT_ERROR_M_MCP_AUTH_PROVIDER_002
}

// START_CONTRACT: normalizeScopes
//   PURPOSE: Normalize scope values by trimming, removing empties, and deduplicating while preserving first-seen order.
//   INPUTS: { scopes: readonly string[] - Raw scope values from config }
//   OUTPUTS: { string[] - Deterministic normalized scope list }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-PROVIDER]
// END_CONTRACT: normalizeScopes
function normalizeScopes(scopes: readonly string[]): string[] {
  // START_BLOCK_NORMALIZE_REQUIRED_SCOPES_M_MCP_AUTH_PROVIDER_003
  const uniqueScopes: string[] = [];
  const seenScopes = new Set<string>();

  for (const scope of scopes) {
    const normalizedScope = scope.trim();
    if (!normalizedScope || seenScopes.has(normalizedScope)) {
      continue;
    }
    seenScopes.add(normalizedScope);
    uniqueScopes.push(normalizedScope);
  }

  return uniqueScopes;
  // END_BLOCK_NORMALIZE_REQUIRED_SCOPES_M_MCP_AUTH_PROVIDER_003
}

// START_CONTRACT: emitProviderLog
//   PURPOSE: Emit structured provider logs through M-LOGGER when logger dependency is supplied.
//   INPUTS: { logger: Logger|undefined - Optional logger dependency, level: "info"|"warn"|"error" - Log level, message: string - Message body, blockName: string - Semantic block name, extra: Record<string, unknown>|undefined - Optional structured context }
//   OUTPUTS: { void - No return value }
//   SIDE_EFFECTS: [Writes structured logs via logger dependency when provided]
//   LINKS: [M-MCP-AUTH-PROVIDER, M-LOGGER]
// END_CONTRACT: emitProviderLog
function emitProviderLog(
  logger: Logger | undefined,
  level: "info" | "warn" | "error",
  message: string,
  blockName: string,
  extra?: Record<string, unknown>,
): void {
  // START_BLOCK_EMIT_PROVIDER_LOG_WITH_OPTIONAL_LOGGER_M_MCP_AUTH_PROVIDER_004
  if (!logger) {
    return;
  }

  logger[level](message, "initMcpAuth", blockName, extra);
  // END_BLOCK_EMIT_PROVIDER_LOG_WITH_OPTIONAL_LOGGER_M_MCP_AUTH_PROVIDER_004
}

// START_CONTRACT: resolveInitInputs
//   PURPOSE: Validate and normalize config fields required for mcp-auth provider initialization.
//   INPUTS: { config: AppConfig - Runtime configuration }
//   OUTPUTS: { ResolvedMcpAuthInitInputs - Normalized issuer/audience/resource/scopes values }
//   SIDE_EFFECTS: [Throws McpAuthInitError on invalid/missing values]
//   LINKS: [M-MCP-AUTH-PROVIDER, M-CONFIG]
// END_CONTRACT: resolveInitInputs
function resolveInitInputs(config: AppConfig): ResolvedMcpAuthInitInputs {
  // START_BLOCK_VALIDATE_AND_RESOLVE_MCP_AUTH_INIT_INPUTS_M_MCP_AUTH_PROVIDER_005
  if (!config || typeof config !== "object") {
    throw new McpAuthInitError("MCP auth initialization requires valid runtime config.", {
      field: "config",
    });
  }

  const issuerRaw = config.oauth?.issuer ?? "";
  const audienceRaw = config.oauth?.audience ?? "";
  const publicUrlRaw = config.publicUrl ?? "";
  const requiredScopesRaw = Array.isArray(config.oauth?.requiredScopes)
    ? config.oauth.requiredScopes
    : [];

  const audience = audienceRaw.trim();
  if (!audience) {
    throw new McpAuthInitError("OAUTH_AUDIENCE is required for MCP auth initialization.", {
      field: "config.oauth.audience",
    });
  }

  const requiredScopes = normalizeScopes(requiredScopesRaw);
  if (requiredScopes.length === 0) {
    throw new McpAuthInitError("OAUTH_REQUIRED_SCOPES must include at least one scope.", {
      field: "config.oauth.requiredScopes",
    });
  }

  let issuer: string;
  try {
    issuer = new URL(issuerRaw).toString();
  } catch {
    throw new McpAuthInitError("OAUTH_ISSUER must be a valid URL.", {
      field: "config.oauth.issuer",
    });
  }

  let resource: string;
  try {
    resource = new URL(RESOURCE_PATH, publicUrlRaw).toString();
  } catch {
    throw new McpAuthInitError("PUBLIC_URL must be a valid URL for MCP auth initialization.", {
      field: "config.publicUrl",
    });
  }

  return {
    issuer,
    audience,
    resource,
    requiredScopes,
  };
  // END_BLOCK_VALIDATE_AND_RESOLVE_MCP_AUTH_INIT_INPUTS_M_MCP_AUTH_PROVIDER_005
}

// START_CONTRACT: buildProtectedResourceMetadata
//   PURPOSE: Build snake_case OAuth protected resource metadata payload from normalized init values.
//   INPUTS: { resource: string - Protected resource URL, authorizationServerIssuer: string - Trusted auth server issuer URL, requiredScopes: string[] - Normalized required scopes }
//   OUTPUTS: { ProtectedResourceMetadata - Snake_case metadata payload for discovery responses }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-PROVIDER]
// END_CONTRACT: buildProtectedResourceMetadata
function buildProtectedResourceMetadata(
  resource: string,
  authorizationServerIssuer: string,
  requiredScopes: string[],
): ProtectedResourceMetadata {
  // START_BLOCK_BUILD_SNAKE_CASE_RESOURCE_METADATA_PAYLOAD_M_MCP_AUTH_PROVIDER_006
  return {
    resource,
    authorization_servers: [authorizationServerIssuer],
    scopes_supported: [...requiredScopes],
    bearer_methods_supported: [...BEARER_METHODS_SUPPORTED],
  };
  // END_BLOCK_BUILD_SNAKE_CASE_RESOURCE_METADATA_PAYLOAD_M_MCP_AUTH_PROVIDER_006
}

// START_CONTRACT: initMcpAuth
//   PURPOSE: Initialize mcp-auth resource-server context with OIDC discovery, TokenVerifier primitives, and protected resource metadata.
//   INPUTS: { config: AppConfig - Runtime config with OAuth/public settings, logger: Logger|undefined - Optional structured logger }
//   OUTPUTS: { Promise<McpAuthContext> - Initialized auth context for Bun.serve integration }
//   SIDE_EFFECTS: [Performs network fetch to OIDC metadata endpoint, emits structured logs when logger provided, throws McpAuthInitError on failure]
//   LINKS: [M-MCP-AUTH-PROVIDER, M-CONFIG, M-LOGGER]
// END_CONTRACT: initMcpAuth
export async function initMcpAuth(
  config: AppConfig,
  logger?: Logger,
): Promise<McpAuthContext> {
  // START_BLOCK_INITIALIZE_MCP_AUTH_CONTEXT_M_MCP_AUTH_PROVIDER_007
  try {
    const resolvedInputs = resolveInitInputs(config);

    emitProviderLog(
      logger,
      "info",
      "Initializing MCP auth provider with OIDC metadata discovery.",
      "INITIALIZE_MCP_AUTH_CONTEXT",
      {
        issuer: resolvedInputs.issuer,
        audience: resolvedInputs.audience,
        resource: resolvedInputs.resource,
        requiredScopesCount: resolvedInputs.requiredScopes.length,
      },
    );

    const oidcServerConfig = await fetchServerConfig(resolvedInputs.issuer, {
      type: "oidc",
    });

    const protectedResourceDefinition = {
      metadata: {
        resource: resolvedInputs.resource,
        authorizationServers: [oidcServerConfig],
        scopesSupported: resolvedInputs.requiredScopes,
        bearerMethodsSupported: [...BEARER_METHODS_SUPPORTED],
      },
    };

    const mcpAuth = new MCPAuth({
      protectedResources: [protectedResourceDefinition],
    });

    const tokenVerifier = new TokenVerifier([oidcServerConfig]);
    const verifyAccessToken = tokenVerifier.createVerifyJwtFunction({});
    const validateIssuer = tokenVerifier.getJwtIssuerValidator();
    const resourceMetadataUrl = createResourceMetadataEndpoint(resolvedInputs.resource).toString();

    const protectedResourceMetadata = buildProtectedResourceMetadata(
      resolvedInputs.resource,
      oidcServerConfig.metadata.issuer,
      resolvedInputs.requiredScopes,
    );

    emitProviderLog(
      logger,
      "info",
      "MCP auth provider initialized successfully.",
      "INITIALIZE_MCP_AUTH_CONTEXT",
      {
        resourceMetadataUrl,
        trustedIssuer: oidcServerConfig.metadata.issuer,
      },
    );

    return {
      mcpAuth,
      verifyAccessToken,
      validateIssuer,
      resourceMetadataUrl,
      protectedResourceMetadata,
    };
  } catch (error: unknown) {
    const typedError = toMcpAuthInitError(
      error,
      "Failed to initialize MCP auth provider.",
      "initMcpAuth",
    );

    emitProviderLog(
      logger,
      "error",
      "MCP auth provider initialization failed.",
      "INITIALIZE_MCP_AUTH_CONTEXT",
      {
        code: typedError.code,
        details: typedError.details ?? null,
      },
    );

    throw typedError;
  }
  // END_BLOCK_INITIALIZE_MCP_AUTH_CONTEXT_M_MCP_AUTH_PROVIDER_007
}
