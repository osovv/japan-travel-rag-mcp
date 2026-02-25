// FILE: src/admin/auth.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Authenticate admin login attempts with ROOT_AUTH_TOKEN and enforce signed session cookie checks for /admin routes.
//   SCOPE: Validate admin login token, issue HMAC-signed expiring session cookies, verify session cookies for route guards, and provide cookie clearing helper.
//   DEPENDS: M-CONFIG, M-LOGGER
//   LINKS: M-ADMIN-AUTH, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   AdminAuthError - Typed admin auth failure for exceptional internal errors with ADMIN_AUTH_ERROR code.
//   AuthenticateAdminResult - Result envelope for admin login attempts.
//   RequireAdminSessionResult - Result envelope for admin session guard allow-or-redirect decisions.
//   authenticateAdmin - Verify login token and issue signed admin session cookie on success.
//   requireAdminSession - Validate session cookie and return allow-or-redirect decision.
//   clearAdminSession - Return Set-Cookie value that invalidates admin auth session.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation from development plan for M-ADMIN-AUTH with signed cookie auth flow.
// END_CHANGE_SUMMARY

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";

const ADMIN_LOGIN_REDIRECT_PATH = "/admin/login" as const;
const ADMIN_SESSION_COOKIE_NAME = "admin_session";
const ADMIN_SESSION_SCOPE = "admin" as const;
const ADMIN_SESSION_VERSION = 1 as const;
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;
const ADMIN_SESSION_SAME_SITE_POLICY = "Lax" as const;
const ADMIN_SIGNING_KEY_CONTEXT = "m-admin-auth-session-signing-v1";

type AdminLoginDenyReason = "DISALLOWED_MCP_BEARER_FORMAT" | "INVALID_LOGIN_TOKEN";
type AdminSessionDenyReason =
  | "MISSING_SESSION_COOKIE"
  | "INVALID_SESSION_COOKIE"
  | "EXPIRED_SESSION_COOKIE";

type AdminSessionPayload = {
  v: typeof ADMIN_SESSION_VERSION;
  scope: typeof ADMIN_SESSION_SCOPE;
  iat: number;
  exp: number;
};

type SessionValidationResult =
  | { isValid: true; payload: AdminSessionPayload }
  | { isValid: false; reason: AdminSessionDenyReason };

export type AuthenticateAdminResult =
  | { isAuthenticated: true; sessionCookie: string }
  | { isAuthenticated: false; sessionCookie: null; reason: AdminLoginDenyReason };

export type RequireAdminSessionResult =
  | { isAuthenticated: true }
  | {
      isAuthenticated: false;
      reason: AdminSessionDenyReason;
      status: 302;
      location: typeof ADMIN_LOGIN_REDIRECT_PATH;
      setCookie?: string;
    };

export class AdminAuthError extends Error {
  public readonly code = "ADMIN_AUTH_ERROR" as const;
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AdminAuthError";
    this.details = details;
  }
}

// START_CONTRACT: normalizeTokenCandidate
//   PURPOSE: Normalize potential token text from user inputs and headers.
//   INPUTS: { tokenCandidate: string - Raw candidate token text }
//   OUTPUTS: { string - Trimmed token text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-AUTH]
// END_CONTRACT: normalizeTokenCandidate
function normalizeTokenCandidate(tokenCandidate: string): string {
  // START_BLOCK_NORMALIZE_TOKEN_CANDIDATE_TEXT_M_ADMIN_AUTH_001
  return tokenCandidate.trim();
  // END_BLOCK_NORMALIZE_TOKEN_CANDIDATE_TEXT_M_ADMIN_AUTH_001
}

