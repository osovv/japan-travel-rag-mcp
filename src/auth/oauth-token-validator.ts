// FILE: src/auth/oauth-token-validator.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate OAuth access tokens for /mcp using JWT signature and required claims checks.
//   SCOPE: Parse strict Bearer authorization headers, decode JWT header/payload, verify signature with JWKS key resolution, validate issuer/audience/time claims, enforce required scopes, and return guard-ready allow/deny results.
//   DEPENDS: M-OAUTH-JWKS, M-CONFIG, M-LOGGER
//   LINKS: M-OAUTH-TOKEN-VALIDATOR, M-OAUTH-JWKS, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   OAUTH_TOKEN_VALIDATION_ERROR - Typed error code for internal token validation failures.
//   OAuthTokenValidationError - Typed error for dependency/contract/internal validator failures.
//   OAuthTokenValidationResult - Guard-ready validation decision result with success and deny variants.
//   createOAuthTokenValidator - Build reusable validator with injected config/logger/JWKS resolver.
//   validateAccessToken - Validate strict Bearer Authorization header and return structured token decision.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation from development plan for M-OAUTH-TOKEN-VALIDATOR with JWT signature, claims, and scope validation.
// END_CHANGE_SUMMARY

import { loadConfig } from "../config/index";
import type { AppConfig } from "../config/index";
import { createLogger } from "../logger/index";
import type { Logger } from "../logger/index";
import {
  getSigningKey as defaultGetSigningKey,
  OAUTH_JWKS_ERROR,
  type OAuthJwksKey,
  OAuthJwksError,
} from "./oauth-jwks-client";

const BEARER_HEADER_PATTERN = /^Bearer ([^\s]+)$/;
const BASELINE_REQUIRED_SCOPE = "mcp:access";
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

type SubtleImportAlgorithm = Parameters<SubtleCrypto["importKey"]>[2];
type SubtleVerifyAlgorithm = Parameters<SubtleCrypto["verify"]>[0];

export const OAUTH_TOKEN_VALIDATION_ERROR = "OAUTH_TOKEN_VALIDATION_ERROR" as const;

type OAuthTokenValidationErrorReason =
  | "INVALID_DEPENDENCIES"
  | "INVALID_CONTEXT"
  | "JWKS_RESOLUTION_FAILED"
  | "CRYPTO_RUNTIME_FAILURE";

type OAuthTokenValidationErrorDetails = {
  reason: OAuthTokenValidationErrorReason;
  field?: string;
  cause?: string;
  tokenKid?: string;
  tokenAlg?: string;
};

export class OAuthTokenValidationError extends Error {
  public readonly code = OAUTH_TOKEN_VALIDATION_ERROR;
  public readonly details?: OAuthTokenValidationErrorDetails;

  public constructor(message: string, details?: OAuthTokenValidationErrorDetails) {
    super(message);
    this.name = "OAuthTokenValidationError";
    this.details = details;
  }
}

export type OAuthTokenValidationFailure = {
  isValid: false;
  error: "invalid_token" | "insufficient_scope";
  errorDescription: string;
};

export type OAuthTokenValidationSuccess = {
  isValid: true;
  subject?: string;
  grantedScopes: string[];
};

export type OAuthTokenValidationResult = OAuthTokenValidationSuccess | OAuthTokenValidationFailure;

export type ValidateAccessTokenContext = {
  requiredScopes?: string[];
  issuer?: string;
  audience?: string;
  resource?: string;
};

type SigningKeyResolver = (kid: string) => Promise<OAuthJwksKey>;

export type OAuthTokenValidatorDependencies = {
  config: AppConfig;
  logger: Logger;
  getSigningKey?: SigningKeyResolver;
  now?: () => number;
};

export type OAuthTokenValidator = {
  validateAccessToken: (
    authorizationHeader: string | null,
    context?: ValidateAccessTokenContext,
  ) => Promise<OAuthTokenValidationResult>;
};

type TokenValidationRejectionCode = "invalid_token" | "insufficient_scope";

class TokenValidationRejection extends Error {
  public readonly error: TokenValidationRejectionCode;

  public constructor(error: TokenValidationRejectionCode, errorDescription: string) {
    super(errorDescription);
    this.name = "TokenValidationRejection";
    this.error = error;
  }
}

type ParsedJwt = {
  token: string;
  signingInput: string;
  signature: Uint8Array;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
};

type JwtAlgorithmDescriptor = {
  expectedKty: "RSA" | "EC";
  importAlgorithm: SubtleImportAlgorithm;
  verifyAlgorithm: SubtleVerifyAlgorithm;
};

// START_CONTRACT: isPlainObject
//   PURPOSE: Narrow unknown runtime values to plain JSON object records.
//   INPUTS: { value: unknown - Candidate value to inspect }
//   OUTPUTS: { boolean - True when value is a non-null, non-array object with plain prototype }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: isPlainObject
function isPlainObject(value: unknown): value is Record<string, unknown> {
  // START_BLOCK_VALIDATE_PLAIN_OBJECT_INPUT_M_OAUTH_TOKEN_VALIDATOR_001
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
  // END_BLOCK_VALIDATE_PLAIN_OBJECT_INPUT_M_OAUTH_TOKEN_VALIDATOR_001
}

