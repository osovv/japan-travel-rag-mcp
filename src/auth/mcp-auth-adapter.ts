// FILE: src/auth/mcp-auth-adapter.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Adapt mcp-auth verification to FastMCP authenticate(request) contract and return typed auth session payload for tool execution context.
//   SCOPE: Parse strict Bearer headers from IncomingMessage, verify tokens with McpAuthContext, validate issuer/audience/scopes, throw deterministic 401/403 Response denies, and map unexpected failures to MCP_AUTH_ERROR.
//   DEPENDS: M-MCP-AUTH-PROVIDER, M-CONFIG, M-LOGGER
//   LINKS: M-MCP-AUTH-ADAPTER, M-MCP-AUTH-PROVIDER, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   McpAuthSession - Typed auth session payload passed into FastMCP tool execution context.
//   McpAuthError - Typed adapter internal failure with stable MCP_AUTH_ERROR code and sanitized diagnostics.
//   authenticateFastMcpRequest - FastMCP authenticate hook implementation that returns session or throws denied Response.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Implemented Phase-7 Step-1 FastMCP authenticate adapter with deterministic 401/403 OAuth challenge mapping.
// END_CHANGE_SUMMARY

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { MCPAuthBearerAuthError, MCPAuthTokenVerificationError } from "mcp-auth";
import { BearerWWWAuthenticateHeader } from "mcp-auth/utils/bearer-www-authenticate-header.js";
import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import type { McpAuthContext } from "./mcp-auth-provider";

const BEARER_HEADER_PATTERN = /^Bearer ([^\s]+)$/;
const UNAUTHORIZED_MESSAGE = "Invalid or missing OAuth access token.";
const FORBIDDEN_MESSAGE = "OAuth access token does not include required scopes.";

type McpAuthErrorDetails = {
  field?: string;
  cause?: string;
};

type McpAuthAdapterDependencies = {
  authContext: McpAuthContext;
  config: AppConfig;
  logger: Logger;
};

type ParsedAuthorizationHeaderResult =
  | {
      isValid: true;
      token: string;
      tokenLength: number;
    }
  | {
      isValid: false;
      reason: "MISSING_AUTH_HEADER" | "INVALID_AUTH_SCHEME";
      tokenLength: number;
    };

type McpAuthAdapterValidationContext = {
  audience: string;
  requiredScopes: string[];
  resource?: string;
  resourceMetadataUrl: string;
};

type DeniedResponseOptions = {
  status: 401 | 403;
  error?: "invalid_token" | "insufficient_scope";
  errorDescription?: string;
  requiredScopes?: string[];
  resource?: string;
  resourceMetadataUrl: string;
};

export type McpAuthSession = {
  audience?: string | string[];
  claims?: Record<string, unknown>;
  clientId?: string;
  expiresAt?: number;
  grantedScopes: string[];
  issuer: string;
  subject?: string;
};

export class McpAuthError extends Error {
  public readonly code = "MCP_AUTH_ERROR" as const;
  public readonly details?: McpAuthErrorDetails;

  public constructor(message: string, details?: McpAuthErrorDetails) {
    super(message);
    this.name = "McpAuthError";
    this.details = details;
  }
}

