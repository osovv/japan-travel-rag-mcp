// FILE: src/auth/mcp-auth-guard.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Authorize /mcp requests using repository-backed API keys and deny unauthorized callers before transport handling.
//   SCOPE: Parse Authorization headers as strict Bearer tokens, resolve API keys through ApiKeyRepository, return allow/deny decisions, and surface typed internal auth failures.
//   DEPENDS: M-API-KEY-REPOSITORY, M-LOGGER
//   LINKS: M-MCP-AUTH-GUARD, M-API-KEY-REPOSITORY, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   McpAuthError - Typed auth guard failure used only for exceptional/internal errors with MCP_AUTH_ERROR code.
//   McpAuthDecision - Allow/deny authorization decision envelope for /mcp request gating.
//   authorizeMcpRequest - Validate strict Bearer header, resolve API key via repository, and return authorization decision.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation from development plan for M-MCP-AUTH-GUARD.
// END_CHANGE_SUMMARY

import type { ApiKeyRepository } from "../admin/api-key-repository";
import type { Logger } from "../logger/index";

const BEARER_HEADER_PATTERN = /^Bearer ([^\s]+)$/;

export type McpAuthDenyReason =
  | "MISSING_AUTH_HEADER"
  | "INVALID_AUTH_SCHEME"
  | "INVALID_API_KEY";

export type McpAuthAuthorizedResult = {
  isAuthorized: true;
  apiKeyId: string;
  keyPrefix: string;
};

export type McpAuthDeniedResult = {
  isAuthorized: false;
  reason: McpAuthDenyReason;
};

export type McpAuthDecision = McpAuthAuthorizedResult | McpAuthDeniedResult;

type ParsedAuthorizationHeaderResult =
  | { isValid: true; token: string; tokenLength: number }
  | { isValid: false; reason: McpAuthDenyReason; tokenLength: number };

type McpAuthErrorDetails = {
  field?: string;
  cause?: string;
};

export type McpAuthGuardDependencies = {
  apiKeyRepository: Pick<ApiKeyRepository, "resolveApiKey">;
  logger: Logger;
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
//   PURPOSE: Remove potential API key and digest text from diagnostic details before logging and rethrowing.
//   INPUTS: { text: string - Raw diagnostic text from runtime errors }
//   OUTPUTS: { string - Redacted diagnostic string }
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
    .replace(/jp_[a-f0-9]{12}_[a-f0-9]{64}/g, "<redacted-api-key>")
    .replace(/\b[a-f0-9]{64}\b/gi, "<redacted-digest>");
  // END_BLOCK_REDACT_SENSITIVE_DIAGNOSTICS_M_MCP_AUTH_GUARD_001
}

// START_CONTRACT: toMcpAuthError
//   PURPOSE: Normalize unknown runtime failures to McpAuthError with safe diagnostics.
//   INPUTS: { error: unknown - Runtime failure, message: string - Stable guard failure message, details: McpAuthErrorDetails|undefined - Optional context metadata }
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
  // START_BLOCK_PARSE_STRICT_BEARER_AUTHORIZATION_HEADER_M_MCP_AUTH_GUARD_003
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
    token,
    tokenLength: token.length,
  };
  // END_BLOCK_PARSE_STRICT_BEARER_AUTHORIZATION_HEADER_M_MCP_AUTH_GUARD_003
}