// START_CONTRACT: normalizeOptionalString
//   PURPOSE: Normalize optional string-like values and drop empty results.
//   INPUTS: { value: unknown - Candidate value to normalize }
//   OUTPUTS: { string | undefined - Trimmed non-empty string or undefined }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: normalizeOptionalString
function normalizeOptionalString(value: unknown): string | undefined {
  // START_BLOCK_NORMALIZE_OPTIONAL_STRING_VALUE_M_OAUTH_TOKEN_VALIDATOR_002
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
  // END_BLOCK_NORMALIZE_OPTIONAL_STRING_VALUE_M_OAUTH_TOKEN_VALIDATOR_002
}

// START_CONTRACT: normalizeRequiredScopeList
//   PURPOSE: Normalize required scope lists by trimming, removing empties, and deduplicating values.
//   INPUTS: { scopes: readonly string[] - Scope list to normalize }
//   OUTPUTS: { string[] - Ordered unique normalized scopes }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: normalizeRequiredScopeList
function normalizeRequiredScopeList(scopes: readonly string[]): string[] {
  // START_BLOCK_NORMALIZE_REQUIRED_SCOPE_VALUES_M_OAUTH_TOKEN_VALIDATOR_003
  const normalizedScopes = new Set<string>();
  for (const scope of scopes) {
    const normalizedScope = normalizeOptionalString(scope);
    if (normalizedScope) {
      normalizedScopes.add(normalizedScope);
    }
  }
  return [...normalizedScopes];
  // END_BLOCK_NORMALIZE_REQUIRED_SCOPE_VALUES_M_OAUTH_TOKEN_VALIDATOR_003
}

// START_CONTRACT: assertDependencies
//   PURPOSE: Validate validator dependency wiring and config prerequisites.
//   INPUTS: { dependencies: OAuthTokenValidatorDependencies - Runtime dependencies for token validation }
//   OUTPUTS: { void - Throws on invalid dependency contract }
//   SIDE_EFFECTS: [Throws OAuthTokenValidationError for invalid dependencies]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR, M-CONFIG, M-LOGGER, M-OAUTH-JWKS]
// END_CONTRACT: assertDependencies
function assertDependencies(dependencies: OAuthTokenValidatorDependencies): void {
  // START_BLOCK_VALIDATE_VALIDATOR_DEPENDENCIES_M_OAUTH_TOKEN_VALIDATOR_004
  if (!dependencies || typeof dependencies !== "object") {
    throw new OAuthTokenValidationError("OAuth token validator dependencies are required.", {
      reason: "INVALID_DEPENDENCIES",
      field: "dependencies",
    });
  }

  if (!dependencies.config || typeof dependencies.config !== "object") {
    throw new OAuthTokenValidationError("OAuth token validator requires config dependency.", {
      reason: "INVALID_DEPENDENCIES",
      field: "config",
    });
  }

  if (
    !dependencies.logger ||
    typeof dependencies.logger.info !== "function" ||
    typeof dependencies.logger.warn !== "function" ||
    typeof dependencies.logger.error !== "function" ||
    typeof dependencies.logger.child !== "function"
  ) {
    throw new OAuthTokenValidationError("OAuth token validator requires logger dependency.", {
      reason: "INVALID_DEPENDENCIES",
      field: "logger",
    });
  }

  if (
    !Number.isInteger(dependencies.config.oauth.clockSkewSec) ||
    dependencies.config.oauth.clockSkewSec < 0 ||
    dependencies.config.oauth.clockSkewSec > 300
  ) {
    throw new OAuthTokenValidationError(
      "config.oauth.clockSkewSec must be an integer between 0 and 300.",
      {
        reason: "INVALID_DEPENDENCIES",
        field: "config.oauth.clockSkewSec",
      },
    );
  }

  if (
    typeof globalThis.crypto === "undefined" ||
    typeof globalThis.crypto.subtle === "undefined"
  ) {
    throw new OAuthTokenValidationError("WebCrypto subtle API is unavailable for token validation.", {
      reason: "CRYPTO_RUNTIME_FAILURE",
      field: "globalThis.crypto.subtle",
    });
  }
  // END_BLOCK_VALIDATE_VALIDATOR_DEPENDENCIES_M_OAUTH_TOKEN_VALIDATOR_004
}