// START_CONTRACT: isDisallowedMcpBearerFormat
//   PURPOSE: Detect Bearer-prefixed token format to prevent ROOT_AUTH_TOKEN flow from /mcp credentials.
//   INPUTS: { tokenCandidate: string - Normalized token candidate text }
//   OUTPUTS: { boolean - True when token looks like Authorization Bearer format }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-AUTH]
// END_CONTRACT: isDisallowedMcpBearerFormat
function isDisallowedMcpBearerFormat(tokenCandidate: string): boolean {
  // START_BLOCK_DETECT_DISALLOWED_MCP_BEARER_FORMAT_M_ADMIN_AUTH_002
  return /^bearer\s+/i.test(tokenCandidate);
  // END_BLOCK_DETECT_DISALLOWED_MCP_BEARER_FORMAT_M_ADMIN_AUTH_002
}

// START_CONTRACT: safeCompareSecrets
//   PURPOSE: Compare sensitive text values using timing-safe comparison when lengths match.
//   INPUTS: { leftSecret: string - Left secret value, rightSecret: string - Right secret value }
//   OUTPUTS: { boolean - True when both secret values are equal }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-AUTH]
// END_CONTRACT: safeCompareSecrets
function safeCompareSecrets(leftSecret: string, rightSecret: string): boolean {
  // START_BLOCK_COMPARE_SECRET_VALUES_CONSTANT_TIME_M_ADMIN_AUTH_003
  const leftBuffer = Buffer.from(leftSecret);
  const rightBuffer = Buffer.from(rightSecret);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
  // END_BLOCK_COMPARE_SECRET_VALUES_CONSTANT_TIME_M_ADMIN_AUTH_003
}

// START_CONTRACT: toAdminAuthError
//   PURPOSE: Normalize unknown runtime failures into AdminAuthError with safe diagnostics.
//   INPUTS: { error: unknown - Runtime failure, message: string - Stable error message, details: Record<string, unknown>|undefined - Additional context }
//   OUTPUTS: { AdminAuthError - Typed admin auth error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-AUTH]
// END_CONTRACT: toAdminAuthError
function toAdminAuthError(
  error: unknown,
  message: string,
  details?: Record<string, unknown>,
): AdminAuthError {
  // START_BLOCK_MAP_UNKNOWN_FAILURE_TO_TYPED_ADMIN_AUTH_ERROR_M_ADMIN_AUTH_004
  if (error instanceof AdminAuthError) {
    return error;
  }

  const cause = error instanceof Error ? error.message : String(error);
  return new AdminAuthError(message, {
    ...details,
    cause,
  });
  // END_BLOCK_MAP_UNKNOWN_FAILURE_TO_TYPED_ADMIN_AUTH_ERROR_M_ADMIN_AUTH_004
}

// START_CONTRACT: deriveAdminSigningKey
//   PURPOSE: Derive deterministic HMAC key material from ROOT_AUTH_TOKEN for admin session cookie signatures.
//   INPUTS: { config: AppConfig - Runtime configuration from M-CONFIG }
//   OUTPUTS: { string - Derived signing key }
//   SIDE_EFFECTS: [Throws AdminAuthError if config is missing required key material]
//   LINKS: [M-ADMIN-AUTH, M-CONFIG]
// END_CONTRACT: deriveAdminSigningKey
function deriveAdminSigningKey(config: AppConfig): string {
  // START_BLOCK_DERIVE_ADMIN_COOKIE_SIGNING_KEY_M_ADMIN_AUTH_005
  const rootAuthToken = normalizeTokenCandidate(config.rootAuthToken);
  if (!rootAuthToken) {
    throw new AdminAuthError("ROOT_AUTH_TOKEN is missing for admin auth module.", {
      field: "rootAuthToken",
    });
  }

  return createHash("sha256")
    .update(`${ADMIN_SIGNING_KEY_CONTEXT}:${rootAuthToken}`, "utf8")
    .digest("base64url");
  // END_BLOCK_DERIVE_ADMIN_COOKIE_SIGNING_KEY_M_ADMIN_AUTH_005
}