// START_CONTRACT: assertDependencies
//   PURPOSE: Validate runtime dependency injection before auth processing.
//   INPUTS: { dependencies: McpAuthGuardDependencies - Repository and logger providers for auth guard }
//   OUTPUTS: { void - Throws when dependency contract is invalid }
//   SIDE_EFFECTS: [Throws McpAuthError for invalid dependency wiring]
//   LINKS: [M-MCP-AUTH-GUARD, M-API-KEY-REPOSITORY, M-LOGGER]
// END_CONTRACT: assertDependencies
function assertDependencies(dependencies: McpAuthGuardDependencies): void {
  // START_BLOCK_VALIDATE_AUTH_GUARD_DEPENDENCY_CONTRACT_M_MCP_AUTH_GUARD_004
  if (!dependencies || typeof dependencies !== "object") {
    throw new McpAuthError("MCP auth guard dependencies are required.", {
      field: "dependencies",
    });
  }

  if (typeof dependencies.apiKeyRepository?.resolveApiKey !== "function") {
    throw new McpAuthError("MCP auth guard requires ApiKeyRepository.resolveApiKey.", {
      field: "apiKeyRepository.resolveApiKey",
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
  // END_BLOCK_VALIDATE_AUTH_GUARD_DEPENDENCY_CONTRACT_M_MCP_AUTH_GUARD_004
}

// START_CONTRACT: buildDeniedDecision
//   PURPOSE: Build consistent deny result objects for /mcp auth decisions.
//   INPUTS: { reason: McpAuthDenyReason - Stable deny reason code }
//   OUTPUTS: { McpAuthDeniedResult - Denied auth decision envelope }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-MCP-AUTH-GUARD]
// END_CONTRACT: buildDeniedDecision
function buildDeniedDecision(reason: McpAuthDenyReason): McpAuthDeniedResult {
  // START_BLOCK_BUILD_DENIED_AUTH_DECISION_OBJECT_M_MCP_AUTH_GUARD_005
  return {
    isAuthorized: false,
    reason,
  };
  // END_BLOCK_BUILD_DENIED_AUTH_DECISION_OBJECT_M_MCP_AUTH_GUARD_005
}

// START_CONTRACT: authorizeMcpRequest
//   PURPOSE: Authorize /mcp requests using only repository-backed API keys with no fallback credential path.
//   INPUTS: { authorizationHeader: string|null - Authorization header to validate, dependencies: McpAuthGuardDependencies - Repository and logger dependencies }
//   OUTPUTS: { Promise<McpAuthDecision> - Authorized result with key metadata or deny result with reason }
//   SIDE_EFFECTS: [Queries ApiKeyRepository and writes structured auth decision logs]
//   LINKS: [M-MCP-AUTH-GUARD, M-API-KEY-REPOSITORY, M-LOGGER]
// END_CONTRACT: authorizeMcpRequest
export async function authorizeMcpRequest(
  authorizationHeader: string | null,
  dependencies: McpAuthGuardDependencies,
): Promise<McpAuthDecision> {
  // START_BLOCK_VALIDATE_HEADER_AND_RETURN_NON_EXCEPTION_DENY_DECISIONS_M_MCP_AUTH_GUARD_006
  assertDependencies(dependencies);

  const parsedHeader = parseAuthorizationHeader(authorizationHeader);
  if (!parsedHeader.isValid) {
    dependencies.logger.warn(
      "Rejected /mcp request before transport due to invalid Authorization header.",
      "authorizeMcpRequest",
      "VALIDATE_HEADER_AND_RETURN_NON_EXCEPTION_DENY_DECISIONS",
      {
        reason: parsedHeader.reason,
        tokenLength: parsedHeader.tokenLength,
      },
    );
    return buildDeniedDecision(parsedHeader.reason);
  }
  // END_BLOCK_VALIDATE_HEADER_AND_RETURN_NON_EXCEPTION_DENY_DECISIONS_M_MCP_AUTH_GUARD_006

  // START_BLOCK_RESOLVE_API_KEY_AND_BUILD_AUTHORIZATION_DECISION_M_MCP_AUTH_GUARD_007
  try {
    const resolvedRecord = await dependencies.apiKeyRepository.resolveApiKey(parsedHeader.token);
    if (!resolvedRecord) {
      dependencies.logger.warn(
        "Rejected /mcp request due to unresolved or inactive API key.",
        "authorizeMcpRequest",
        "RESOLVE_API_KEY_AND_BUILD_AUTHORIZATION_DECISION",
        {
          reason: "INVALID_API_KEY",
          tokenLength: parsedHeader.tokenLength,
        },
      );
      return buildDeniedDecision("INVALID_API_KEY");
    }

    dependencies.logger.info(
      "Authorized /mcp request with active API key.",
      "authorizeMcpRequest",
      "RESOLVE_API_KEY_AND_BUILD_AUTHORIZATION_DECISION",
      {
        apiKeyId: resolvedRecord.id,
        keyPrefix: resolvedRecord.keyPrefix,
      },
    );
    return {
      isAuthorized: true,
      apiKeyId: resolvedRecord.id,
      keyPrefix: resolvedRecord.keyPrefix,
    };
  } catch (error: unknown) {
    const typedError = toMcpAuthError(error, "Failed to authorize /mcp request via API key.", {
      field: "apiKeyRepository.resolveApiKey",
    });
    dependencies.logger.error(
      "MCP auth guard encountered internal failure during API key resolution.",
      "authorizeMcpRequest",
      "RESOLVE_API_KEY_AND_BUILD_AUTHORIZATION_DECISION",
      {
        code: typedError.code,
        details: typedError.details ?? null,
      },
    );
    throw typedError;
  }
  // END_BLOCK_RESOLVE_API_KEY_AND_BUILD_AUTHORIZATION_DECISION_M_MCP_AUTH_GUARD_007
}