// START_CONTRACT: assertContextShape
//   PURPOSE: Validate optional per-call validation context contract.
//   INPUTS: { context: ValidateAccessTokenContext | undefined - Optional runtime override context }
//   OUTPUTS: { void - Throws on invalid context structure }
//   SIDE_EFFECTS: [Throws OAuthTokenValidationError for invalid context contract]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: assertContextShape
function assertContextShape(context: ValidateAccessTokenContext | undefined): void {
  // START_BLOCK_VALIDATE_PER_CALL_CONTEXT_SHAPE_M_OAUTH_TOKEN_VALIDATOR_005
  if (context === undefined) {
    return;
  }

  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw new OAuthTokenValidationError("Validation context must be an object when provided.", {
      reason: "INVALID_CONTEXT",
      field: "context",
    });
  }

  if (context.requiredScopes !== undefined && !Array.isArray(context.requiredScopes)) {
    throw new OAuthTokenValidationError("context.requiredScopes must be an array when provided.", {
      reason: "INVALID_CONTEXT",
      field: "context.requiredScopes",
    });
  }

  if (context.issuer !== undefined && typeof context.issuer !== "string") {
    throw new OAuthTokenValidationError("context.issuer must be a string when provided.", {
      reason: "INVALID_CONTEXT",
      field: "context.issuer",
    });
  }

  if (context.audience !== undefined && typeof context.audience !== "string") {
    throw new OAuthTokenValidationError("context.audience must be a string when provided.", {
      reason: "INVALID_CONTEXT",
      field: "context.audience",
    });
  }

  if (context.resource !== undefined && typeof context.resource !== "string") {
    throw new OAuthTokenValidationError("context.resource must be a string when provided.", {
      reason: "INVALID_CONTEXT",
      field: "context.resource",
    });
  }
  // END_BLOCK_VALIDATE_PER_CALL_CONTEXT_SHAPE_M_OAUTH_TOKEN_VALIDATOR_005
}

// START_CONTRACT: parseAuthorizationHeader
//   PURPOSE: Parse strict Bearer Authorization header and return raw access token value.
//   INPUTS: { authorizationHeader: string | null - Incoming Authorization header value }
//   OUTPUTS: { string - Raw access token from strict Bearer header }
//   SIDE_EFFECTS: [Throws TokenValidationRejection with invalid_token for malformed header]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: parseAuthorizationHeader
function parseAuthorizationHeader(authorizationHeader: string | null): string {
  // START_BLOCK_PARSE_STRICT_BEARER_AUTHORIZATION_HEADER_M_OAUTH_TOKEN_VALIDATOR_006
  if (authorizationHeader === null) {
    throw new TokenValidationRejection(
      "invalid_token",
      "Authorization header is required and must use Bearer token format.",
    );
  }

  const match = BEARER_HEADER_PATTERN.exec(authorizationHeader);
  if (!match) {
    throw new TokenValidationRejection(
      "invalid_token",
      "Authorization header must use strict Bearer token format.",
    );
  }

  const token = match[1];
  if (!token) {
    throw new TokenValidationRejection(
      "invalid_token",
      "Authorization header must include a non-empty Bearer token.",
    );
  }

  return token;
  // END_BLOCK_PARSE_STRICT_BEARER_AUTHORIZATION_HEADER_M_OAUTH_TOKEN_VALIDATOR_006
}

// START_CONTRACT: decodeBase64UrlSegment
//   PURPOSE: Decode a base64url segment into raw bytes with strict alphabet validation.
//   INPUTS: { value: string - Encoded JWT segment, fieldName: string - Field label for diagnostics }
//   OUTPUTS: { Uint8Array - Decoded raw bytes }
//   SIDE_EFFECTS: [Throws TokenValidationRejection with invalid_token for malformed segments]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: decodeBase64UrlSegment
function decodeBase64UrlSegment(value: string, fieldName: string): Uint8Array {
  // START_BLOCK_DECODE_BASE64URL_SEGMENT_M_OAUTH_TOKEN_VALIDATOR_007
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TokenValidationRejection(
      "invalid_token",
      `${fieldName} segment is not valid base64url data.`,
    );
  }

  const normalizedBase64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalizedBase64.length % 4)) % 4;
  const paddedBase64 = `${normalizedBase64}${"=".repeat(padLength)}`;
  const decoded = Buffer.from(paddedBase64, "base64");

  if (decoded.length === 0) {
    throw new TokenValidationRejection(
      "invalid_token",
      `${fieldName} segment decoded to an empty payload.`,
    );
  }

  return Uint8Array.from(decoded);
  // END_BLOCK_DECODE_BASE64URL_SEGMENT_M_OAUTH_TOKEN_VALIDATOR_007
}

// START_CONTRACT: parseJsonSegmentObject
//   PURPOSE: Parse decoded JWT JSON segment and enforce object payload shape.
//   INPUTS: { segment: string - Encoded JWT segment, fieldName: string - Segment label for diagnostics }
//   OUTPUTS: { Record<string, unknown> - Parsed object payload }
//   SIDE_EFFECTS: [Throws TokenValidationRejection with invalid_token for malformed JSON segments]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: parseJsonSegmentObject
function parseJsonSegmentObject(segment: string, fieldName: string): Record<string, unknown> {
  // START_BLOCK_PARSE_JSON_SEGMENT_OBJECT_M_OAUTH_TOKEN_VALIDATOR_008
  const bytes = decodeBase64UrlSegment(segment, fieldName);
  let parsed: unknown;
  try {
    parsed = JSON.parse(TEXT_DECODER.decode(bytes));
  } catch {
    throw new TokenValidationRejection("invalid_token", `${fieldName} segment contains invalid JSON.`);
  }

  if (!isPlainObject(parsed)) {
    throw new TokenValidationRejection(
      "invalid_token",
      `${fieldName} segment JSON must be an object.`,
    );
  }

  return parsed;
  // END_BLOCK_PARSE_JSON_SEGMENT_OBJECT_M_OAUTH_TOKEN_VALIDATOR_008
}