// START_CONTRACT: signSessionPayload
//   PURPOSE: Compute HMAC-SHA256 signature for serialized admin session payload.
//   INPUTS: { encodedPayload: string - Base64url JSON payload, signingKey: string - Derived signing key }
//   OUTPUTS: { string - Base64url encoded signature }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-AUTH]
// END_CONTRACT: signSessionPayload
function signSessionPayload(encodedPayload: string, signingKey: string): string {
  // START_BLOCK_SIGN_ADMIN_SESSION_PAYLOAD_M_ADMIN_AUTH_006
  return createHmac("sha256", signingKey).update(encodedPayload, "utf8").digest("base64url");
  // END_BLOCK_SIGN_ADMIN_SESSION_PAYLOAD_M_ADMIN_AUTH_006
}

// START_CONTRACT: buildSessionCookie
//   PURPOSE: Build Set-Cookie string for an active admin session.
//   INPUTS: { sessionValue: string - Serialized and signed cookie value, maxAgeSeconds: number - Cookie TTL in seconds }
//   OUTPUTS: { string - Set-Cookie header value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-AUTH]
// END_CONTRACT: buildSessionCookie
function buildSessionCookie(sessionValue: string, maxAgeSeconds: number): string {
  // START_BLOCK_BUILD_SET_COOKIE_HEADER_FOR_ADMIN_SESSION_M_ADMIN_AUTH_007
  return [
    `${ADMIN_SESSION_COOKIE_NAME}=${sessionValue}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${ADMIN_SESSION_SAME_SITE_POLICY}`,
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
  // END_BLOCK_BUILD_SET_COOKIE_HEADER_FOR_ADMIN_SESSION_M_ADMIN_AUTH_007
}

// START_CONTRACT: parseCookieValue
//   PURPOSE: Extract cookie value by name from Cookie header string.
//   INPUTS: { cookieHeader: string - Request Cookie header, cookieName: string - Cookie key to extract }
//   OUTPUTS: { string|null - Cookie value or null when absent }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-AUTH]
// END_CONTRACT: parseCookieValue
function parseCookieValue(cookieHeader: string, cookieName: string): string | null {
  // START_BLOCK_PARSE_COOKIE_HEADER_FOR_NAMED_VALUE_M_ADMIN_AUTH_008
  const cookieSegments = cookieHeader.split(";");
  for (const segment of cookieSegments) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (key !== cookieName) {
      continue;
    }

    return trimmed.slice(separatorIndex + 1).trim();
  }

  return null;
  // END_BLOCK_PARSE_COOKIE_HEADER_FOR_NAMED_VALUE_M_ADMIN_AUTH_008
}

// START_CONTRACT: isAdminSessionPayload
//   PURPOSE: Validate decoded payload object shape for admin session cookies.
//   INPUTS: { payload: unknown - Decoded payload candidate }
//   OUTPUTS: { payload is AdminSessionPayload - Type guard for session payload }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-AUTH]
// END_CONTRACT: isAdminSessionPayload
function isAdminSessionPayload(payload: unknown): payload is AdminSessionPayload {
  // START_BLOCK_VALIDATE_ADMIN_SESSION_PAYLOAD_SHAPE_M_ADMIN_AUTH_009
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    candidate["v"] === ADMIN_SESSION_VERSION &&
    candidate["scope"] === ADMIN_SESSION_SCOPE &&
    typeof candidate["iat"] === "number" &&
    Number.isInteger(candidate["iat"]) &&
    candidate["iat"] > 0 &&
    typeof candidate["exp"] === "number" &&
    Number.isInteger(candidate["exp"]) &&
    candidate["exp"] > 0
  );
  // END_BLOCK_VALIDATE_ADMIN_SESSION_PAYLOAD_SHAPE_M_ADMIN_AUTH_009
}