// START_CONTRACT: redactSensitiveDiagnostics
//   PURPOSE: Redact token-like values from diagnostics before attaching to logs or typed internal errors.
//   INPUTS: { text: string - Raw diagnostic text }
//   OUTPUTS: { string - Sanitized diagnostic text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: redactSensitiveDiagnostics
function redactSensitiveDiagnostics(text: string): string {
  // START_BLOCK_REDACT_SENSITIVE_DIAGNOSTICS_M_MCP_AUTH_ADAPTER_001
  const normalized = text.trim();
  if (!normalized) {
    return "unknown";
  }

  const redacted = normalized
    .replace(/\b[Bb]earer\s+[A-Za-z0-9\-._~+/]+=*/g, "Bearer <redacted-token>")
    .replace(/[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, "<redacted-jwt>")
    .replace(/\b[a-f0-9]{32,}\b/gi, "<redacted-digest>");

  return redacted.length > 240 ? `${redacted.slice(0, 240)}...` : redacted;
  // END_BLOCK_REDACT_SENSITIVE_DIAGNOSTICS_M_MCP_AUTH_ADAPTER_001
}

// START_CONTRACT: toMcpAuthError
//   PURPOSE: Convert unknown runtime failures to sanitized typed MCP_AUTH_ERROR values.
//   INPUTS: { error: unknown - Runtime failure, message: string - Stable error message, details: McpAuthErrorDetails|undefined - Optional error details }
//   OUTPUTS: { McpAuthError - Typed internal auth adapter error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: toMcpAuthError
function toMcpAuthError(
  error: unknown,
  message: string,
  details?: McpAuthErrorDetails,
): McpAuthError {
  // START_BLOCK_MAP_UNKNOWN_FAILURE_TO_TYPED_MCP_AUTH_ERROR_M_MCP_AUTH_ADAPTER_002
  if (error instanceof McpAuthError) {
    return error;
  }

  const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new McpAuthError(message, {
    ...details,
    cause: redactSensitiveDiagnostics(cause),
  });
  // END_BLOCK_MAP_UNKNOWN_FAILURE_TO_TYPED_MCP_AUTH_ERROR_M_MCP_AUTH_ADAPTER_002
}

// START_CONTRACT: normalizeOptionalText
//   PURPOSE: Normalize optional text values by trimming and coercing empty text to undefined.
//   INPUTS: { value: unknown - Candidate text value }
//   OUTPUTS: { string|undefined - Normalized optional text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: normalizeOptionalText
function normalizeOptionalText(value: unknown): string | undefined {
  // START_BLOCK_NORMALIZE_OPTIONAL_TEXT_VALUES_M_MCP_AUTH_ADAPTER_003
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
  // END_BLOCK_NORMALIZE_OPTIONAL_TEXT_VALUES_M_MCP_AUTH_ADAPTER_003
}

// START_CONTRACT: normalizeScopes
//   PURPOSE: Normalize scope arrays by trimming values, removing empties, and deduplicating in first-seen order.
//   INPUTS: { scopes: readonly string[] - Candidate scope list }
//   OUTPUTS: { string[] - Deterministic normalized scope list }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: normalizeScopes
function normalizeScopes(scopes: readonly string[]): string[] {
  // START_BLOCK_NORMALIZE_SCOPE_COLLECTION_M_MCP_AUTH_ADAPTER_004
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
  // END_BLOCK_NORMALIZE_SCOPE_COLLECTION_M_MCP_AUTH_ADAPTER_004
}

// START_CONTRACT: extractGrantedScopes
//   PURPOSE: Read granted scopes from AuthInfo in a resilient way and return a normalized scope list.
//   INPUTS: { authInfo: AuthInfo - Verified auth payload from mcp-auth }
//   OUTPUTS: { string[] - Normalized granted scopes }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: extractGrantedScopes
function extractGrantedScopes(authInfo: AuthInfo): string[] {
  // START_BLOCK_EXTRACT_GRANTED_SCOPES_FROM_AUTH_INFO_M_MCP_AUTH_ADAPTER_005
  const directScopes = Array.isArray(authInfo.scopes) ? authInfo.scopes : [];
  if (directScopes.length > 0) {
    return normalizeScopes(directScopes);
  }

  const claims = authInfo.claims;
  if (!claims || typeof claims !== "object") {
    return [];
  }

  const claimScope = (claims as Record<string, unknown>)["scope"];
  if (typeof claimScope === "string") {
    return normalizeScopes(claimScope.split(/\s+/));
  }

  const claimScopes = (claims as Record<string, unknown>)["scopes"];
  if (Array.isArray(claimScopes)) {
    return normalizeScopes(claimScopes.filter((value): value is string => typeof value === "string"));
  }

  return [];
  // END_BLOCK_EXTRACT_GRANTED_SCOPES_FROM_AUTH_INFO_M_MCP_AUTH_ADAPTER_005
}

// START_CONTRACT: parseAuthorizationHeader
//   PURPOSE: Parse Authorization header from IncomingMessage headers using strict Bearer token format.
//   INPUTS: { authorizationHeader: string|string[]|undefined - Incoming Authorization header value }
//   OUTPUTS: { ParsedAuthorizationHeaderResult - Parsed token or deny reason }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: parseAuthorizationHeader
function parseAuthorizationHeader(
  authorizationHeader: string | string[] | undefined,
): ParsedAuthorizationHeaderResult {
  // START_BLOCK_PARSE_STRICT_BEARER_AUTHORIZATION_HEADER_M_MCP_AUTH_ADAPTER_006
  if (typeof authorizationHeader === "undefined") {
    return {
      isValid: false,
      reason: "MISSING_AUTH_HEADER",
      tokenLength: 0,
    };
  }

  let rawHeaderValue: string;

  if (Array.isArray(authorizationHeader)) {
    if (authorizationHeader.length === 0) {
      return {
        isValid: false,
        reason: "MISSING_AUTH_HEADER",
        tokenLength: 0,
      };
    }

    if (authorizationHeader.length !== 1 || typeof authorizationHeader[0] !== "string") {
      return {
        isValid: false,
        reason: "INVALID_AUTH_SCHEME",
        tokenLength: authorizationHeader.join(",").length,
      };
    }

    rawHeaderValue = authorizationHeader[0];
  } else {
    rawHeaderValue = authorizationHeader;
  }

  const match = BEARER_HEADER_PATTERN.exec(rawHeaderValue);
  if (!match || !match[1]) {
    return {
      isValid: false,
      reason: "INVALID_AUTH_SCHEME",
      tokenLength: rawHeaderValue.length,
    };
  }

  return {
    isValid: true,
    token: match[1],
    tokenLength: match[1].length,
  };
  // END_BLOCK_PARSE_STRICT_BEARER_AUTHORIZATION_HEADER_M_MCP_AUTH_ADAPTER_006
}

// START_CONTRACT: isInvalidHeaderParseResult
//   PURPOSE: Narrow parsed header result to invalid-header variant for deterministic deny handling.
//   INPUTS: { result: ParsedAuthorizationHeaderResult - Parsed Authorization header result }
//   OUTPUTS: { result is Extract<ParsedAuthorizationHeaderResult, { isValid: false }> - True when header parsing failed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: isInvalidHeaderParseResult
function isInvalidHeaderParseResult(
  result: ParsedAuthorizationHeaderResult,
): result is Extract<ParsedAuthorizationHeaderResult, { isValid: false }> {
  // START_BLOCK_NARROW_INVALID_HEADER_PARSE_RESULT_M_MCP_AUTH_ADAPTER_007
  return !result.isValid;
  // END_BLOCK_NARROW_INVALID_HEADER_PARSE_RESULT_M_MCP_AUTH_ADAPTER_007
}

// START_CONTRACT: assertDependencies
//   PURPOSE: Validate adapter dependency contract before authentication logic runs.
//   INPUTS: { dependencies: McpAuthAdapterDependencies - Runtime adapter dependencies }
//   OUTPUTS: { void - Throws on invalid dependency contract }
//   SIDE_EFFECTS: [Throws McpAuthError when dependency contract is invalid]
//   LINKS: [M-MCP-AUTH-ADAPTER, M-MCP-AUTH-PROVIDER, M-CONFIG, M-LOGGER]
// END_CONTRACT: assertDependencies
function assertDependencies(dependencies: McpAuthAdapterDependencies): void {
  // START_BLOCK_VALIDATE_ADAPTER_DEPENDENCY_CONTRACT_M_MCP_AUTH_ADAPTER_008
  if (!dependencies || typeof dependencies !== "object") {
    throw new McpAuthError("MCP auth adapter dependencies are required.", {
      field: "dependencies",
    });
  }

  if (
    !dependencies.authContext ||
    typeof dependencies.authContext.verifyAccessToken !== "function" ||
    typeof dependencies.authContext.validateIssuer !== "function"
  ) {
    throw new McpAuthError("MCP auth adapter requires authContext verify/validate functions.", {
      field: "authContext",
    });
  }

  if (typeof dependencies.authContext.resourceMetadataUrl !== "string") {
    throw new McpAuthError("MCP auth adapter requires authContext.resourceMetadataUrl.", {
      field: "authContext.resourceMetadataUrl",
    });
  }

  if (
    !dependencies.config ||
    !dependencies.config.oauth ||
    typeof dependencies.config.oauth.audience !== "string" ||
    !Array.isArray(dependencies.config.oauth.requiredScopes)
  ) {
    throw new McpAuthError("MCP auth adapter requires config.oauth audience and requiredScopes.", {
      field: "config.oauth",
    });
  }

  if (
    !dependencies.logger ||
    typeof dependencies.logger.info !== "function" ||
    typeof dependencies.logger.warn !== "function" ||
    typeof dependencies.logger.error !== "function"
  ) {
    throw new McpAuthError("MCP auth adapter requires logger dependency.", {
      field: "logger",
    });
  }
  // END_BLOCK_VALIDATE_ADAPTER_DEPENDENCY_CONTRACT_M_MCP_AUTH_ADAPTER_008
}

// START_CONTRACT: resolveValidationContext
//   PURPOSE: Build normalized audience/scope/metadata context used for token checks and challenge generation.
//   INPUTS: { dependencies: McpAuthAdapterDependencies - Runtime adapter dependencies }
//   OUTPUTS: { McpAuthAdapterValidationContext - Normalized validation context }
//   SIDE_EFFECTS: [Throws McpAuthError when config/auth metadata values are invalid]
//   LINKS: [M-MCP-AUTH-ADAPTER, M-CONFIG, M-MCP-AUTH-PROVIDER]
// END_CONTRACT: resolveValidationContext
function resolveValidationContext(
  dependencies: McpAuthAdapterDependencies,
): McpAuthAdapterValidationContext {
  // START_BLOCK_RESOLVE_NORMALIZED_AUTH_VALIDATION_CONTEXT_M_MCP_AUTH_ADAPTER_009
  const audience = dependencies.config.oauth.audience.trim();
  if (!audience) {
    throw new McpAuthError("MCP auth adapter audience must be a non-empty string.", {
      field: "config.oauth.audience",
    });
  }

  const requiredScopes = normalizeScopes(dependencies.config.oauth.requiredScopes);
  if (requiredScopes.length === 0) {
    throw new McpAuthError("MCP auth adapter required scopes must include at least one value.", {
      field: "config.oauth.requiredScopes",
    });
  }

  const resourceMetadataUrl = normalizeOptionalText(dependencies.authContext.resourceMetadataUrl);
  if (!resourceMetadataUrl) {
    throw new McpAuthError("MCP auth adapter resourceMetadataUrl must be configured.", {
      field: "authContext.resourceMetadataUrl",
    });
  }

  return {
    audience,
    requiredScopes,
    resource: normalizeOptionalText(dependencies.authContext.protectedResourceMetadata.resource),
    resourceMetadataUrl,
  };
  // END_BLOCK_RESOLVE_NORMALIZED_AUTH_VALIDATION_CONTEXT_M_MCP_AUTH_ADAPTER_009
}

// START_CONTRACT: createBearerChallengeValue
//   PURPOSE: Build Bearer WWW-Authenticate header value using mcp-auth utility and deterministic parameter ordering.
//   INPUTS: { options: DeniedResponseOptions - Challenge field values }
//   OUTPUTS: { string - Header value for WWW-Authenticate }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: createBearerChallengeValue
function createBearerChallengeValue(options: DeniedResponseOptions): string {
  // START_BLOCK_BUILD_BEARER_CHALLENGE_VALUE_M_MCP_AUTH_ADAPTER_010
  const header = new BearerWWWAuthenticateHeader()
    .setParameterIfValueExists("resource_metadata", options.resourceMetadataUrl)
    .setParameterIfValueExists("error", options.error)
    .setParameterIfValueExists("error_description", options.errorDescription)
    .setParameterIfValueExists("scope", normalizeScopes(options.requiredScopes ?? []).join(" "))
    .setParameterIfValueExists("resource", normalizeOptionalText(options.resource));

  return header.toString() || "Bearer";
  // END_BLOCK_BUILD_BEARER_CHALLENGE_VALUE_M_MCP_AUTH_ADAPTER_010
}

// START_CONTRACT: createDeniedResponse
//   PURPOSE: Build deterministic 401/403 denied Response with JSON body and WWW-Authenticate challenge header.
//   INPUTS: { options: DeniedResponseOptions - Deny response options including challenge parameters }
//   OUTPUTS: { Response - Ready-to-throw denied response for FastMCP authenticate hook }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: createDeniedResponse
function createDeniedResponse(options: DeniedResponseOptions): Response {
  // START_BLOCK_CREATE_DETERMINISTIC_DENIED_AUTH_RESPONSE_M_MCP_AUTH_ADAPTER_011
  const challenge = createBearerChallengeValue(options);
  const code = options.status === 403 ? "FORBIDDEN" : "UNAUTHORIZED";
  const message = options.status === 403 ? FORBIDDEN_MESSAGE : UNAUTHORIZED_MESSAGE;

  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
      },
    }),
    {
      status: options.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "www-authenticate": challenge,
      },
    },
  );
  // END_BLOCK_CREATE_DETERMINISTIC_DENIED_AUTH_RESPONSE_M_MCP_AUTH_ADAPTER_011
}