// START_CONTRACT: parseJwt
//   PURPOSE: Parse token into JWT header, payload, signature, and signing input components.
//   INPUTS: { token: string - Raw Bearer token value }
//   OUTPUTS: { ParsedJwt - Parsed token components for signature and claim validation }
//   SIDE_EFFECTS: [Throws TokenValidationRejection with invalid_token for malformed JWT format]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: parseJwt
function parseJwt(token: string): ParsedJwt {
  // START_BLOCK_PARSE_JWT_COMPONENTS_M_OAUTH_TOKEN_VALIDATOR_009
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new TokenValidationRejection(
      "invalid_token",
      "Bearer token must be a JWT with three segments.",
    );
  }

  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    throw new TokenValidationRejection(
      "invalid_token",
      "Bearer token JWT segments must be non-empty.",
    );
  }

  const header = parseJsonSegmentObject(headerSegment, "JWT header");
  const payload = parseJsonSegmentObject(payloadSegment, "JWT payload");
  const signature = decodeBase64UrlSegment(signatureSegment, "JWT signature");

  return {
    token,
    signingInput: `${headerSegment}.${payloadSegment}`,
    signature,
    header,
    payload,
  };
  // END_BLOCK_PARSE_JWT_COMPONENTS_M_OAUTH_TOKEN_VALIDATOR_009
}

// START_CONTRACT: resolveAlgorithmDescriptor
//   PURPOSE: Resolve signature verification parameters for supported JWT algorithms.
//   INPUTS: { alg: string - JWT header alg value }
//   OUTPUTS: { JwtAlgorithmDescriptor - Crypto import and verify descriptor }
//   SIDE_EFFECTS: [Throws TokenValidationRejection with invalid_token for unsupported algorithms]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: resolveAlgorithmDescriptor
function resolveAlgorithmDescriptor(alg: string): JwtAlgorithmDescriptor {
  // START_BLOCK_RESOLVE_SUPPORTED_JWT_ALGORITHM_DESCRIPTOR_M_OAUTH_TOKEN_VALIDATOR_010
  switch (alg) {
    case "RS256":
      return {
        expectedKty: "RSA",
        importAlgorithm: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        verifyAlgorithm: { name: "RSASSA-PKCS1-v1_5" },
      };
    case "RS384":
      return {
        expectedKty: "RSA",
        importAlgorithm: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" },
        verifyAlgorithm: { name: "RSASSA-PKCS1-v1_5" },
      };
    case "RS512":
      return {
        expectedKty: "RSA",
        importAlgorithm: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
        verifyAlgorithm: { name: "RSASSA-PKCS1-v1_5" },
      };
    case "PS256":
      return {
        expectedKty: "RSA",
        importAlgorithm: { name: "RSA-PSS", hash: "SHA-256" },
        verifyAlgorithm: { name: "RSA-PSS", saltLength: 32 },
      };
    case "PS384":
      return {
        expectedKty: "RSA",
        importAlgorithm: { name: "RSA-PSS", hash: "SHA-384" },
        verifyAlgorithm: { name: "RSA-PSS", saltLength: 48 },
      };
    case "PS512":
      return {
        expectedKty: "RSA",
        importAlgorithm: { name: "RSA-PSS", hash: "SHA-512" },
        verifyAlgorithm: { name: "RSA-PSS", saltLength: 64 },
      };
    case "ES256":
      return {
        expectedKty: "EC",
        importAlgorithm: { name: "ECDSA", namedCurve: "P-256" },
        verifyAlgorithm: { name: "ECDSA", hash: "SHA-256" },
      };
    case "ES384":
      return {
        expectedKty: "EC",
        importAlgorithm: { name: "ECDSA", namedCurve: "P-384" },
        verifyAlgorithm: { name: "ECDSA", hash: "SHA-384" },
      };
    case "ES512":
      return {
        expectedKty: "EC",
        importAlgorithm: { name: "ECDSA", namedCurve: "P-521" },
        verifyAlgorithm: { name: "ECDSA", hash: "SHA-512" },
      };
    default:
      throw new TokenValidationRejection(
        "invalid_token",
        "Token signature algorithm is unsupported.",
      );
  }
  // END_BLOCK_RESOLVE_SUPPORTED_JWT_ALGORITHM_DESCRIPTOR_M_OAUTH_TOKEN_VALIDATOR_010
}