// START_CONTRACT: validateSessionCookieValue
//   PURPOSE: Validate cookie format, signature integrity, payload shape, and expiry for admin sessions.
//   INPUTS: { serializedCookieValue: string - Cookie token value, signingKey: string - Derived signing key, nowUnixSeconds: number - Current UNIX timestamp in seconds }
//   OUTPUTS: { SessionValidationResult - Valid session payload or deny reason }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-AUTH]
// END_CONTRACT: validateSessionCookieValue
function validateSessionCookieValue(
  serializedCookieValue: string,
  signingKey: string,
  nowUnixSeconds: number,
): SessionValidationResult {
  // START_BLOCK_VALIDATE_SESSION_COOKIE_STRUCTURE_AND_SIGNATURE_M_ADMIN_AUTH_010
  const segments = serializedCookieValue.split(".");
  if (segments.length !== 2) {
    return { isValid: false, reason: "INVALID_SESSION_COOKIE" };
  }

  const [encodedPayload, providedSignature] = segments;
  if (!encodedPayload || !providedSignature) {
    return { isValid: false, reason: "INVALID_SESSION_COOKIE" };
  }

  const expectedSignature = signSessionPayload(encodedPayload, signingKey);
  if (!safeCompareSecrets(expectedSignature, providedSignature)) {
    return { isValid: false, reason: "INVALID_SESSION_COOKIE" };
  }
  // END_BLOCK_VALIDATE_SESSION_COOKIE_STRUCTURE_AND_SIGNATURE_M_ADMIN_AUTH_010

  // START_BLOCK_VALIDATE_SESSION_COOKIE_PAYLOAD_AND_EXPIRY_M_ADMIN_AUTH_011
  let parsedPayload: unknown;
  try {
    const payloadJson = Buffer.from(encodedPayload, "base64url").toString("utf8");
    parsedPayload = JSON.parse(payloadJson) as unknown;
  } catch {
    return { isValid: false, reason: "INVALID_SESSION_COOKIE" };
  }

  if (!isAdminSessionPayload(parsedPayload)) {
    return { isValid: false, reason: "INVALID_SESSION_COOKIE" };
  }

  if (parsedPayload.iat > parsedPayload.exp) {
    return { isValid: false, reason: "INVALID_SESSION_COOKIE" };
  }

  if (parsedPayload.exp <= nowUnixSeconds) {
    return { isValid: false, reason: "EXPIRED_SESSION_COOKIE" };
  }

  return { isValid: true, payload: parsedPayload };
  // END_BLOCK_VALIDATE_SESSION_COOKIE_PAYLOAD_AND_EXPIRY_M_ADMIN_AUTH_011
}

// START_CONTRACT: buildRedirectDecision
//   PURPOSE: Produce a standard unauthenticated admin redirect decision payload.
//   INPUTS: { reason: AdminSessionDenyReason - Deny reason, setCookie: string|undefined - Optional clearing cookie }
//   OUTPUTS: { RequireAdminSessionResult - Redirect decision object for /admin/login }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-AUTH]
// END_CONTRACT: buildRedirectDecision
function buildRedirectDecision(
  reason: AdminSessionDenyReason,
  setCookie?: string,
): RequireAdminSessionResult {
  // START_BLOCK_BUILD_STANDARD_ADMIN_REDIRECT_DECISION_M_ADMIN_AUTH_012
  return {
    isAuthenticated: false,
    reason,
    status: 302,
    location: ADMIN_LOGIN_REDIRECT_PATH,
    setCookie,
  };
  // END_BLOCK_BUILD_STANDARD_ADMIN_REDIRECT_DECISION_M_ADMIN_AUTH_012
}