// START_CONTRACT: validateAudience
//   PURPOSE: Validate authInfo audience against configured audience and throw mcp-auth bearer error on mismatch.
//   INPUTS: { authInfo: AuthInfo - Verified token auth info, expectedAudience: string - Configured OAuth audience }
//   OUTPUTS: { void - Throws when audience is invalid }
//   SIDE_EFFECTS: [Throws MCPAuthBearerAuthError("invalid_audience")]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: validateAudience
function validateAudience(authInfo: AuthInfo, expectedAudience: string): void {
  // START_BLOCK_VALIDATE_TOKEN_AUDIENCE_M_MCP_AUTH_ADAPTER_012
  const audience = authInfo.audience;

  if (typeof audience === "string" && audience === expectedAudience) {
    return;
  }

  if (Array.isArray(audience) && audience.includes(expectedAudience)) {
    return;
  }

  throw new MCPAuthBearerAuthError("invalid_audience", {
    expected: expectedAudience,
    actual: audience,
  });
  // END_BLOCK_VALIDATE_TOKEN_AUDIENCE_M_MCP_AUTH_ADAPTER_012
}

// START_CONTRACT: validateRequiredScopes
//   PURPOSE: Validate that token scopes include all required scopes and throw mcp-auth bearer error when missing.
//   INPUTS: { grantedScopes: string[] - Scopes granted by token, requiredScopes: string[] - Required scopes from config }
//   OUTPUTS: { void - Throws when required scopes are missing }
//   SIDE_EFFECTS: [Throws MCPAuthBearerAuthError("missing_required_scopes")]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: validateRequiredScopes
function validateRequiredScopes(grantedScopes: string[], requiredScopes: string[]): void {
  // START_BLOCK_VALIDATE_REQUIRED_SCOPE_SET_M_MCP_AUTH_ADAPTER_013
  const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope));
  if (missingScopes.length === 0) {
    return;
  }

  throw new MCPAuthBearerAuthError("missing_required_scopes", {
    missingScopes,
  });
  // END_BLOCK_VALIDATE_REQUIRED_SCOPE_SET_M_MCP_AUTH_ADAPTER_013
}

