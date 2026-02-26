// FILE: src/auth/mcp-auth-guard.ts
// VERSION: 3.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Authorize /mcp requests via mcp-auth-native token verification and return allow/deny decisions with ready HTTP responses.
//   SCOPE: Parse strict Bearer headers from Request, verify tokens using McpAuthContext, validate issuer/audience/scopes, build RFC 6750 WWW-Authenticate challenges via mcp-auth utility, and map unexpected failures to MCP_AUTH_ERROR.
//   DEPENDS: M-MCP-AUTH-PROVIDER, M-LOGGER
//   LINKS: M-MCP-AUTH-GUARD, M-MCP-AUTH-PROVIDER, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   McpAuthError - Typed auth guard internal failure with stable MCP_AUTH_ERROR code and sanitized diagnostics.
//   McpAuthDecision - Allow/deny decision envelope where deny branch contains ready-to-send HTTP Response.
//   createInitialMcpChallenge - Build 401 Bearer challenge containing resource_metadata for unauthenticated requests.
//   createDeniedResponse - Build 401/403 auth deny responses with BearerWWWAuthenticateHeader.
//   authorizeMcpRequest - Request-based auth guard that verifies token, issuer, audience, and required scopes using McpAuthContext.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v3.0.0 - Migrated guard to McpAuthContext + BearerWWWAuthenticateHeader with Request-based API and response-ready deny decisions.
// END_CHANGE_SUMMARY

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { MCPAuthBearerAuthError, MCPAuthTokenVerificationError } from "mcp-auth";
import { BearerWWWAuthenticateHeader } from "mcp-auth/utils/bearer-www-authenticate-header.js";
import type { Logger } from "../logger/index";
import type { McpAuthContext } from "./mcp-auth-provider";

const BEARER_HEADER_PATTERN = /^Bearer ([^\s]+)$/;
const UNAUTHORIZED_MESSAGE = "Invalid or missing OAuth access token.";
const FORBIDDEN_MESSAGE = "OAuth access token does not include required scopes.";

type McpAuthErrorDetails = {
  field?: string;
  cause?: string;
};

type ParsedAuthorizationHeaderResult =
  | {
      isValid: true;
      token: string;
      tokenLength: number;
    }
  | {
      isValid: false;
      reason: Extract<McpAuthDenyReason, "MISSING_AUTH_HEADER" | "INVALID_AUTH_SCHEME">;
      tokenLength: number;
    };

type McpAuthValidationContext = {
  audience: string;
  requiredScopes: string[];
  resource?: string;
  resourceMetadataUrl: string;
};

export type McpAuthDenyReason =
  | "MISSING_AUTH_HEADER"
  | "INVALID_AUTH_SCHEME"
  | "INVALID_TOKEN"
  | "INVALID_ISSUER"
  | "INVALID_AUDIENCE"
  | "INSUFFICIENT_SCOPE";

export type McpAuthAuthorizedResult = {
  isAuthorized: true;
  authInfo: AuthInfo;
  subject?: string;
  grantedScopes: string[];
};

export type McpAuthDeniedResult = {
  isAuthorized: false;
  reason: McpAuthDenyReason;
  response: Response;
};

export type McpAuthDecision = McpAuthAuthorizedResult | McpAuthDeniedResult;

export type McpAuthGuardDependencies = {
  authContext: McpAuthContext;
  audience: string;
  requiredScopes: string[];
  logger: Logger;
};