// START_CONTRACT: readRequiredStringValue
//   PURPOSE: Read required non-empty string fields from decoded JWT objects.
//   INPUTS: { source: Record<string, unknown> - JSON source object, fieldName: string - Target field name, contextLabel: string - Diagnostic context label }
//   OUTPUTS: { string - Required string field value }
//   SIDE_EFFECTS: [Throws TokenValidationRejection with invalid_token for missing/invalid values]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: readRequiredStringValue
function readRequiredStringValue(
  source: Record<string, unknown>,
  fieldName: string,
  contextLabel: string,
): string {
  // START_BLOCK_READ_REQUIRED_STRING_FIELD_VALUE_M_OAUTH_TOKEN_VALIDATOR_011
  const normalized = normalizeOptionalString(source[fieldName]);
  if (!normalized) {
    throw new TokenValidationRejection(
      "invalid_token",
      `${contextLabel}.${fieldName} must be a non-empty string.`,
    );
  }
  return normalized;
  // END_BLOCK_READ_REQUIRED_STRING_FIELD_VALUE_M_OAUTH_TOKEN_VALIDATOR_011
}

// START_CONTRACT: readNumericDateClaim
//   PURPOSE: Read JWT NumericDate claims with optional presence semantics.
//   INPUTS: { payload: Record<string, unknown> - JWT payload object, claimName: string - NumericDate claim name, required: boolean - Whether claim must be present }
//   OUTPUTS: { number | undefined - Parsed NumericDate seconds value }
//   SIDE_EFFECTS: [Throws TokenValidationRejection with invalid_token for missing/invalid claim values]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: readNumericDateClaim
function readNumericDateClaim(
  payload: Record<string, unknown>,
  claimName: string,
  required: boolean,
): number | undefined {
  // START_BLOCK_READ_NUMERIC_DATE_CLAIMS_M_OAUTH_TOKEN_VALIDATOR_012
  const value = payload[claimName];
  if (value === undefined) {
    if (required) {
      throw new TokenValidationRejection("invalid_token", `Token claim ${claimName} is required.`);
    }
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TokenValidationRejection(
      "invalid_token",
      `Token claim ${claimName} must be a NumericDate number.`,
    );
  }

  return value;
  // END_BLOCK_READ_NUMERIC_DATE_CLAIMS_M_OAUTH_TOKEN_VALIDATOR_012
}

// START_CONTRACT: readAudienceClaim
//   PURPOSE: Read normalized audience claim values from JWT payload.
//   INPUTS: { payload: Record<string, unknown> - JWT payload object }
//   OUTPUTS: { string[] - Normalized audience values }
//   SIDE_EFFECTS: [Throws TokenValidationRejection with invalid_token for missing/invalid aud claim]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: readAudienceClaim
function readAudienceClaim(payload: Record<string, unknown>): string[] {
  // START_BLOCK_READ_AND_NORMALIZE_AUDIENCE_CLAIM_M_OAUTH_TOKEN_VALIDATOR_013
  const rawAudience = payload.aud;
  if (typeof rawAudience === "string") {
    const normalizedAudience = normalizeOptionalString(rawAudience);
    if (!normalizedAudience) {
      throw new TokenValidationRejection("invalid_token", "Token claim aud must not be empty.");
    }
    return [normalizedAudience];
  }

  if (Array.isArray(rawAudience)) {
    const normalizedAudience = rawAudience
      .map((value) => (typeof value === "string" ? normalizeOptionalString(value) : undefined))
      .filter((value): value is string => value !== undefined);
    if (normalizedAudience.length === 0) {
      throw new TokenValidationRejection(
        "invalid_token",
        "Token claim aud array must contain at least one non-empty string.",
      );
    }
    return normalizeRequiredScopeList(normalizedAudience);
  }

  throw new TokenValidationRejection(
    "invalid_token",
    "Token claim aud must be a string or array of strings.",
  );
  // END_BLOCK_READ_AND_NORMALIZE_AUDIENCE_CLAIM_M_OAUTH_TOKEN_VALIDATOR_013
}

// START_CONTRACT: readScopeClaim
//   PURPOSE: Read normalized granted scope values from scope/scp claims.
//   INPUTS: { payload: Record<string, unknown> - JWT payload object }
//   OUTPUTS: { string[] - Granted scope values }
//   SIDE_EFFECTS: [Throws TokenValidationRejection with invalid_token for missing/invalid scope claims]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR]
// END_CONTRACT: readScopeClaim
function readScopeClaim(payload: Record<string, unknown>): string[] {
  // START_BLOCK_READ_AND_NORMALIZE_SCOPE_CLAIMS_M_OAUTH_TOKEN_VALIDATOR_014
  const rawScope = payload.scope ?? payload.scp;
  if (typeof rawScope === "string") {
    const scopes = normalizeRequiredScopeList(rawScope.split(/\s+/g));
    if (scopes.length === 0) {
      throw new TokenValidationRejection("invalid_token", "Token scope claim must not be empty.");
    }
    return scopes;
  }

  if (Array.isArray(rawScope)) {
    const scopes = rawScope
      .map((value) => (typeof value === "string" ? normalizeOptionalString(value) : undefined))
      .filter((value): value is string => value !== undefined);
    const normalizedScopes = normalizeRequiredScopeList(scopes);
    if (normalizedScopes.length === 0) {
      throw new TokenValidationRejection("invalid_token", "Token scope claim array must not be empty.");
    }
    return normalizedScopes;
  }

  throw new TokenValidationRejection(
    "invalid_token",
    "Token scope claim is required and must be a string or string array.",
  );
  // END_BLOCK_READ_AND_NORMALIZE_SCOPE_CLAIMS_M_OAUTH_TOKEN_VALIDATOR_014
}