// START_CONTRACT: mapKnownAuthErrorToDeniedResponse
//   PURPOSE: Map known mcp-auth auth errors to deterministic denied Responses for FastMCP authenticate hook.
//   INPUTS: { error: unknown - Runtime auth failure, context: McpAuthAdapterValidationContext - Normalized validation context }
//   OUTPUTS: { Response|undefined - Denied response for known errors, undefined for internal failures }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: mapKnownAuthErrorToDeniedResponse
function mapKnownAuthErrorToDeniedResponse(
  error: unknown,
  context: McpAuthAdapterValidationContext,
): Response | undefined {
  // START_BLOCK_MAP_KNOWN_MCP_AUTH_ERRORS_TO_DENIED_RESPONSE_M_MCP_AUTH_ADAPTER_014
  if (error instanceof MCPAuthTokenVerificationError) {
    return createDeniedResponse({
      status: 401,
      error: "invalid_token",
      errorDescription: "OAuth access token verification failed.",
      resource: context.resource,
      resourceMetadataUrl: context.resourceMetadataUrl,
    });
  }

  if (error instanceof MCPAuthBearerAuthError) {
    if (error.code === "missing_required_scopes") {
      return createDeniedResponse({
        status: 403,
        error: "insufficient_scope",
        errorDescription: "OAuth access token is missing required scopes.",
        requiredScopes: context.requiredScopes,
        resource: context.resource,
        resourceMetadataUrl: context.resourceMetadataUrl,
      });
    }

    if (error.code === "invalid_issuer") {
      return createDeniedResponse({
        status: 401,
        error: "invalid_token",
        errorDescription: "OAuth access token issuer is not trusted.",
        resource: context.resource,
        resourceMetadataUrl: context.resourceMetadataUrl,
      });
    }

    if (error.code === "invalid_audience") {
      return createDeniedResponse({
        status: 401,
        error: "invalid_token",
        errorDescription: "OAuth access token audience is invalid for this resource.",
        resource: context.resource,
        resourceMetadataUrl: context.resourceMetadataUrl,
      });
    }

    return createDeniedResponse({
      status: 401,
      error: "invalid_token",
      errorDescription: "OAuth access token is invalid.",
      resource: context.resource,
      resourceMetadataUrl: context.resourceMetadataUrl,
    });
  }

  return undefined;
  // END_BLOCK_MAP_KNOWN_MCP_AUTH_ERRORS_TO_DENIED_RESPONSE_M_MCP_AUTH_ADAPTER_014
}

