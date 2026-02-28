// FILE: src/portal/auth.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Issue and validate tester portal session cookies and enforce portal-route authorization checks.
//   SCOPE: Create signed session cookies for portal users, validate cookie signatures and expiry for route guards, and provide session clearing helper.
//   DEPENDS: M-CONFIG, M-LOGGER
//   LINKS: M-PORTAL-AUTH, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   PortalAuthError - Typed portal auth failure for exceptional internal errors with PORTAL_AUTH_ERROR code.
//   PortalSessionPayload - Session payload shape carrying user identity and expiry metadata.
//   AuthenticatePortalUserResult - Result envelope for portal OAuth callback authentication.
//   RequirePortalSessionResult - Result envelope for portal session guard allow-or-redirect decision.
//   authenticatePortalUser - Create portal session from successful social OAuth callback identity result.
//   requirePortalSession - Allow or redirect for protected /portal/* routes.
//   clearPortalSession - Invalidate tester portal session cookie.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation from development plan for M-PORTAL-AUTH with signed cookie auth flow.
// END_CHANGE_SUMMARY

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";

const PORTAL_LOGIN_REDIRECT_PATH = "/portal/login" as const;
const PORTAL_SESSION_COOKIE_NAME = "portal_session";
const PORTAL_SESSION_SCOPE = "portal" as const;
const PORTAL_SESSION_VERSION = 1 as const;
const PORTAL_SESSION_SAME_SITE_POLICY = "Lax" as const;
const PORTAL_SIGNING_KEY_CONTEXT = "m-portal-auth-session-signing-v1";

type PortalSessionDenyReason =
  | "MISSING_SESSION_COOKIE"
  | "INVALID_SESSION_COOKIE"
  | "EXPIRED_SESSION_COOKIE";

type PortalSessionPayload = {
  v: typeof PORTAL_SESSION_VERSION;
  scope: typeof PORTAL_SESSION_SCOPE;
  sub: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
};

type SessionValidationResult =
  | { isValid: true; payload: PortalSessionPayload }
  | { isValid: false; reason: PortalSessionDenyReason };

export type PortalIdentityResult = {
  userId: string;
  email: string;
  name: string;
};

export type AuthenticatePortalUserResult = {
  isAuthenticated: true;
  sessionCookie: string;
  userId: string;
};

export type RequirePortalSessionResult =
  | { isAuthenticated: true; session: PortalSessionPayload }
  | {
      isAuthenticated: false;
      reason: PortalSessionDenyReason;
      status: 302;
      location: typeof PORTAL_LOGIN_REDIRECT_PATH;
      setCookie?: string;
    };

export class PortalAuthError extends Error {
  public readonly code = "PORTAL_AUTH_ERROR" as const;
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PortalAuthError";
    this.details = details;
  }
}

// START_CONTRACT: safeCompareSecrets
//   PURPOSE: Compare sensitive text values using timing-safe comparison when lengths match.
//   INPUTS: { leftSecret: string - Left secret value, rightSecret: string - Right secret value }
//   OUTPUTS: { boolean - True when both secret values are equal }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-AUTH]
// END_CONTRACT: safeCompareSecrets
function safeCompareSecrets(leftSecret: string, rightSecret: string): boolean {
  // START_BLOCK_COMPARE_SECRET_VALUES_CONSTANT_TIME_M_PORTAL_AUTH_001
  const leftBuffer = Buffer.from(leftSecret);
  const rightBuffer = Buffer.from(rightSecret);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
  // END_BLOCK_COMPARE_SECRET_VALUES_CONSTANT_TIME_M_PORTAL_AUTH_001
}