// START_CONTRACT: validateJwtSignature
//   PURPOSE: Resolve signing key by kid and verify JWT signature against header algorithm.
//   INPUTS: { parsedJwt: ParsedJwt - Parsed JWT data, getSigningKey: SigningKeyResolver - JWKS key resolver dependency }
//   OUTPUTS: { Promise<void> - Resolves when signature is valid }
//   SIDE_EFFECTS: [Calls JWKS resolver and WebCrypto verify operations]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR, M-OAUTH-JWKS]
// END_CONTRACT: validateJwtSignature
async function validateJwtSignature(parsedJwt: ParsedJwt, getSigningKey: SigningKeyResolver): Promise<void> {
  // START_BLOCK_RESOLVE_JWKS_KEY_AND_VERIFY_SIGNATURE_M_OAUTH_TOKEN_VALIDATOR_015
  const alg = readRequiredStringValue(parsedJwt.header, "alg", "JWT header");
  const kid = readRequiredStringValue(parsedJwt.header, "kid", "JWT header");
  const algorithmDescriptor = resolveAlgorithmDescriptor(alg);

  let signingKey: OAuthJwksKey;
  try {
    signingKey = await getSigningKey(kid);
  } catch (error: unknown) {
    if (error instanceof OAuthJwksError) {
      const jwksReason = error.details?.reason;
      if (jwksReason === "KEY_NOT_FOUND" || jwksReason === "INVALID_KID") {
        throw new TokenValidationRejection("invalid_token", "Token signing key was not found in JWKS.");
      }
      throw new OAuthTokenValidationError("Failed to resolve signing key from JWKS.", {
        reason: "JWKS_RESOLUTION_FAILED",
        cause: `${error.code}:${error.message}`,
        tokenKid: kid,
        tokenAlg: alg,
      });
    }

    throw new OAuthTokenValidationError("Failed to resolve signing key from JWKS.", {
      reason: "JWKS_RESOLUTION_FAILED",
      cause: error instanceof Error ? error.message : String(error),
      tokenKid: kid,
      tokenAlg: alg,
    });
  }

  if (signingKey.kty !== algorithmDescriptor.expectedKty) {
    throw new TokenValidationRejection("invalid_token", "Token signing key type does not match token algorithm.");
  }
  if (typeof signingKey.use === "string" && signingKey.use !== "sig") {
    throw new TokenValidationRejection("invalid_token", "Token signing key is not valid for signature use.");
  }
  if (typeof signingKey.alg === "string" && signingKey.alg !== alg) {
    throw new TokenValidationRejection(
      "invalid_token",
      "Token signing key algorithm does not match token header algorithm.",
    );
  }

  try {
    const subtle = globalThis.crypto.subtle as unknown as {
      importKey: (
        format: "jwk",
        keyData: Record<string, unknown>,
        algorithm: SubtleImportAlgorithm,
        extractable: boolean,
        keyUsages: string[],
      ) => Promise<CryptoKey>;
      verify: (
        algorithm: SubtleVerifyAlgorithm,
        key: CryptoKey,
        signature: ArrayBuffer,
        data: ArrayBuffer,
      ) => Promise<boolean>;
    };

    const verificationKey = await subtle.importKey(
      "jwk",
      signingKey as Record<string, unknown>,
      algorithmDescriptor.importAlgorithm,
      false,
      ["verify"],
    );
    const signatureBuffer = new ArrayBuffer(parsedJwt.signature.byteLength);
    new Uint8Array(signatureBuffer).set(parsedJwt.signature);
    const signingInputBytes = TEXT_ENCODER.encode(parsedJwt.signingInput);
    const signingInputBuffer = new ArrayBuffer(signingInputBytes.byteLength);
    new Uint8Array(signingInputBuffer).set(signingInputBytes);

    const isSignatureValid = await subtle.verify(
      algorithmDescriptor.verifyAlgorithm,
      verificationKey,
      signatureBuffer,
      signingInputBuffer,
    );

    if (!isSignatureValid) {
      throw new TokenValidationRejection("invalid_token", "Token signature verification failed.");
    }
  } catch (error: unknown) {
    if (error instanceof TokenValidationRejection) {
      throw error;
    }
    throw new TokenValidationRejection("invalid_token", "Token signature verification failed.");
  }
  // END_BLOCK_RESOLVE_JWKS_KEY_AND_VERIFY_SIGNATURE_M_OAUTH_TOKEN_VALIDATOR_015
}