// START_CONTRACT: buildAuthSession
//   PURPOSE: Build typed McpAuthSession payload from verified AuthInfo with token-safe fields only.
//   INPUTS: { authInfo: AuthInfo - Verified auth info, issuer: string - Trusted issuer value, grantedScopes: string[] - Normalized scopes }
//   OUTPUTS: { McpAuthSession - Typed FastMCP session payload for tool context }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-ADAPTER]
// END_CONTRACT: buildAuthSession
function buildAuthSession(
  authInfo: AuthInfo,
  issuer: string,
  grantedScopes: string[],
): McpAuthSession {
  // START_BLOCK_BUILD_TYPED_FASTMCP_AUTH_SESSION_M_MCP_AUTH_ADAPTER_015
  const claims =
    authInfo.claims && typeof authInfo.claims === "object"
      ? (authInfo.claims as Record<string, unknown>)
      : undefined;

  const audience =
    typeof authInfo.audience === "string" || Array.isArray(authInfo.audience)
      ? authInfo.audience
      : undefined;

  const expiresAt =
    typeof authInfo.expiresAt === "number" && Number.isFinite(authInfo.expiresAt)
      ? authInfo.expiresAt
      : undefined;

  return {
    audience,
    claims,
    clientId: normalizeOptionalText(authInfo.clientId),
    expiresAt,
    grantedScopes: [...grantedScopes],
    issuer,
    subject: normalizeOptionalText(authInfo.subject),
  };
  // END_BLOCK_BUILD_TYPED_FASTMCP_AUTH_SESSION_M_MCP_AUTH_ADAPTER_015
}