type DeniedResponseOptions = {
  status: 401 | 403;
  error?: "invalid_request" | "invalid_token" | "insufficient_scope";
  errorDescription?: string;
  requiredScopes?: string[];
  resource?: string;
  resourceMetadataUrl: string;
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
//   PURPOSE: Redact token-like content from diagnostic text before logging or storing in typed errors.
//   INPUTS: { text: string - Raw diagnostic text }
//   OUTPUTS: { string - Sanitized diagnostic text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: redactSensitiveDiagnostics
function redactSensitiveDiagnostics(text: string): string {
  // START_BLOCK_REDACT_SENSITIVE_DIAGNOSTICS_M_MCP_AUTH_GUARD_001
  const normalized = text.trim();
  if (!normalized) {
    return "unknown";
  }

  const redacted = normalized
    .replace(/\b[Bb]earer\s+[A-Za-z0-9\-._~+/]+=*/g, "Bearer <redacted-token>")
    .replace(/[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, "<redacted-jwt>")
    .replace(/\b[a-f0-9]{32,}\b/gi, "<redacted-digest>");

  return redacted.length > 240 ? `${redacted.slice(0, 240)}...` : redacted;
  // END_BLOCK_REDACT_SENSITIVE_DIAGNOSTICS_M_MCP_AUTH_GUARD_001
}

// START_CONTRACT: toMcpAuthError
//   PURPOSE: Normalize unknown failures into sanitized McpAuthError values for internal-error propagation.
//   INPUTS: { error: unknown - Runtime failure, message: string - Stable message, details: McpAuthErrorDetails|undefined - Optional context details }
//   OUTPUTS: { McpAuthError - Typed internal error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: toMcpAuthError
function toMcpAuthError(
  error: unknown,
  message: string,
  details?: McpAuthErrorDetails,
): McpAuthError {
  // START_BLOCK_MAP_UNKNOWN_FAILURE_TO_TYPED_GUARD_ERROR_M_MCP_AUTH_GUARD_002
  if (error instanceof McpAuthError) {
    return error;
  }

  const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new McpAuthError(message, {
    ...details,
    cause: redactSensitiveDiagnostics(cause),
  });
  // END_BLOCK_MAP_UNKNOWN_FAILURE_TO_TYPED_GUARD_ERROR_M_MCP_AUTH_GUARD_002
}

// START_CONTRACT: normalizeOptionalText
//   PURPOSE: Normalize optional string-like values by trimming and coercing empties to undefined.
//   INPUTS: { value: unknown - Candidate text value }
//   OUTPUTS: { string|undefined - Normalized value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: normalizeOptionalText
function normalizeOptionalText(value: unknown): string | undefined {
  // START_BLOCK_NORMALIZE_OPTIONAL_TEXT_VALUES_M_MCP_AUTH_GUARD_003
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
  // END_BLOCK_NORMALIZE_OPTIONAL_TEXT_VALUES_M_MCP_AUTH_GUARD_003
}

// START_CONTRACT: normalizeScopes
//   PURPOSE: Normalize scope lists by trimming, dropping empties, and deduplicating while preserving first-seen ordering.
//   INPUTS: { scopes: readonly string[] - Raw scopes }
//   OUTPUTS: { string[] - Deterministic unique scopes }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: normalizeScopes
function normalizeScopes(scopes: readonly string[]): string[] {
  // START_BLOCK_NORMALIZE_SCOPE_COLLECTION_M_MCP_AUTH_GUARD_004
  const uniqueScopes: string[] = [];
  const seen = new Set<string>();

  for (const scope of scopes) {
    const normalizedScope = scope.trim();
    if (!normalizedScope || seen.has(normalizedScope)) {
      continue;
    }
    seen.add(normalizedScope);
    uniqueScopes.push(normalizedScope);
  }

  return uniqueScopes;
  // END_BLOCK_NORMALIZE_SCOPE_COLLECTION_M_MCP_AUTH_GUARD_004
}

// START_CONTRACT: extractGrantedScopes
//   PURPOSE: Extract granted scopes from AuthInfo in a resilient way and normalize them.
//   INPUTS: { authInfo: AuthInfo - Verified auth payload from mcp-auth }
//   OUTPUTS: { string[] - Normalized granted scopes }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: extractGrantedScopes
function extractGrantedScopes(authInfo: AuthInfo): string[] {
  // START_BLOCK_EXTRACT_GRANTED_SCOPES_FROM_AUTH_INFO_M_MCP_AUTH_GUARD_005
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
  // END_BLOCK_EXTRACT_GRANTED_SCOPES_FROM_AUTH_INFO_M_MCP_AUTH_GUARD_005
}

// START_CONTRACT: parseAuthorizationHeader
//   PURPOSE: Parse strict Bearer Authorization header value into token or header-deny reason.
//   INPUTS: { authorizationHeader: string|null - Incoming Authorization header }
//   OUTPUTS: { ParsedAuthorizationHeaderResult - Parsed token or deny reason }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: parseAuthorizationHeader
function parseAuthorizationHeader(authorizationHeader: string | null): ParsedAuthorizationHeaderResult {
  // START_BLOCK_PARSE_STRICT_BEARER_HEADER_M_MCP_AUTH_GUARD_006
  if (authorizationHeader === null) {
    return {
      isValid: false,
      reason: "MISSING_AUTH_HEADER",
      tokenLength: 0,
    };
  }

  const match = BEARER_HEADER_PATTERN.exec(authorizationHeader);
  if (!match || !match[1]) {
    return {
      isValid: false,
      reason: "INVALID_AUTH_SCHEME",
      tokenLength: authorizationHeader.length,
    };
  }

  return {
    isValid: true,
    token: match[1],
    tokenLength: match[1].length,
  };
  // END_BLOCK_PARSE_STRICT_BEARER_HEADER_M_MCP_AUTH_GUARD_006
}

// START_CONTRACT: isInvalidHeaderParseResult
//   PURPOSE: Narrow parsed header union to invalid-header variant for safe deny-reason access.
//   INPUTS: { result: ParsedAuthorizationHeaderResult - Parsed Authorization header result }
//   OUTPUTS: { result is Extract<ParsedAuthorizationHeaderResult, { isValid: false }> - True when header is invalid }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: isInvalidHeaderParseResult
function isInvalidHeaderParseResult(
  result: ParsedAuthorizationHeaderResult,
): result is Extract<ParsedAuthorizationHeaderResult, { isValid: false }> {
  // START_BLOCK_NARROW_INVALID_HEADER_PARSE_RESULT_M_MCP_AUTH_GUARD_016
  return !result.isValid;
  // END_BLOCK_NARROW_INVALID_HEADER_PARSE_RESULT_M_MCP_AUTH_GUARD_016
}

// START_CONTRACT: assertDependencies
//   PURPOSE: Validate dependency contract for guard wiring before authorization logic runs.
//   INPUTS: { dependencies: McpAuthGuardDependencies - Guard dependencies }
//   OUTPUTS: { void - Throws on invalid dependency contract }
//   SIDE_EFFECTS: [Throws McpAuthError when dependency contract is invalid]
//   LINKS: [M-MCP-AUTH-GUARD, M-MCP-AUTH-PROVIDER, M-LOGGER]
// END_CONTRACT: assertDependencies
function assertDependencies(dependencies: McpAuthGuardDependencies): void {
  // START_BLOCK_VALIDATE_GUARD_DEPENDENCY_CONTRACT_M_MCP_AUTH_GUARD_007
  if (!dependencies || typeof dependencies !== "object") {
    throw new McpAuthError("MCP auth guard dependencies are required.", {
      field: "dependencies",
    });
  }

  if (
    !dependencies.authContext ||
    typeof dependencies.authContext.verifyAccessToken !== "function" ||
    typeof dependencies.authContext.validateIssuer !== "function"
  ) {
    throw new McpAuthError("MCP auth guard requires authContext verify/validate functions.", {
      field: "authContext",
    });
  }

  if (typeof dependencies.authContext.resourceMetadataUrl !== "string") {
    throw new McpAuthError("MCP auth guard requires authContext.resourceMetadataUrl.", {
      field: "authContext.resourceMetadataUrl",
    });
  }

  if (!Array.isArray(dependencies.requiredScopes)) {
    throw new McpAuthError("MCP auth guard requires requiredScopes array.", {
      field: "requiredScopes",
    });
  }

  if (typeof dependencies.audience !== "string") {
    throw new McpAuthError("MCP auth guard requires audience string.", {
      field: "audience",
    });
  }

  if (
    !dependencies.logger ||
    typeof dependencies.logger.info !== "function" ||
    typeof dependencies.logger.warn !== "function" ||
    typeof dependencies.logger.error !== "function"
  ) {
    throw new McpAuthError("MCP auth guard requires logger dependency.", {
      field: "logger",
    });
  }
  // END_BLOCK_VALIDATE_GUARD_DEPENDENCY_CONTRACT_M_MCP_AUTH_GUARD_007
}

// START_CONTRACT: resolveValidationContext
//   PURPOSE: Build normalized validation context for audience/scope checks and challenge metadata generation.
//   INPUTS: { dependencies: McpAuthGuardDependencies - Guard dependencies }
//   OUTPUTS: { McpAuthValidationContext - Normalized validation context }
//   SIDE_EFFECTS: [Throws McpAuthError when audience/scopes are invalid]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: resolveValidationContext
function resolveValidationContext(dependencies: McpAuthGuardDependencies): McpAuthValidationContext {
  // START_BLOCK_BUILD_NORMALIZED_VALIDATION_CONTEXT_M_MCP_AUTH_GUARD_008
  const audience = dependencies.audience.trim();
  if (!audience) {
    throw new McpAuthError("MCP auth guard audience must be a non-empty string.", {
      field: "audience",
    });
  }

  const requiredScopes = normalizeScopes(dependencies.requiredScopes);
  if (requiredScopes.length === 0) {
    throw new McpAuthError("MCP auth guard requiredScopes must include at least one scope.", {
      field: "requiredScopes",
    });
  }

  const resourceMetadataUrl = normalizeOptionalText(dependencies.authContext.resourceMetadataUrl);
  if (!resourceMetadataUrl) {
    throw new McpAuthError("MCP auth guard resourceMetadataUrl must be configured.", {
      field: "authContext.resourceMetadataUrl",
    });
  }

  return {
    audience,
    requiredScopes,
    resource: normalizeOptionalText(dependencies.authContext.protectedResourceMetadata.resource),
    resourceMetadataUrl,
  };
  // END_BLOCK_BUILD_NORMALIZED_VALIDATION_CONTEXT_M_MCP_AUTH_GUARD_008
}

// START_CONTRACT: createBearerChallengeValue
//   PURPOSE: Build Bearer WWW-Authenticate value using mcp-auth BearerWWWAuthenticateHeader utility.
//   INPUTS: { options: DeniedResponseOptions - Challenge input values }
//   OUTPUTS: { string - WWW-Authenticate header value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: createBearerChallengeValue
function createBearerChallengeValue(options: DeniedResponseOptions): string {
  // START_BLOCK_BUILD_BEARER_CHALLENGE_VALUE_WITH_UTILITY_M_MCP_AUTH_GUARD_009
  const header = new BearerWWWAuthenticateHeader()
    .setParameterIfValueExists("resource_metadata", options.resourceMetadataUrl)
    .setParameterIfValueExists("error", options.error)
    .setParameterIfValueExists("error_description", options.errorDescription)
    .setParameterIfValueExists("scope", normalizeScopes(options.requiredScopes ?? []).join(" "))
    .setParameterIfValueExists("resource", normalizeOptionalText(options.resource));

  return header.toString() || "Bearer";
  // END_BLOCK_BUILD_BEARER_CHALLENGE_VALUE_WITH_UTILITY_M_MCP_AUTH_GUARD_009
}

// START_CONTRACT: createInitialMcpChallenge
//   PURPOSE: Build initial 401 challenge response for unauthenticated/invalid-header requests using only resource_metadata.
//   INPUTS: { resourceMetadataUrl: string - Protected resource metadata endpoint URL }
//   OUTPUTS: { Response - HTTP 401 response with Bearer resource_metadata challenge }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: createInitialMcpChallenge
export function createInitialMcpChallenge(resourceMetadataUrl: string): Response {
  // START_BLOCK_CREATE_INITIAL_MCP_RESOURCE_METADATA_CHALLENGE_RESPONSE_M_MCP_AUTH_GUARD_010
  const challenge = createBearerChallengeValue({
    status: 401,
    resourceMetadataUrl,
  });

  return new Response(
    JSON.stringify({
      error: {
        code: "UNAUTHORIZED",
        message: UNAUTHORIZED_MESSAGE,
      },
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "www-authenticate": challenge,
      },
    },
  );
  // END_BLOCK_CREATE_INITIAL_MCP_RESOURCE_METADATA_CHALLENGE_RESPONSE_M_MCP_AUTH_GUARD_010
}

// START_CONTRACT: createDeniedResponse
//   PURPOSE: Build standardized denied auth response with 401/403 status and Bearer challenge header.
//   INPUTS: { options: DeniedResponseOptions - Denied response options }
//   OUTPUTS: { Response - Ready-to-send HTTP response }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: createDeniedResponse
export function createDeniedResponse(options: DeniedResponseOptions): Response {
  // START_BLOCK_CREATE_STANDARDIZED_DENIED_AUTH_RESPONSE_M_MCP_AUTH_GUARD_011
  const challenge = createBearerChallengeValue(options);
  const message = options.status === 403 ? FORBIDDEN_MESSAGE : UNAUTHORIZED_MESSAGE;
  const errorCode = options.status === 403 ? "FORBIDDEN" : "UNAUTHORIZED";

  return new Response(
    JSON.stringify({
      error: {
        code: errorCode,
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
  // END_BLOCK_CREATE_STANDARDIZED_DENIED_AUTH_RESPONSE_M_MCP_AUTH_GUARD_011
}

// START_CONTRACT: validateAudience
//   PURPOSE: Validate token audience against configured protected audience using mcp-auth bearer error type.
//   INPUTS: { authInfo: AuthInfo - Verified auth payload, expectedAudience: string - Configured expected audience }
//   OUTPUTS: { void - Throws when audience is invalid }
//   SIDE_EFFECTS: [Throws MCPAuthBearerAuthError("invalid_audience")]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: validateAudience
function validateAudience(authInfo: AuthInfo, expectedAudience: string): void {
  // START_BLOCK_VALIDATE_AUTH_INFO_AUDIENCE_M_MCP_AUTH_GUARD_012
  const audience = authInfo.audience;
  if (typeof audience === "string") {
    if (audience === expectedAudience) {
      return;
    }
  } else if (Array.isArray(audience) && audience.includes(expectedAudience)) {
    return;
  }

  throw new MCPAuthBearerAuthError("invalid_audience", {
    expected: expectedAudience,
    actual: audience,
  });
  // END_BLOCK_VALIDATE_AUTH_INFO_AUDIENCE_M_MCP_AUTH_GUARD_012
}

// START_CONTRACT: validateRequiredScopes
//   PURPOSE: Validate required scopes against granted token scopes using mcp-auth bearer error type.
//   INPUTS: { grantedScopes: string[] - Scopes granted by token, requiredScopes: string[] - Required scopes }
//   OUTPUTS: { void - Throws when required scopes are missing }
//   SIDE_EFFECTS: [Throws MCPAuthBearerAuthError("missing_required_scopes")]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: validateRequiredScopes
function validateRequiredScopes(grantedScopes: string[], requiredScopes: string[]): void {
  // START_BLOCK_VALIDATE_REQUIRED_SCOPES_AGAINST_TOKEN_M_MCP_AUTH_GUARD_013
  const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope));
  if (missingScopes.length === 0) {
    return;
  }

  throw new MCPAuthBearerAuthError("missing_required_scopes", {
    missingScopes,
  });
  // END_BLOCK_VALIDATE_REQUIRED_SCOPES_AGAINST_TOKEN_M_MCP_AUTH_GUARD_013
}

// START_CONTRACT: mapKnownAuthErrorToDecision
//   PURPOSE: Convert known mcp-auth auth failures into non-throwing denied decisions with ready HTTP responses.
//   INPUTS: { error: unknown - Runtime error, context: McpAuthValidationContext - Normalized validation context }
//   OUTPUTS: { McpAuthDeniedResult|undefined - Denied decision for known auth failures, undefined for internal failures }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: mapKnownAuthErrorToDecision
function mapKnownAuthErrorToDecision(
  error: unknown,
  context: McpAuthValidationContext,
): McpAuthDeniedResult | undefined {
  // START_BLOCK_MAP_KNOWN_AUTH_ERRORS_TO_DENIED_DECISIONS_M_MCP_AUTH_GUARD_014
  if (error instanceof MCPAuthTokenVerificationError) {
    return {
      isAuthorized: false,
      reason: "INVALID_TOKEN",
      response: createDeniedResponse({
        status: 401,
        error: "invalid_token",
        errorDescription: "OAuth access token verification failed.",
        resource: context.resource,
        resourceMetadataUrl: context.resourceMetadataUrl,
      }),
    };
  }

  if (error instanceof MCPAuthBearerAuthError) {
    if (error.code === "missing_required_scopes") {
      return {
        isAuthorized: false,
        reason: "INSUFFICIENT_SCOPE",
        response: createDeniedResponse({
          status: 403,
          error: "insufficient_scope",
          errorDescription: "OAuth access token is missing required scopes.",
          requiredScopes: context.requiredScopes,
          resource: context.resource,
          resourceMetadataUrl: context.resourceMetadataUrl,
        }),
      };
    }

    if (error.code === "invalid_issuer") {
      return {
        isAuthorized: false,
        reason: "INVALID_ISSUER",
        response: createDeniedResponse({
          status: 401,
          error: "invalid_token",
          errorDescription: "OAuth access token issuer is not trusted.",
          resource: context.resource,
          resourceMetadataUrl: context.resourceMetadataUrl,
        }),
      };
    }

    if (error.code === "invalid_audience") {
      return {
        isAuthorized: false,
        reason: "INVALID_AUDIENCE",
        response: createDeniedResponse({
          status: 401,
          error: "invalid_token",
          errorDescription: "OAuth access token audience is invalid for this resource.",
          resource: context.resource,
          resourceMetadataUrl: context.resourceMetadataUrl,
        }),
      };
    }

    return {
      isAuthorized: false,
      reason: "INVALID_TOKEN",
      response: createDeniedResponse({
        status: 401,
        error: "invalid_token",
        errorDescription: "OAuth access token is invalid.",
        resource: context.resource,
        resourceMetadataUrl: context.resourceMetadataUrl,
      }),
    };
  }

  return undefined;
  // END_BLOCK_MAP_KNOWN_AUTH_ERRORS_TO_DENIED_DECISIONS_M_MCP_AUTH_GUARD_014
}

// START_CONTRACT: authorizeMcpRequest
//   PURPOSE: Authorize /mcp Request using McpAuthContext verification, issuer validation, audience/scope checks, and response-ready deny decisions.
//   INPUTS: { request: Request - Incoming request, dependencies: McpAuthGuardDependencies - Guard dependencies }
//   OUTPUTS: { Promise<McpAuthDecision> - Authorization decision with AuthInfo on success or ready Response on deny }
//   SIDE_EFFECTS: [Emits auth logs and throws McpAuthError for unexpected internal failures]
//   LINKS: [M-MCP-AUTH-GUARD, M-MCP-AUTH-PROVIDER, M-LOGGER]
// END_CONTRACT: authorizeMcpRequest
export async function authorizeMcpRequest(
  request: Request,
  dependencies: McpAuthGuardDependencies,
): Promise<McpAuthDecision> {
  // START_BLOCK_PROCESS_REQUEST_AUTHORIZATION_FLOW_M_MCP_AUTH_GUARD_015
  assertDependencies(dependencies);
  const validationContext = resolveValidationContext(dependencies);

  const parsedHeader = parseAuthorizationHeader(request.headers.get("authorization"));
  if (isInvalidHeaderParseResult(parsedHeader)) {
    dependencies.logger.warn(
      "Rejected /mcp request due to missing or invalid Authorization header.",
      "authorizeMcpRequest",
      "PROCESS_REQUEST_AUTHORIZATION_FLOW",
      {
        reason: parsedHeader.reason,
        tokenLength: parsedHeader.tokenLength,
      },
    );

    return {
      isAuthorized: false,
      reason: parsedHeader.reason,
      response: createInitialMcpChallenge(validationContext.resourceMetadataUrl),
    };
  }

  try {
    const authInfo = await dependencies.authContext.verifyAccessToken(parsedHeader.token);

    const tokenIssuer = normalizeOptionalText(authInfo.issuer);
    if (!tokenIssuer) {
      throw new MCPAuthBearerAuthError("invalid_issuer", {
        expected: "configured issuer",
        actual: authInfo.issuer,
      });
    }

    dependencies.authContext.validateIssuer(tokenIssuer);
    validateAudience(authInfo, validationContext.audience);

    const grantedScopes = extractGrantedScopes(authInfo);
    validateRequiredScopes(grantedScopes, validationContext.requiredScopes);

    const subject = normalizeOptionalText(authInfo.subject);

    dependencies.logger.info(
      "Authorized /mcp request via mcp-auth context.",
      "authorizeMcpRequest",
      "PROCESS_REQUEST_AUTHORIZATION_FLOW",
      {
        subject: subject ?? null,
        grantedScopes,
      },
    );

    return {
      isAuthorized: true,
      authInfo,
      subject,
      grantedScopes,
    };
  } catch (error: unknown) {
    const knownDenied = mapKnownAuthErrorToDecision(error, validationContext);
    if (knownDenied) {
      dependencies.logger.warn(
        "Rejected /mcp request due to OAuth authorization failure.",
        "authorizeMcpRequest",
        "PROCESS_REQUEST_AUTHORIZATION_FLOW",
        {
          reason: knownDenied.reason,
          tokenLength: parsedHeader.tokenLength,
        },
      );
      return knownDenied;
    }

    const typedError = toMcpAuthError(
      error,
      "Failed to authorize /mcp request via mcp-auth context.",
      {
        field: "authContext.verifyAccessToken|authContext.validateIssuer",
      },
    );

    dependencies.logger.error(
      "MCP auth guard encountered internal failure during authorization.",
      "authorizeMcpRequest",
      "PROCESS_REQUEST_AUTHORIZATION_FLOW",
      {
        code: typedError.code,
        details: typedError.details ?? null,
      },
    );

    throw typedError;
  }
  // END_BLOCK_PROCESS_REQUEST_AUTHORIZATION_FLOW_M_MCP_AUTH_GUARD_015
}