// START_CONTRACT: toPortalAuthError
//   PURPOSE: Normalize unknown runtime failures into PortalAuthError with safe diagnostics.
//   INPUTS: { error: unknown - Runtime failure, message: string - Stable error message, details: Record<string, unknown>|undefined - Additional context }
//   OUTPUTS: { PortalAuthError - Typed portal auth error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-AUTH]
// END_CONTRACT: toPortalAuthError
function toPortalAuthError(
  error: unknown,
  message: string,
  details?: Record<string, unknown>,
): PortalAuthError {
  // START_BLOCK_MAP_UNKNOWN_FAILURE_TO_TYPED_PORTAL_AUTH_ERROR_M_PORTAL_AUTH_002
  if (error instanceof PortalAuthError) {
    return error;
  }

  const cause = error instanceof Error ? error.message : String(error);
  return new PortalAuthError(message, {
    ...details,
    cause,
  });
  // END_BLOCK_MAP_UNKNOWN_FAILURE_TO_TYPED_PORTAL_AUTH_ERROR_M_PORTAL_AUTH_002
}

// START_CONTRACT: derivePortalSigningKey
//   PURPOSE: Derive deterministic HMAC key material from portal session secret for portal session cookie signatures.
//   INPUTS: { config: AppConfig - Runtime configuration from M-CONFIG }
//   OUTPUTS: { string - Derived signing key }
//   SIDE_EFFECTS: [Throws PortalAuthError if config is missing required key material]
//   LINKS: [M-PORTAL-AUTH, M-CONFIG]
// END_CONTRACT: derivePortalSigningKey
function derivePortalSigningKey(config: AppConfig): string {
  // START_BLOCK_DERIVE_PORTAL_COOKIE_SIGNING_KEY_M_PORTAL_AUTH_003
  const sessionSecret = config.portal.sessionSecret.trim();
  if (!sessionSecret) {
    throw new PortalAuthError("Portal session secret is missing for portal auth module.", {
      field: "portal.sessionSecret",
    });
  }

  return createHash("sha256")
    .update(`${PORTAL_SIGNING_KEY_CONTEXT}:${sessionSecret}`, "utf8")
    .digest("base64url");
  // END_BLOCK_DERIVE_PORTAL_COOKIE_SIGNING_KEY_M_PORTAL_AUTH_003
}

// START_CONTRACT: signSessionPayload
//   PURPOSE: Compute HMAC-SHA256 signature for serialized portal session payload.
//   INPUTS: { encodedPayload: string - Base64url JSON payload, signingKey: string - Derived signing key }
//   OUTPUTS: { string - Base64url encoded signature }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-AUTH]
// END_CONTRACT: signSessionPayload
function signSessionPayload(encodedPayload: string, signingKey: string): string {
  // START_BLOCK_SIGN_PORTAL_SESSION_PAYLOAD_M_PORTAL_AUTH_004
  return createHmac("sha256", signingKey).update(encodedPayload, "utf8").digest("base64url");
  // END_BLOCK_SIGN_PORTAL_SESSION_PAYLOAD_M_PORTAL_AUTH_004
}