// START_CONTRACT: validateClaimsAndScopes
//   PURPOSE: Validate required JWT claims, time windows, and required scope grants.
//   INPUTS: { payload: Record<string, unknown> - Decoded token payload, config: AppConfig - Runtime config, context: ValidateAccessTokenContext | undefined - Optional per-request validation context, nowEpochSec: number - Current time in seconds }
//   OUTPUTS: { subject: string | undefined; grantedScopes: string[] - Subject and scope data for successful validation }
//   SIDE_EFFECTS: [Throws TokenValidationRejection for invalid token or insufficient scope]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR, M-CONFIG]
// END_CONTRACT: validateClaimsAndScopes
function validateClaimsAndScopes(
  payload: Record<string, unknown>,
  config: AppConfig,
  context: ValidateAccessTokenContext | undefined,
  nowEpochSec: number,
): { subject: string | undefined; grantedScopes: string[] } {
  // START_BLOCK_VALIDATE_STANDARD_CLAIMS_AND_REQUIRED_SCOPES_M_OAUTH_TOKEN_VALIDATOR_016
  const tokenIssuer = readRequiredStringValue(payload, "iss", "JWT payload");
  const tokenAudience = readAudienceClaim(payload);
  const tokenExp = readNumericDateClaim(payload, "exp", true) as number;
  const tokenNbf = readNumericDateClaim(payload, "nbf", false);
  const tokenIat = readNumericDateClaim(payload, "iat", false);
  const grantedScopes = readScopeClaim(payload);

  const expectedIssuer = normalizeOptionalString(context?.issuer) ?? config.oauth.issuer;
  const expectedAudience = normalizeOptionalString(context?.audience) ?? config.oauth.audience;

  if (tokenIssuer !== expectedIssuer) {
    throw new TokenValidationRejection("invalid_token", "Token issuer claim does not match configured issuer.");
  }
  if (!tokenAudience.includes(expectedAudience)) {
    throw new TokenValidationRejection(
      "invalid_token",
      "Token audience claim does not include configured audience.",
    );
  }

  const clockSkewSec = config.oauth.clockSkewSec;
  if (nowEpochSec - clockSkewSec >= tokenExp) {
    throw new TokenValidationRejection("invalid_token", "Token has expired.");
  }
  if (tokenNbf !== undefined && nowEpochSec + clockSkewSec < tokenNbf) {
    throw new TokenValidationRejection("invalid_token", "Token is not valid yet (nbf).");
  }
  if (tokenIat !== undefined && tokenIat > nowEpochSec + clockSkewSec) {
    throw new TokenValidationRejection("invalid_token", "Token issued-at claim is in the future.");
  }

  const requiredScopes = normalizeRequiredScopeList([
    BASELINE_REQUIRED_SCOPE,
    ...config.oauth.requiredScopes,
    ...(context?.requiredScopes ?? []),
  ]);
  const grantedScopeSet = new Set<string>(grantedScopes);
  const missingScopes = requiredScopes.filter((scope) => !grantedScopeSet.has(scope));
  if (missingScopes.length > 0) {
    throw new TokenValidationRejection(
      "insufficient_scope",
      `Token is missing required scope(s): ${missingScopes.join(", ")}.`,
    );
  }

  const subject = normalizeOptionalString(payload.sub);
  return {
    subject,
    grantedScopes,
  };
  // END_BLOCK_VALIDATE_STANDARD_CLAIMS_AND_REQUIRED_SCOPES_M_OAUTH_TOKEN_VALIDATOR_016
}

