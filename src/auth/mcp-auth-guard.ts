// FILE: src/auth/mcp-auth-guard.ts
// VERSION: 2.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Authorize /mcp requests using OAuth Bearer access-token validation and emit deterministic challenge metadata for denied requests.
//   SCOPE: Parse strict Bearer Authorization headers, call OAuth token validator dependency, consume typed validator outputs to build allow/deny decisions, and build WWW-Authenticate headers.
//   DEPENDS: M-OAUTH-TOKEN-VALIDATOR, M-LOGGER
//   LINKS: M-MCP-AUTH-GUARD, M-OAUTH-TOKEN-VALIDATOR, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   McpAuthError - Typed auth guard failure for exceptional/internal errors with MCP_AUTH_ERROR code.
//   OAuthChallengeMetadata - Deterministic OAuth challenge metadata for denied authorization decisions.
//   McpAuthDecision - Allow/deny decision envelope with OAuth challenge metadata on denied outcomes.
//   buildWwwAuthenticateHeader - Build standards-style Bearer challenge header from challenge metadata.
//   authorizeMcpRequest - Validate strict Bearer header, call OAuth token validator, and return authorization decision.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v2.1.0 - Wired guard dependency contract to typed M-OAUTH-TOKEN-VALIDATOR outputs and header-based validator input.
// END_CHANGE_SUMMARY

import type { Logger } from "../logger/index";
import type {
  OAuthTokenValidationResult,
  OAuthTokenValidator,
  ValidateAccessTokenContext,
} from "./oauth-token-validator";

const BEARER_HEADER_PATTERN = /^Bearer ([^\s]+)$/;

export type OAuthChallengeError = "invalid_request" | "invalid_token" | "insufficient_scope";

export type OAuthChallengeMetadata = {
  error: OAuthChallengeError;
  errorDescription: string;
  requiredScopes: string[];
  issuer?: string;
  resource?: string;
};

export type McpAuthDenyReason =
  | "MISSING_AUTH_HEADER"
  | "INVALID_AUTH_SCHEME"
  | "INVALID_TOKEN"
  | "INSUFFICIENT_SCOPE";

export type McpAuthAuthorizedResult = {
  isAuthorized: true;
  subject?: string;
  grantedScopes: string[];
};

export type McpAuthDeniedResult = {
  isAuthorized: false;
  reason: McpAuthDenyReason;
  challenge: OAuthChallengeMetadata;
};

export type McpAuthDecision = McpAuthAuthorizedResult | McpAuthDeniedResult;

type ParsedAuthorizationHeaderResult =
  | { isValid: true; tokenLength: number }
  | {
      isValid: false;
      reason: Extract<McpAuthDenyReason, "MISSING_AUTH_HEADER" | "INVALID_AUTH_SCHEME">;
      tokenLength: number;
    };

type McpAuthErrorDetails = {
  field?: string;
  cause?: string;
};

export type OAuthTokenValidatorLike = Pick<OAuthTokenValidator, "validateAccessToken">;