// START_CONTRACT: buildSessionCookie
//   PURPOSE: Build Set-Cookie string for an active portal session.
//   INPUTS: { sessionValue: string - Serialized and signed cookie value, maxAgeSeconds: number - Cookie TTL in seconds }
//   OUTPUTS: { string - Set-Cookie header value }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-AUTH]
// END_CONTRACT: buildSessionCookie
function buildSessionCookie(sessionValue: string, maxAgeSeconds: number): string {
  // START_BLOCK_BUILD_SET_COOKIE_HEADER_FOR_PORTAL_SESSION_M_PORTAL_AUTH_005
  return [
    `${PORTAL_SESSION_COOKIE_NAME}=${sessionValue}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${PORTAL_SESSION_SAME_SITE_POLICY}`,
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
  // END_BLOCK_BUILD_SET_COOKIE_HEADER_FOR_PORTAL_SESSION_M_PORTAL_AUTH_005
}

// START_CONTRACT: parseCookieValue
//   PURPOSE: Extract cookie value by name from Cookie header string.
//   INPUTS: { cookieHeader: string - Request Cookie header, cookieName: string - Cookie key to extract }
//   OUTPUTS: { string|null - Cookie value or null when absent }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-AUTH]
// END_CONTRACT: parseCookieValue
function parseCookieValue(cookieHeader: string, cookieName: string): string | null {
  // START_BLOCK_PARSE_COOKIE_HEADER_FOR_NAMED_VALUE_M_PORTAL_AUTH_006
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
  // END_BLOCK_PARSE_COOKIE_HEADER_FOR_NAMED_VALUE_M_PORTAL_AUTH_006
}

// START_CONTRACT: isPortalSessionPayload
//   PURPOSE: Validate decoded payload object shape for portal session cookies.
//   INPUTS: { payload: unknown - Decoded payload candidate }
//   OUTPUTS: { payload is PortalSessionPayload - Type guard for session payload }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-AUTH]
// END_CONTRACT: isPortalSessionPayload
function isPortalSessionPayload(payload: unknown): payload is PortalSessionPayload {
  // START_BLOCK_VALIDATE_PORTAL_SESSION_PAYLOAD_SHAPE_M_PORTAL_AUTH_007
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    candidate["v"] === PORTAL_SESSION_VERSION &&
    candidate["scope"] === PORTAL_SESSION_SCOPE &&
    typeof candidate["sub"] === "string" &&
    candidate["sub"].length > 0 &&
    typeof candidate["email"] === "string" &&
    candidate["email"].length > 0 &&
    typeof candidate["name"] === "string" &&
    candidate["name"].length > 0 &&
    typeof candidate["iat"] === "number" &&
    Number.isInteger(candidate["iat"]) &&
    candidate["iat"] > 0 &&
    typeof candidate["exp"] === "number" &&
    Number.isInteger(candidate["exp"]) &&
    candidate["exp"] > 0
  );
  // END_BLOCK_VALIDATE_PORTAL_SESSION_PAYLOAD_SHAPE_M_PORTAL_AUTH_007
}

// START_CONTRACT: validateSessionCookieValue
//   PURPOSE: Validate cookie format, signature integrity, payload shape, and expiry for portal sessions.
//   INPUTS: { serializedCookieValue: string - Cookie token value, signingKey: string - Derived signing key, nowUnixSeconds: number - Current UNIX timestamp in seconds }
//   OUTPUTS: { SessionValidationResult - Valid session payload or deny reason }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-AUTH]
// END_CONTRACT: validateSessionCookieValue
function validateSessionCookieValue(
  serializedCookieValue: string,
  signingKey: string,
  nowUnixSeconds: number,
): SessionValidationResult {
  // START_BLOCK_VALIDATE_SESSION_COOKIE_STRUCTURE_AND_SIGNATURE_M_PORTAL_AUTH_008
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
  // END_BLOCK_VALIDATE_SESSION_COOKIE_STRUCTURE_AND_SIGNATURE_M_PORTAL_AUTH_008

  // START_BLOCK_VALIDATE_SESSION_COOKIE_PAYLOAD_AND_EXPIRY_M_PORTAL_AUTH_009
  let parsedPayload: unknown;
  try {
    const payloadJson = Buffer.from(encodedPayload, "base64url").toString("utf8");
    parsedPayload = JSON.parse(payloadJson) as unknown;
  } catch {
    return { isValid: false, reason: "INVALID_SESSION_COOKIE" };
  }

  if (!isPortalSessionPayload(parsedPayload)) {
    return { isValid: false, reason: "INVALID_SESSION_COOKIE" };
  }

  if (parsedPayload.iat > parsedPayload.exp) {
    return { isValid: false, reason: "INVALID_SESSION_COOKIE" };
  }

  if (parsedPayload.exp <= nowUnixSeconds) {
    return { isValid: false, reason: "EXPIRED_SESSION_COOKIE" };
  }

  return { isValid: true, payload: parsedPayload };
  // END_BLOCK_VALIDATE_SESSION_COOKIE_PAYLOAD_AND_EXPIRY_M_PORTAL_AUTH_009
}