// START_CONTRACT: authenticateFastMcpRequest
//   PURPOSE: Authenticate FastMCP IncomingMessage request via mcp-auth verify/validate checks and return typed session for tool context.
//   INPUTS: { request: IncomingMessage - FastMCP incoming request, deps: { authContext: McpAuthContext; config: AppConfig; logger: Logger } - Adapter dependencies }
//   OUTPUTS: { Promise<McpAuthSession> - Typed authenticated session payload }
//   SIDE_EFFECTS: [Emits auth logs; throws denied Response for auth failures; throws McpAuthError for internal failures]
//   LINKS: [M-MCP-AUTH-ADAPTER, M-MCP-AUTH-PROVIDER, M-CONFIG, M-LOGGER]
// END_CONTRACT: authenticateFastMcpRequest
export async function authenticateFastMcpRequest(
  request: IncomingMessage,
  deps: {
    authContext: McpAuthContext;
    config: AppConfig;
    logger: Logger;
  },
): Promise<McpAuthSession> {
  // START_BLOCK_AUTHENTICATE_FASTMCP_INCOMING_REQUEST_M_MCP_AUTH_ADAPTER_016
  assertDependencies(deps);
  const validationContext = resolveValidationContext(deps);

  const parsedAuthorizationHeader = parseAuthorizationHeader(request.headers.authorization);
  if (isInvalidHeaderParseResult(parsedAuthorizationHeader)) {
    deps.logger.warn(
      "Rejected FastMCP request due to missing or invalid Authorization header.",
      "authenticateFastMcpRequest",
      "AUTHENTICATE_FASTMCP_INCOMING_REQUEST",
      {
        reason: parsedAuthorizationHeader.reason,
        tokenLength: parsedAuthorizationHeader.tokenLength,
      },
    );

    throw createDeniedResponse({
      status: 401,
      resource: validationContext.resource,
      resourceMetadataUrl: validationContext.resourceMetadataUrl,
    });
  }

  try {
    const authInfo = await deps.authContext.verifyAccessToken(parsedAuthorizationHeader.token);
    const tokenIssuer = normalizeOptionalText(authInfo.issuer);

    if (!tokenIssuer) {
      throw new MCPAuthBearerAuthError("invalid_issuer", {
        expected: "configured issuer",
        actual: authInfo.issuer,
      });
    }

    deps.authContext.validateIssuer(tokenIssuer);
    validateAudience(authInfo, validationContext.audience);

    const grantedScopes = extractGrantedScopes(authInfo);
    validateRequiredScopes(grantedScopes, validationContext.requiredScopes);

    const session = buildAuthSession(authInfo, tokenIssuer, grantedScopes);

    deps.logger.info(
      "Authenticated FastMCP request via mcp-auth context.",
      "authenticateFastMcpRequest",
      "AUTHENTICATE_FASTMCP_INCOMING_REQUEST",
      {
        grantedScopes,
        subject: session.subject ?? null,
      },
    );

    return session;
  } catch (error: unknown) {
    const deniedResponse = mapKnownAuthErrorToDeniedResponse(error, validationContext);
    if (deniedResponse) {
      const denyReason =
        error instanceof MCPAuthTokenVerificationError || error instanceof MCPAuthBearerAuthError
          ? error.code
          : "unknown";

      deps.logger.warn(
        "Rejected FastMCP request due to OAuth authorization failure.",
        "authenticateFastMcpRequest",
        "AUTHENTICATE_FASTMCP_INCOMING_REQUEST",
        {
          reason: denyReason,
          tokenLength: parsedAuthorizationHeader.tokenLength,
        },
      );

      throw deniedResponse;
    }

    const typedError = toMcpAuthError(
      error,
      "Failed to authenticate FastMCP request via mcp-auth context.",
      {
        field: "authContext.verifyAccessToken|authContext.validateIssuer",
      },
    );

    deps.logger.error(
      "MCP auth adapter encountered internal failure during FastMCP authentication.",
      "authenticateFastMcpRequest",
      "AUTHENTICATE_FASTMCP_INCOMING_REQUEST",
      {
        code: typedError.code,
        details: typedError.details ?? null,
      },
    );

    throw typedError;
  }
  // END_BLOCK_AUTHENTICATE_FASTMCP_INCOMING_REQUEST_M_MCP_AUTH_ADAPTER_016
}