// START_CONTRACT: authenticateAdmin
//   PURPOSE: Authenticate admin login token against ROOT_AUTH_TOKEN and issue signed session cookie.
//   INPUTS: { loginToken: string - Submitted login token from /admin/login, config: AppConfig - Runtime config, logger: Logger - Structured logger }
//   OUTPUTS: { AuthenticateAdminResult - Authenticated result with Set-Cookie string or deny result }
//   SIDE_EFFECTS: [Writes structured auth decision logs]
//   LINKS: [M-ADMIN-AUTH, M-CONFIG, M-LOGGER]
// END_CONTRACT: authenticateAdmin
export function authenticateAdmin(
  loginToken: string,
  config: AppConfig,
  logger: Logger,
): AuthenticateAdminResult {
  // START_BLOCK_VALIDATE_LOGIN_TOKEN_AND_DISALLOW_MCP_FORMAT_M_ADMIN_AUTH_013
  const normalizedLoginToken = normalizeTokenCandidate(loginToken);
  if (!normalizedLoginToken || isDisallowedMcpBearerFormat(normalizedLoginToken)) {
    logger.warn(
      "Rejected admin login token due to disallowed format.",
      "authenticateAdmin",
      "VALIDATE_LOGIN_TOKEN_AND_DISALLOW_MCP_FORMAT",
      {
        reason: "DISALLOWED_MCP_BEARER_FORMAT",
        tokenLength: normalizedLoginToken.length,
      },
    );
    return {
      isAuthenticated: false,
      sessionCookie: null,
      reason: "DISALLOWED_MCP_BEARER_FORMAT",
    };
  }
  // END_BLOCK_VALIDATE_LOGIN_TOKEN_AND_DISALLOW_MCP_FORMAT_M_ADMIN_AUTH_013

  // START_BLOCK_COMPARE_ROOT_AUTH_TOKEN_AND_ISSUE_SESSION_COOKIE_M_ADMIN_AUTH_014
  try {
    const normalizedRootAuthToken = normalizeTokenCandidate(config.rootAuthToken);
    if (!normalizedRootAuthToken) {
      throw new AdminAuthError("ROOT_AUTH_TOKEN is unavailable for admin authentication.", {
        field: "rootAuthToken",
      });
    }

    if (!safeCompareSecrets(normalizedLoginToken, normalizedRootAuthToken)) {
      logger.warn(
        "Admin login token verification failed.",
        "authenticateAdmin",
        "COMPARE_ROOT_AUTH_TOKEN_AND_ISSUE_SESSION_COOKIE",
        {
          reason: "INVALID_LOGIN_TOKEN",
          tokenLength: normalizedLoginToken.length,
        },
      );
      return {
        isAuthenticated: false,
        sessionCookie: null,
        reason: "INVALID_LOGIN_TOKEN",
      };
    }

    const nowUnixSeconds = Math.floor(Date.now() / 1000);
    const payload: AdminSessionPayload = {
      v: ADMIN_SESSION_VERSION,
      scope: ADMIN_SESSION_SCOPE,
      iat: nowUnixSeconds,
      exp: nowUnixSeconds + ADMIN_SESSION_TTL_SECONDS,
    };

    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signingKey = deriveAdminSigningKey(config);
    const signature = signSessionPayload(encodedPayload, signingKey);
    const serializedSession = `${encodedPayload}.${signature}`;
    const sessionCookie = buildSessionCookie(serializedSession, ADMIN_SESSION_TTL_SECONDS);

    logger.info(
      "Admin login authenticated; issued signed session cookie.",
      "authenticateAdmin",
      "COMPARE_ROOT_AUTH_TOKEN_AND_ISSUE_SESSION_COOKIE",
      {
        ttlSeconds: ADMIN_SESSION_TTL_SECONDS,
      },
    );

    return {
      isAuthenticated: true,
      sessionCookie,
    };
  } catch (error: unknown) {
    throw toAdminAuthError(error, "Failed to authenticate admin login request.");
  }
  // END_BLOCK_COMPARE_ROOT_AUTH_TOKEN_AND_ISSUE_SESSION_COOKIE_M_ADMIN_AUTH_014
}