// START_CONTRACT: createOAuthTokenValidator
//   PURPOSE: Create reusable OAuth token validator bound to config/logger/JWKS dependencies.
//   INPUTS: { dependencies: OAuthTokenValidatorDependencies - Runtime dependencies with optional JWKS resolver and clock overrides }
//   OUTPUTS: { OAuthTokenValidator - Validator facade exposing validateAccessToken }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR, M-OAUTH-JWKS, M-CONFIG, M-LOGGER]
// END_CONTRACT: createOAuthTokenValidator
export function createOAuthTokenValidator(
  dependencies: OAuthTokenValidatorDependencies,
): OAuthTokenValidator {
  // START_BLOCK_INITIALIZE_TOKEN_VALIDATOR_RUNTIME_STATE_M_OAUTH_TOKEN_VALIDATOR_017
  assertDependencies(dependencies);

  const config = dependencies.config;
  const baseLogger = dependencies.logger;
  const getSigningKey = dependencies.getSigningKey ?? defaultGetSigningKey;
  const now = dependencies.now ?? (() => Date.now());
  const logger = baseLogger.child({ module: "OAuthTokenValidator" });
  // END_BLOCK_INITIALIZE_TOKEN_VALIDATOR_RUNTIME_STATE_M_OAUTH_TOKEN_VALIDATOR_017

  // START_BLOCK_VALIDATE_ACCESS_TOKEN_AND_RETURN_DECISION_M_OAUTH_TOKEN_VALIDATOR_018
  return {
    validateAccessToken: async (
      authorizationHeader: string | null,
      context?: ValidateAccessTokenContext,
    ): Promise<OAuthTokenValidationResult> => {
      const functionName = "validateAccessToken";

      try {
        assertContextShape(context);
        const token = parseAuthorizationHeader(authorizationHeader);
        const parsedJwt = parseJwt(token);
        await validateJwtSignature(parsedJwt, getSigningKey);

        const nowEpochSec = Math.floor(now() / 1000);
        const validatedClaims = validateClaimsAndScopes(parsedJwt.payload, config, context, nowEpochSec);

        logger.info(
          "Validated OAuth access token successfully.",
          functionName,
          "VALIDATE_ACCESS_TOKEN_AND_RETURN_DECISION",
          {
            subject: validatedClaims.subject ?? null,
            grantedScopes: validatedClaims.grantedScopes,
            resource: context?.resource ?? null,
          },
        );
        return {
          isValid: true,
          subject: validatedClaims.subject,
          grantedScopes: validatedClaims.grantedScopes,
        };
      } catch (error: unknown) {
        if (error instanceof TokenValidationRejection) {
          logger.warn(
            "Rejected OAuth access token validation.",
            functionName,
            "VALIDATE_ACCESS_TOKEN_AND_RETURN_DECISION",
            {
              error: error.error,
              errorDescription: error.message,
              resource: context?.resource ?? null,
            },
          );
          return {
            isValid: false,
            error: error.error,
            errorDescription: error.message,
          };
        }

        const typedError =
          error instanceof OAuthTokenValidationError
            ? error
            : new OAuthTokenValidationError("Unexpected internal failure during token validation.", {
                reason: "CRYPTO_RUNTIME_FAILURE",
                cause: error instanceof Error ? error.message : String(error),
              });
        logger.error(
          "OAuth token validator failed with internal error.",
          functionName,
          "VALIDATE_ACCESS_TOKEN_AND_RETURN_DECISION",
          {
            code: typedError.code,
            details: typedError.details ?? null,
            jwksErrorCode:
              error instanceof OAuthJwksError || typedError.details?.cause?.includes(OAUTH_JWKS_ERROR)
                ? OAUTH_JWKS_ERROR
                : null,
          },
        );
        throw typedError;
      }
    },
  };
  // END_BLOCK_VALIDATE_ACCESS_TOKEN_AND_RETURN_DECISION_M_OAUTH_TOKEN_VALIDATOR_018
}

let defaultOAuthTokenValidator: OAuthTokenValidator | null = null;

// START_CONTRACT: resolveDefaultOAuthTokenValidator
//   PURPOSE: Lazily initialize singleton validator from runtime config/logger defaults.
//   INPUTS: {}
//   OUTPUTS: { OAuthTokenValidator - Singleton validator for application runtime usage }
//   SIDE_EFFECTS: [Loads runtime config and logger lazily on first use]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR, M-CONFIG, M-LOGGER, M-OAUTH-JWKS]
// END_CONTRACT: resolveDefaultOAuthTokenValidator
function resolveDefaultOAuthTokenValidator(): OAuthTokenValidator {
  // START_BLOCK_LAZILY_RESOLVE_DEFAULT_VALIDATOR_INSTANCE_M_OAUTH_TOKEN_VALIDATOR_019
  if (defaultOAuthTokenValidator) {
    return defaultOAuthTokenValidator;
  }

  const config = loadConfig();
  const logger = createLogger(config, "OAuthTokenValidator");
  defaultOAuthTokenValidator = createOAuthTokenValidator({ config, logger });
  return defaultOAuthTokenValidator;
  // END_BLOCK_LAZILY_RESOLVE_DEFAULT_VALIDATOR_INSTANCE_M_OAUTH_TOKEN_VALIDATOR_019
}

// START_CONTRACT: validateAccessToken
//   PURPOSE: Parse and validate strict Bearer access token using default validator dependencies.
//   INPUTS: { authorizationHeader: string | null - Authorization header value, context: ValidateAccessTokenContext | undefined - Optional per-call scope and claim expectations }
//   OUTPUTS: { Promise<OAuthTokenValidationResult> - Guard-ready validation decision result }
//   SIDE_EFFECTS: [May call JWKS resolver and perform cryptographic verification]
//   LINKS: [M-OAUTH-TOKEN-VALIDATOR, M-OAUTH-JWKS, M-CONFIG, M-LOGGER]
// END_CONTRACT: validateAccessToken
export async function validateAccessToken(
  authorizationHeader: string | null,
  context?: ValidateAccessTokenContext,
): Promise<OAuthTokenValidationResult> {
  // START_BLOCK_VALIDATE_ACCESS_TOKEN_VIA_DEFAULT_VALIDATOR_M_OAUTH_TOKEN_VALIDATOR_020
  return resolveDefaultOAuthTokenValidator().validateAccessToken(authorizationHeader, context);
  // END_BLOCK_VALIDATE_ACCESS_TOKEN_VIA_DEFAULT_VALIDATOR_M_OAUTH_TOKEN_VALIDATOR_020
}