// START_CONTRACT: buildRedirectDecision
//   PURPOSE: Produce a standard unauthenticated portal redirect decision payload.
//   INPUTS: { reason: PortalSessionDenyReason - Deny reason, setCookie: string|undefined - Optional clearing cookie }
//   OUTPUTS: { RequirePortalSessionResult - Redirect decision object for /portal/login }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-AUTH]
// END_CONTRACT: buildRedirectDecision
function buildRedirectDecision(
  reason: PortalSessionDenyReason,
  setCookie?: string,
): RequirePortalSessionResult {
  // START_BLOCK_BUILD_STANDARD_PORTAL_REDIRECT_DECISION_M_PORTAL_AUTH_010
  return {
    isAuthenticated: false,
    reason,
    status: 302,
    location: PORTAL_LOGIN_REDIRECT_PATH,
    setCookie,
  };
  // END_BLOCK_BUILD_STANDARD_PORTAL_REDIRECT_DECISION_M_PORTAL_AUTH_010
}

// START_CONTRACT: authenticatePortalUser
//   PURPOSE: Create portal session from successful social OAuth callback identity result.
//   INPUTS: { identityResult: PortalIdentityResult - OAuth identity payload with userId, email, and name, config: AppConfig - Runtime config, logger: Logger - Structured logger }
//   OUTPUTS: { AuthenticatePortalUserResult - Authenticated result with Set-Cookie string and userId }
//   SIDE_EFFECTS: [Writes structured auth decision logs]
//   LINKS: [M-PORTAL-AUTH, M-CONFIG, M-LOGGER]
// END_CONTRACT: authenticatePortalUser
export function authenticatePortalUser(
  identityResult: PortalIdentityResult,
  config: AppConfig,
  logger: Logger,
): AuthenticatePortalUserResult {
  // START_BLOCK_BUILD_PORTAL_SESSION_FROM_IDENTITY_RESULT_M_PORTAL_AUTH_011
  try {
    const ttlSeconds = config.portal.sessionTtlSeconds;
    const nowUnixSeconds = Math.floor(Date.now() / 1000);
    const payload: PortalSessionPayload = {
      v: PORTAL_SESSION_VERSION,
      scope: PORTAL_SESSION_SCOPE,
      sub: identityResult.userId,
      email: identityResult.email,
      name: identityResult.name,
      iat: nowUnixSeconds,
      exp: nowUnixSeconds + ttlSeconds,
    };

    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signingKey = derivePortalSigningKey(config);
    const signature = signSessionPayload(encodedPayload, signingKey);
    const serializedSession = `${encodedPayload}.${signature}`;
    const sessionCookie = buildSessionCookie(serializedSession, ttlSeconds);

    logger.info(
      "Portal user authenticated; issued signed session cookie.",
      "authenticatePortalUser",
      "BUILD_PORTAL_SESSION_FROM_IDENTITY_RESULT",
      {
        userId: identityResult.userId,
        email: identityResult.email,
        ttlSeconds,
      },
    );

    return {
      isAuthenticated: true,
      sessionCookie,
      userId: identityResult.userId,
    };
  } catch (error: unknown) {
    throw toPortalAuthError(error, "Failed to create portal session from identity result.");
  }
  // END_BLOCK_BUILD_PORTAL_SESSION_FROM_IDENTITY_RESULT_M_PORTAL_AUTH_011
}