// START_CONTRACT: requireAdminSession
//   PURPOSE: Enforce admin route session guard by validating signed admin session cookie.
//   INPUTS: { request: Request - Incoming admin route request, config: AppConfig - Runtime config, logger: Logger - Structured logger }
//   OUTPUTS: { RequireAdminSessionResult - Authenticated allow decision or redirect-to-login decision }
//   SIDE_EFFECTS: [Writes structured auth guard logs]
//   LINKS: [M-ADMIN-AUTH, M-CONFIG, M-LOGGER]
// END_CONTRACT: requireAdminSession
export function requireAdminSession(
  request: Request,
  config: AppConfig,
  logger: Logger,
): RequireAdminSessionResult {
  // START_BLOCK_EXTRACT_ADMIN_SESSION_COOKIE_FROM_REQUEST_M_ADMIN_AUTH_015
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    logger.info(
      "Missing admin session cookie; redirecting to login.",
      "requireAdminSession",
      "EXTRACT_ADMIN_SESSION_COOKIE_FROM_REQUEST",
      {
        reason: "MISSING_SESSION_COOKIE",
      },
    );
    return buildRedirectDecision("MISSING_SESSION_COOKIE");
  }

  const sessionCookieValue = parseCookieValue(cookieHeader, ADMIN_SESSION_COOKIE_NAME);
  if (!sessionCookieValue) {
    logger.info(
      "Admin session cookie not found in cookie header; redirecting to login.",
      "requireAdminSession",
      "EXTRACT_ADMIN_SESSION_COOKIE_FROM_REQUEST",
      {
        reason: "MISSING_SESSION_COOKIE",
      },
    );
    return buildRedirectDecision("MISSING_SESSION_COOKIE");
  }
  // END_BLOCK_EXTRACT_ADMIN_SESSION_COOKIE_FROM_REQUEST_M_ADMIN_AUTH_015

  // START_BLOCK_VALIDATE_ADMIN_SESSION_COOKIE_AND_RETURN_DECISION_M_ADMIN_AUTH_016
  try {
    const signingKey = deriveAdminSigningKey(config);
    const nowUnixSeconds = Math.floor(Date.now() / 1000);
    const validationResult = validateSessionCookieValue(sessionCookieValue, signingKey, nowUnixSeconds);

    if (!validationResult.isValid) {
      const clearCookie = clearAdminSession();
      logger.warn(
        "Admin session cookie rejected; redirecting to login.",
        "requireAdminSession",
        "VALIDATE_ADMIN_SESSION_COOKIE_AND_RETURN_DECISION",
        {
          reason: validationResult.reason,
        },
      );
      return buildRedirectDecision(validationResult.reason, clearCookie);
    }

    logger.debug(
      "Admin session cookie validated successfully.",
      "requireAdminSession",
      "VALIDATE_ADMIN_SESSION_COOKIE_AND_RETURN_DECISION",
      {
        expiresAtUnixSeconds: validationResult.payload.exp,
      },
    );
    return { isAuthenticated: true };
  } catch (error: unknown) {
    throw toAdminAuthError(error, "Failed to validate admin session cookie.");
  }
  // END_BLOCK_VALIDATE_ADMIN_SESSION_COOKIE_AND_RETURN_DECISION_M_ADMIN_AUTH_016
}

// START_CONTRACT: clearAdminSession
//   PURPOSE: Build Set-Cookie string that invalidates admin session cookie immediately.
//   INPUTS: {}
//   OUTPUTS: { string - Set-Cookie header value that clears admin session state }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADMIN-AUTH]
// END_CONTRACT: clearAdminSession
export function clearAdminSession(): string {
  // START_BLOCK_BUILD_CLEAR_ADMIN_SESSION_COOKIE_HEADER_M_ADMIN_AUTH_017
  const epochUtcString = new Date(0).toUTCString();
  return [
    `${ADMIN_SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    `SameSite=${ADMIN_SESSION_SAME_SITE_POLICY}`,
    "Max-Age=0",
    `Expires=${epochUtcString}`,
  ].join("; ");
  // END_BLOCK_BUILD_CLEAR_ADMIN_SESSION_COOKIE_HEADER_M_ADMIN_AUTH_017
}