export type McpAuthGuardDependencies = {
  oauthTokenValidator: OAuthTokenValidatorLike;
  logger: Logger;
  requiredScopes: string[];
  issuer?: string;
  resource?: string;
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
//   PURPOSE: Remove potential credential text from diagnostic values before logging and rethrowing.
//   INPUTS: { text: string - Raw diagnostic text from runtime errors }
//   OUTPUTS: { string - Redacted diagnostic text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: redactSensitiveDiagnostics
function redactSensitiveDiagnostics(text: string): string {
  // START_BLOCK_REDACT_SENSITIVE_DIAGNOSTICS_M_MCP_AUTH_GUARD_001
  const normalized = text.trim();
  if (!normalized) {
    return "unknown";
  }

  return normalized
    .replace(/jp_[a-f0-9]{12}_[a-f0-9]{64}/gi, "<redacted-token>")
    .replace(/[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, "<redacted-jwt>")
    .replace(/\b[a-f0-9]{64}\b/gi, "<redacted-digest>");
  // END_BLOCK_REDACT_SENSITIVE_DIAGNOSTICS_M_MCP_AUTH_GUARD_001
}

// START_CONTRACT: toMcpAuthError
//   PURPOSE: Normalize unknown runtime failures to McpAuthError with safe diagnostics.
//   INPUTS: { error: unknown - Runtime failure, message: string - Stable error message, details: McpAuthErrorDetails|undefined - Optional context metadata }
//   OUTPUTS: { McpAuthError - Typed internal auth guard error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: toMcpAuthError
function toMcpAuthError(
  error: unknown,
  message: string,
  details?: McpAuthErrorDetails,
): McpAuthError {
  // START_BLOCK_MAP_UNKNOWN_FAILURES_TO_TYPED_AUTH_ERROR_M_MCP_AUTH_GUARD_002
  if (error instanceof McpAuthError) {
    return error;
  }

  const cause = error instanceof Error ? error.message : String(error);
  return new McpAuthError(message, {
    ...details,
    cause: redactSensitiveDiagnostics(cause),
  });
  // END_BLOCK_MAP_UNKNOWN_FAILURES_TO_TYPED_AUTH_ERROR_M_MCP_AUTH_GUARD_002
}

// START_CONTRACT: normalizeScopes
//   PURPOSE: Normalize scope lists by trimming values, removing empties, and deduplicating in-order.
//   INPUTS: { scopes: readonly string[] - Raw scope values }
//   OUTPUTS: { string[] - Normalized unique scope values }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: normalizeScopes
function normalizeScopes(scopes: readonly string[]): string[] {
  // START_BLOCK_NORMALIZE_SCOPE_VALUES_M_MCP_AUTH_GUARD_003
  const uniqueScopes = new Set<string>();
  for (const scope of scopes) {
    const normalizedScope = scope.trim();
    if (normalizedScope) {
      uniqueScopes.add(normalizedScope);
    }
  }
  return [...uniqueScopes];
  // END_BLOCK_NORMALIZE_SCOPE_VALUES_M_MCP_AUTH_GUARD_003
}

// START_CONTRACT: normalizeOptionalMetadataValue
//   PURPOSE: Normalize optional metadata values by trimming and converting empty strings to undefined.
//   INPUTS: { value: string|undefined - Optional raw metadata value }
//   OUTPUTS: { string|undefined - Normalized optional metadata value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: normalizeOptionalMetadataValue
function normalizeOptionalMetadataValue(value: string | undefined): string | undefined {
  // START_BLOCK_NORMALIZE_OPTIONAL_METADATA_VALUES_M_MCP_AUTH_GUARD_004
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : undefined;
  // END_BLOCK_NORMALIZE_OPTIONAL_METADATA_VALUES_M_MCP_AUTH_GUARD_004
}

// START_CONTRACT: parseAuthorizationHeader
//   PURPOSE: Parse Authorization header using strict Bearer format required by /mcp policy.
//   INPUTS: { authorizationHeader: string|null - Incoming Authorization header value }
//   OUTPUTS: { ParsedAuthorizationHeaderResult - Parsed token metadata or deny reason }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: parseAuthorizationHeader
function parseAuthorizationHeader(
  authorizationHeader: string | null,
): ParsedAuthorizationHeaderResult {
  // START_BLOCK_PARSE_STRICT_BEARER_AUTHORIZATION_HEADER_M_MCP_AUTH_GUARD_005
  if (authorizationHeader === null) {
    return {
      isValid: false,
      reason: "MISSING_AUTH_HEADER",
      tokenLength: 0,
    };
  }

  const match = BEARER_HEADER_PATTERN.exec(authorizationHeader);
  if (!match) {
    return {
      isValid: false,
      reason: "INVALID_AUTH_SCHEME",
      tokenLength: authorizationHeader.length,
    };
  }

  const token = match[1];
  if (!token) {
    return {
      isValid: false,
      reason: "INVALID_AUTH_SCHEME",
      tokenLength: authorizationHeader.length,
    };
  }

  return {
    isValid: true,
    tokenLength: token.length,
  };
  // END_BLOCK_PARSE_STRICT_BEARER_AUTHORIZATION_HEADER_M_MCP_AUTH_GUARD_005
}

// START_CONTRACT: assertDependencies
//   PURPOSE: Validate dependency injection contract before auth processing.
//   INPUTS: { dependencies: McpAuthGuardDependencies - Token validator, required scopes, and logger dependencies }
//   OUTPUTS: { void - Throws when dependency contract is invalid }
//   SIDE_EFFECTS: [Throws McpAuthError for invalid dependency wiring]
//   LINKS: [M-MCP-AUTH-GUARD, M-OAUTH-TOKEN-VALIDATOR, M-LOGGER]
// END_CONTRACT: assertDependencies
function assertDependencies(dependencies: McpAuthGuardDependencies): void {
  // START_BLOCK_VALIDATE_AUTH_GUARD_DEPENDENCY_CONTRACT_M_MCP_AUTH_GUARD_006
  if (!dependencies || typeof dependencies !== "object") {
    throw new McpAuthError("MCP auth guard dependencies are required.", {
      field: "dependencies",
    });
  }

  if (typeof dependencies.oauthTokenValidator?.validateAccessToken !== "function") {
    throw new McpAuthError("MCP auth guard requires oauthTokenValidator.validateAccessToken.", {
      field: "oauthTokenValidator.validateAccessToken",
    });
  }

  if (!Array.isArray(dependencies.requiredScopes)) {
    throw new McpAuthError("MCP auth guard requires requiredScopes array.", {
      field: "requiredScopes",
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
  // END_BLOCK_VALIDATE_AUTH_GUARD_DEPENDENCY_CONTRACT_M_MCP_AUTH_GUARD_006
}

// START_CONTRACT: buildValidationContext
//   PURPOSE: Construct normalized OAuth validation context from dependencies.
//   INPUTS: { dependencies: McpAuthGuardDependencies - Guard dependencies with configured OAuth metadata }
//   OUTPUTS: { requiredScopes: string[]; issuer?: string; resource?: string - Normalized validation context for token validator and challenge metadata }
//   SIDE_EFFECTS: [Throws McpAuthError when requiredScopes is empty after normalization]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: buildValidationContext
function buildValidationContext(dependencies: McpAuthGuardDependencies): {
  requiredScopes: string[];
  issuer?: string;
  resource?: string;
} {
  // START_BLOCK_BUILD_NORMALIZED_VALIDATION_CONTEXT_M_MCP_AUTH_GUARD_007
  const requiredScopes = normalizeScopes(dependencies.requiredScopes);
  if (requiredScopes.length === 0) {
    throw new McpAuthError("MCP auth guard requiredScopes must include at least one scope.", {
      field: "requiredScopes",
    });
  }

  return {
    requiredScopes,
    issuer: normalizeOptionalMetadataValue(dependencies.issuer),
    resource: normalizeOptionalMetadataValue(dependencies.resource),
  };
  // END_BLOCK_BUILD_NORMALIZED_VALIDATION_CONTEXT_M_MCP_AUTH_GUARD_007
}

// START_CONTRACT: createChallengeMetadata
//   PURPOSE: Build deterministic OAuth challenge metadata for denied responses.
//   INPUTS: { error: OAuthChallengeError - OAuth challenge error code, errorDescription: string - Human-readable error description, requiredScopes: string[] - Required scopes for resource access, issuer: string|undefined - Optional issuer metadata, resource: string|undefined - Optional protected resource metadata }
//   OUTPUTS: { OAuthChallengeMetadata - Challenge metadata structure }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: createChallengeMetadata
function createChallengeMetadata(
  error: OAuthChallengeError,
  errorDescription: string,
  requiredScopes: string[],
  issuer?: string,
  resource?: string,
): OAuthChallengeMetadata {
  // START_BLOCK_CREATE_CHALLENGE_METADATA_OBJECT_M_MCP_AUTH_GUARD_008
  return {
    error,
    errorDescription,
    requiredScopes: normalizeScopes(requiredScopes),
    issuer: normalizeOptionalMetadataValue(issuer),
    resource: normalizeOptionalMetadataValue(resource),
  };
  // END_BLOCK_CREATE_CHALLENGE_METADATA_OBJECT_M_MCP_AUTH_GUARD_008
}

// START_CONTRACT: mapHeaderDenyReasonToChallenge
//   PURPOSE: Convert header parsing deny reason to OAuth challenge metadata.
//   INPUTS: { reason: "MISSING_AUTH_HEADER"|"INVALID_AUTH_SCHEME" - Header deny reason, requiredScopes: string[] - Required scopes, issuer: string|undefined - Optional issuer metadata, resource: string|undefined - Optional protected resource metadata }
//   OUTPUTS: { OAuthChallengeMetadata - OAuth challenge metadata for invalid request cases }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: mapHeaderDenyReasonToChallenge
function mapHeaderDenyReasonToChallenge(
  reason: Extract<McpAuthDenyReason, "MISSING_AUTH_HEADER" | "INVALID_AUTH_SCHEME">,
  requiredScopes: string[],
  issuer?: string,
  resource?: string,
): OAuthChallengeMetadata {
  // START_BLOCK_MAP_HEADER_DENY_REASON_TO_CHALLENGE_M_MCP_AUTH_GUARD_009
  if (reason === "MISSING_AUTH_HEADER") {
    return createChallengeMetadata(
      "invalid_request",
      "Authorization header is required and must use Bearer token format.",
      requiredScopes,
      issuer,
      resource,
    );
  }

  return createChallengeMetadata(
    "invalid_request",
    "Authorization header must use Bearer token format.",
    requiredScopes,
    issuer,
    resource,
  );
  // END_BLOCK_MAP_HEADER_DENY_REASON_TO_CHALLENGE_M_MCP_AUTH_GUARD_009
}

// START_CONTRACT: buildDeniedDecision
//   PURPOSE: Build consistent denied auth decision objects with OAuth challenge metadata.
//   INPUTS: { reason: McpAuthDenyReason - Stable deny reason, challenge: OAuthChallengeMetadata - Challenge metadata for WWW-Authenticate header construction }
//   OUTPUTS: { McpAuthDeniedResult - Denied auth decision envelope }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: buildDeniedDecision
function buildDeniedDecision(
  reason: McpAuthDenyReason,
  challenge: OAuthChallengeMetadata,
): McpAuthDeniedResult {
  // START_BLOCK_BUILD_DENIED_AUTH_DECISION_OBJECT_M_MCP_AUTH_GUARD_010
  return {
    isAuthorized: false,
    reason,
    challenge,
  };
  // END_BLOCK_BUILD_DENIED_AUTH_DECISION_OBJECT_M_MCP_AUTH_GUARD_010
}

// START_CONTRACT: escapeAuthHeaderParamValue
//   PURPOSE: Escape auth-param values for deterministic Bearer WWW-Authenticate header output.
//   INPUTS: { value: string - Raw auth-param value }
//   OUTPUTS: { string - Escaped auth-param value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: escapeAuthHeaderParamValue
function escapeAuthHeaderParamValue(value: string): string {
  // START_BLOCK_ESCAPE_AUTH_HEADER_PARAMETER_VALUES_M_MCP_AUTH_GUARD_011
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  // END_BLOCK_ESCAPE_AUTH_HEADER_PARAMETER_VALUES_M_MCP_AUTH_GUARD_011
}

// START_CONTRACT: buildWwwAuthenticateHeader
//   PURPOSE: Build standards-style Bearer challenge header from OAuth challenge metadata.
//   INPUTS: { challenge: OAuthChallengeMetadata - Denied auth challenge metadata }
//   OUTPUTS: { string - WWW-Authenticate Bearer challenge header value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: buildWwwAuthenticateHeader
export function buildWwwAuthenticateHeader(challenge: OAuthChallengeMetadata): string {
  // START_BLOCK_BUILD_WWW_AUTHENTICATE_HEADER_M_MCP_AUTH_GUARD_012
  const params: string[] = [];
  params.push(`error="${escapeAuthHeaderParamValue(challenge.error)}"`);
  params.push(`error_description="${escapeAuthHeaderParamValue(challenge.errorDescription)}"`);

  const requiredScopes = normalizeScopes(challenge.requiredScopes);
  if (requiredScopes.length > 0) {
    params.push(`scope="${escapeAuthHeaderParamValue(requiredScopes.join(" "))}"`);
  }

  const issuer = normalizeOptionalMetadataValue(challenge.issuer);
  if (issuer) {
    params.push(`issuer="${escapeAuthHeaderParamValue(issuer)}"`);
  }

  const resource = normalizeOptionalMetadataValue(challenge.resource);
  if (resource) {
    params.push(`resource="${escapeAuthHeaderParamValue(resource)}"`);
  }

  return `Bearer ${params.join(", ")}`;
  // END_BLOCK_BUILD_WWW_AUTHENTICATE_HEADER_M_MCP_AUTH_GUARD_012
}

// START_CONTRACT: authorizeMcpRequest
//   PURPOSE: Authorize /mcp requests using OAuth token validator dependency with no API-key semantics.
//   INPUTS: { authorizationHeader: string|null - Authorization header value, dependencies: McpAuthGuardDependencies - Guard dependencies for OAuth token validation }
//   OUTPUTS: { Promise<McpAuthDecision> - Authorized decision with subject/scopes or denied decision with challenge metadata }
//   SIDE_EFFECTS: [Calls OAuth token validator and emits auth decision logs]
//   LINKS: [M-MCP-AUTH-GUARD, M-OAUTH-TOKEN-VALIDATOR, M-LOGGER]
// END_CONTRACT: authorizeMcpRequest
export async function authorizeMcpRequest(
  authorizationHeader: string | null,
  dependencies: McpAuthGuardDependencies,
): Promise<McpAuthDecision> {
  // START_BLOCK_VALIDATE_HEADER_AND_RETURN_NON_EXCEPTION_DENY_DECISIONS_M_MCP_AUTH_GUARD_013
  assertDependencies(dependencies);
  const validationContext = buildValidationContext(dependencies);

  const parsedHeader = parseAuthorizationHeader(authorizationHeader);
  if (!parsedHeader.isValid) {
    const challenge = mapHeaderDenyReasonToChallenge(
      parsedHeader.reason,
      validationContext.requiredScopes,
      validationContext.issuer,
      validationContext.resource,
    );
    dependencies.logger.warn(
      "Rejected /mcp request before token validation due to invalid Authorization header.",
      "authorizeMcpRequest",
      "VALIDATE_HEADER_AND_RETURN_NON_EXCEPTION_DENY_DECISIONS",
      {
        reason: parsedHeader.reason,
        tokenLength: parsedHeader.tokenLength,
      },
    );
    return buildDeniedDecision(parsedHeader.reason, challenge);
  }
  // END_BLOCK_VALIDATE_HEADER_AND_RETURN_NON_EXCEPTION_DENY_DECISIONS_M_MCP_AUTH_GUARD_013

  // START_BLOCK_VALIDATE_ACCESS_TOKEN_AND_BUILD_AUTHORIZATION_DECISION_M_MCP_AUTH_GUARD_014
  try {
    const validatorContext: ValidateAccessTokenContext = validationContext;
    const validationResult: OAuthTokenValidationResult =
      await dependencies.oauthTokenValidator.validateAccessToken(
        authorizationHeader,
        validatorContext,
      );

    if (!validationResult.isValid) {
      const denyReason: McpAuthDenyReason =
        validationResult.error === "insufficient_scope" ? "INSUFFICIENT_SCOPE" : "INVALID_TOKEN";
      const challenge = createChallengeMetadata(
        validationResult.error,
        validationResult.errorDescription,
        validationContext.requiredScopes,
        validationContext.issuer,
        validationContext.resource,
      );
      dependencies.logger.warn(
        "Rejected /mcp request due to failed OAuth token validation.",
        "authorizeMcpRequest",
        "VALIDATE_ACCESS_TOKEN_AND_BUILD_AUTHORIZATION_DECISION",
        {
          reason: denyReason,
          tokenLength: parsedHeader.tokenLength,
        },
      );
      return buildDeniedDecision(denyReason, challenge);
    }

    const grantedScopes = normalizeScopes(validationResult.grantedScopes);
    const subject = normalizeOptionalMetadataValue(validationResult.subject);
    dependencies.logger.info(
      "Authorized /mcp request via OAuth access token validation.",
      "authorizeMcpRequest",
      "VALIDATE_ACCESS_TOKEN_AND_BUILD_AUTHORIZATION_DECISION",
      {
        subject: subject ?? null,
        grantedScopes,
      },
    );
    return {
      isAuthorized: true,
      subject,
      grantedScopes,
    };
  } catch (error: unknown) {
    const typedError = toMcpAuthError(
      error,
      "Failed to authorize /mcp request via OAuth token validation.",
      {
        field: "oauthTokenValidator.validateAccessToken",
      },
    );
    dependencies.logger.error(
      "MCP auth guard encountered internal failure during token validation.",
      "authorizeMcpRequest",
      "VALIDATE_ACCESS_TOKEN_AND_BUILD_AUTHORIZATION_DECISION",
      {
        code: typedError.code,
        details: typedError.details ?? null,
      },
    );
    throw typedError;
  }
  // END_BLOCK_VALIDATE_ACCESS_TOKEN_AND_BUILD_AUTHORIZATION_DECISION_M_MCP_AUTH_GUARD_014
}