// START_CONTRACT: requirePortalSession
//   PURPOSE: Allow or redirect for protected /portal/* routes by validating signed portal session cookie.
//   INPUTS: { request: Request - Incoming portal route request, config: AppConfig - Runtime config, logger: Logger - Structured logger }
//   OUTPUTS: { RequirePortalSessionResult - Authenticated allow decision with session or redirect-to-login decision }
//   SIDE_EFFECTS: [Writes structured auth guard logs]
//   LINKS: [M-PORTAL-AUTH, M-CONFIG, M-LOGGER]
// END_CONTRACT: requirePortalSession
export function requirePortalSession(
  request: Request,
  config: AppConfig,
  logger: Logger,
): RequirePortalSessionResult {
  // START_BLOCK_EXTRACT_PORTAL_SESSION_COOKIE_FROM_REQUEST_M_PORTAL_AUTH_012
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    logger.info(
      "Missing portal session cookie; redirecting to login.",
      "requirePortalSession",
      "EXTRACT_PORTAL_SESSION_COOKIE_FROM_REQUEST",
      {
        reason: "MISSING_SESSION_COOKIE",
      },
    );
    return buildRedirectDecision("MISSING_SESSION_COOKIE");
  }

  const sessionCookieValue = parseCookieValue(cookieHeader, PORTAL_SESSION_COOKIE_NAME);
  if (!sessionCookieValue) {
    logger.info(
      "Portal session cookie not found in cookie header; redirecting to login.",
      "requirePortalSession",
      "EXTRACT_PORTAL_SESSION_COOKIE_FROM_REQUEST",
      {
        reason: "MISSING_SESSION_COOKIE",
      },
    );
    return buildRedirectDecision("MISSING_SESSION_COOKIE");
  }
  // END_BLOCK_EXTRACT_PORTAL_SESSION_COOKIE_FROM_REQUEST_M_PORTAL_AUTH_012

  // START_BLOCK_VALIDATE_PORTAL_SESSION_COOKIE_AND_RETURN_DECISION_M_PORTAL_AUTH_013
  try {
    const signingKey = derivePortalSigningKey(config);
    const nowUnixSeconds = Math.floor(Date.now() / 1000);
    const validationResult = validateSessionCookieValue(sessionCookieValue, signingKey, nowUnixSeconds);

    if (!validationResult.isValid) {
      const clearCookie = clearPortalSession();
      logger.warn(
        "Portal session cookie rejected; redirecting to login.",
        "requirePortalSession",
        "VALIDATE_PORTAL_SESSION_COOKIE_AND_RETURN_DECISION",
        {
          reason: validationResult.reason,
        },
      );
      return buildRedirectDecision(validationResult.reason, clearCookie);
    }

    logger.debug(
      "Portal session cookie validated successfully.",
      "requirePortalSession",
      "VALIDATE_PORTAL_SESSION_COOKIE_AND_RETURN_DECISION",
      {
        userId: validationResult.payload.sub,
        expiresAtUnixSeconds: validationResult.payload.exp,
      },
    );
    return { isAuthenticated: true, session: validationResult.payload };
  } catch (error: unknown) {
    throw toPortalAuthError(error, "Failed to validate portal session cookie.");
  }
  // END_BLOCK_VALIDATE_PORTAL_SESSION_COOKIE_AND_RETURN_DECISION_M_PORTAL_AUTH_013
}

// START_CONTRACT: clearPortalSession
//   PURPOSE: Build Set-Cookie string that invalidates portal session cookie immediately.
//   INPUTS: {}
//   OUTPUTS: { string - Set-Cookie header value that clears portal session state }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-PORTAL-AUTH]
// END_CONTRACT: clearPortalSession
export function clearPortalSession(): string {
  // START_BLOCK_BUILD_CLEAR_PORTAL_SESSION_COOKIE_HEADER_M_PORTAL_AUTH_014
  const epochUtcString = new Date(0).toUTCString();
  return [
    `${PORTAL_SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    `SameSite=${PORTAL_SESSION_SAME_SITE_POLICY}`,
    "Max-Age=0",
    `Expires=${epochUtcString}`,
  ].join("; ");
  // END_BLOCK_BUILD_CLEAR_PORTAL_SESSION_COOKIE_HEADER_M_PORTAL_AUTH_014
}
