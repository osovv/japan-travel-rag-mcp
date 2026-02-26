// FILE: src/auth/oauth-jwks-client.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Fetch, cache, and rotate JWKS signing keys from the configured OAuth issuer.
//   SCOPE: Validate kid input, fetch issuer JWKS with bounded timeout, validate payload shape, maintain TTL cache, and expose cache-aware key lookup and refresh methods.
//   DEPENDS: M-CONFIG, M-LOGGER
//   LINKS: M-OAUTH-JWKS, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   OAUTH_JWKS_ERROR - Typed error code for JWKS fetch/cache/lookup failures.
//   OAuthJwksError - Typed JWKS error with stable code and structured details.
//   createOAuthJwksClient - Build reusable JWKS client with injected config/logger/fetch/clock dependencies.
//   getSigningKey - Resolve signing key material by kid using cache-aware refresh behavior.
//   refreshJwks - Force a JWKS refresh from issuer endpoint.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation from development plan for M-OAUTH-JWKS with timeout-bound fetch, strict validation, and TTL cache.
// END_CHANGE_SUMMARY

import { loadConfig } from "../config/index";
import type { AppConfig } from "../config/index";
import { createLogger } from "../logger/index";
import type { Logger } from "../logger/index";

export const OAUTH_JWKS_ERROR = "OAUTH_JWKS_ERROR" as const;

type OAuthJwksErrorReason =
  | "INVALID_KID"
  | "INVALID_DEPENDENCIES"
  | "FETCH_FAILED"
  | "HTTP_ERROR"
  | "INVALID_PAYLOAD"
  | "KEY_NOT_FOUND";

type OAuthJwksErrorDetails = {
  reason: OAuthJwksErrorReason;
  kid?: string;
  jwksUrl?: string;
  status?: number;
  timeoutMs?: number;
  durationMs?: number;
  field?: string;
  cause?: string;
  bodyPreview?: string;
};

export class OAuthJwksError extends Error {
  public readonly code = OAUTH_JWKS_ERROR;
  public readonly details?: OAuthJwksErrorDetails;

  public constructor(message: string, details?: OAuthJwksErrorDetails) {
    super(message);
    this.name = "OAuthJwksError";
    this.details = details;
  }
}

export type OAuthJwksKey = {
  kid: string;
  kty: string;
  use?: string;
  alg?: string;
  [claim: string]: unknown;
};

type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;

type TimeoutControl = {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
};

type JwksCacheState = {
  keysByKid: Map<string, OAuthJwksKey>;
  expiresAtEpochMs: number;
  lastRefreshEpochMs: number;
};

export type OAuthJwksClientDependencies = {
  config: AppConfig;
  logger: Logger;
  fetchImplementation?: FetchImplementation;
  now?: () => number;
};

export type OAuthJwksClient = {
  getSigningKey(kid: string): Promise<OAuthJwksKey>;
  refreshJwks(): Promise<void>;
};

const DEFAULT_CACHE_STATE: JwksCacheState = {
  keysByKid: new Map<string, OAuthJwksKey>(),
  expiresAtEpochMs: 0,
  lastRefreshEpochMs: 0,
};

// START_CONTRACT: isPlainObject
//   PURPOSE: Validate that an unknown value is a plain JSON object.
//   INPUTS: { value: unknown - Runtime candidate value }
//   OUTPUTS: { boolean - True when the value is a non-null, non-array plain object }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-OAUTH-JWKS]
// END_CONTRACT: isPlainObject
function isPlainObject(value: unknown): value is Record<string, unknown> {
  // START_BLOCK_VALIDATE_PLAIN_OBJECT_INPUT_M_OAUTH_JWKS_001
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
  // END_BLOCK_VALIDATE_PLAIN_OBJECT_INPUT_M_OAUTH_JWKS_001
}

// START_CONTRACT: normalizeNonEmptyString
//   PURPOSE: Normalize and validate required string values.
//   INPUTS: { value: unknown - Candidate value, field: string - Field name for diagnostics }
//   OUTPUTS: { string - Trimmed non-empty string }
//   SIDE_EFFECTS: [Throws OAuthJwksError with INVALID_PAYLOAD reason for invalid values]
//   LINKS: [M-OAUTH-JWKS]
// END_CONTRACT: normalizeNonEmptyString
function normalizeNonEmptyString(value: unknown, field: string): string {
  // START_BLOCK_NORMALIZE_REQUIRED_STRING_FIELDS_M_OAUTH_JWKS_002
  if (typeof value !== "string") {
    throw new OAuthJwksError(`${field} must be a non-empty string.`, {
      reason: "INVALID_PAYLOAD",
      field,
    });
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new OAuthJwksError(`${field} must be a non-empty string.`, {
      reason: "INVALID_PAYLOAD",
      field,
    });
  }

  return normalized;
  // END_BLOCK_NORMALIZE_REQUIRED_STRING_FIELDS_M_OAUTH_JWKS_002
}

// START_CONTRACT: normalizeKid
//   PURPOSE: Validate and normalize key-id values provided by callers.
//   INPUTS: { kid: string - Raw key identifier from JWT header or caller input }
//   OUTPUTS: { string - Trimmed key identifier with no whitespace }
//   SIDE_EFFECTS: [Throws OAuthJwksError with INVALID_KID reason for invalid kid]
//   LINKS: [M-OAUTH-JWKS]
// END_CONTRACT: normalizeKid
function normalizeKid(kid: string): string {
  // START_BLOCK_VALIDATE_AND_NORMALIZE_KID_M_OAUTH_JWKS_003
  if (typeof kid !== "string") {
    throw new OAuthJwksError("kid must be a non-empty string.", {
      reason: "INVALID_KID",
      field: "kid",
    });
  }

  const normalizedKid = kid.trim();
  if (!normalizedKid || /\s/.test(normalizedKid)) {
    throw new OAuthJwksError("kid must be a non-empty string without whitespace.", {
      reason: "INVALID_KID",
      field: "kid",
    });
  }

  return normalizedKid;
  // END_BLOCK_VALIDATE_AND_NORMALIZE_KID_M_OAUTH_JWKS_003
}

// START_CONTRACT: buildJwksUrl
//   PURPOSE: Build issuer JWKS endpoint URL using <issuer>/.well-known/jwks.json convention.
//   INPUTS: { issuer: string - OAuth issuer URL from config }
//   OUTPUTS: { string - Absolute JWKS endpoint URL }
//   SIDE_EFFECTS: [Throws OAuthJwksError with INVALID_DEPENDENCIES reason when issuer is invalid]
//   LINKS: [M-OAUTH-JWKS, M-CONFIG]
// END_CONTRACT: buildJwksUrl
function buildJwksUrl(issuer: string): string {
  // START_BLOCK_BUILD_ISSUER_JWKS_URL_M_OAUTH_JWKS_004
  const normalizedIssuer = issuer.trim().replace(/\/+$/, "");
  const candidateUrl = `${normalizedIssuer}/.well-known/jwks.json`;
  try {
    return new URL(candidateUrl).toString();
  } catch {
    throw new OAuthJwksError("config.oauth.issuer must resolve to a valid JWKS endpoint URL.", {
      reason: "INVALID_DEPENDENCIES",
      field: "config.oauth.issuer",
      jwksUrl: candidateUrl,
    });
  }
  // END_BLOCK_BUILD_ISSUER_JWKS_URL_M_OAUTH_JWKS_004
}

// START_CONTRACT: createTimeoutControl
//   PURPOSE: Build timeout-aware AbortSignal for JWKS fetches.
//   INPUTS: { timeoutMs: number - Timeout in milliseconds }
//   OUTPUTS: { TimeoutControl - Abort signal and timeout state helpers }
//   SIDE_EFFECTS: [Starts timeout timer when AbortSignal.timeout is unavailable]
//   LINKS: [M-OAUTH-JWKS, M-CONFIG]
// END_CONTRACT: createTimeoutControl
function createTimeoutControl(timeoutMs: number): TimeoutControl {
  // START_BLOCK_CREATE_TIMEOUT_CONTROL_FOR_JWKS_FETCH_M_OAUTH_JWKS_005
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    let timedOut = false;
    const signal = AbortSignal.timeout(timeoutMs);
    signal.addEventListener(
      "abort",
      () => {
        timedOut = true;
      },
      { once: true },
    );
    return {
      signal,
      cleanup: () => {},
      didTimeout: () => timedOut,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
    },
    didTimeout: () => timedOut,
  };
  // END_BLOCK_CREATE_TIMEOUT_CONTROL_FOR_JWKS_FETCH_M_OAUTH_JWKS_005
}

// START_CONTRACT: readResponsePreview
//   PURPOSE: Read and cap response body text for diagnostics when JWKS fetch fails.
//   INPUTS: { response: Response - HTTP response object, maxLength: number | undefined - Optional preview cap }
//   OUTPUTS: { Promise<string> - Capped textual body preview }
//   SIDE_EFFECTS: [Consumes response body stream]
//   LINKS: [M-OAUTH-JWKS]
// END_CONTRACT: readResponsePreview
async function readResponsePreview(response: Response, maxLength = 1000): Promise<string> {
  // START_BLOCK_READ_JWKS_RESPONSE_PREVIEW_M_OAUTH_JWKS_006
  try {
    const text = await response.text();
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}...`;
  } catch {
    return "";
  }
  // END_BLOCK_READ_JWKS_RESPONSE_PREVIEW_M_OAUTH_JWKS_006
}

// START_CONTRACT: parseJwksPayload
//   PURPOSE: Parse and strictly validate JWKS JSON payload into kid-indexed key map.
//   INPUTS: { payload: unknown - Parsed JSON payload from JWKS endpoint }
//   OUTPUTS: { Map<string, OAuthJwksKey> - Validated keys indexed by kid }
//   SIDE_EFFECTS: [Throws OAuthJwksError with INVALID_PAYLOAD reason for malformed payloads]
//   LINKS: [M-OAUTH-JWKS]
// END_CONTRACT: parseJwksPayload
function parseJwksPayload(payload: unknown): Map<string, OAuthJwksKey> {
  // START_BLOCK_PARSE_AND_VALIDATE_JWKS_PAYLOAD_M_OAUTH_JWKS_007
  if (!isPlainObject(payload)) {
    throw new OAuthJwksError("JWKS payload must be a JSON object.", {
      reason: "INVALID_PAYLOAD",
      field: "payload",
    });
  }

  const rawKeys = payload.keys;
  if (!Array.isArray(rawKeys)) {
    throw new OAuthJwksError("JWKS payload must contain a keys array.", {
      reason: "INVALID_PAYLOAD",
      field: "keys",
    });
  }

  const keysByKid = new Map<string, OAuthJwksKey>();
  for (let index = 0; index < rawKeys.length; index += 1) {
    const rawKey = rawKeys[index];
    const fieldPrefix = `keys[${index}]`;
    if (!isPlainObject(rawKey)) {
      throw new OAuthJwksError(`${fieldPrefix} must be a JSON object.`, {
        reason: "INVALID_PAYLOAD",
        field: fieldPrefix,
      });
    }

    const kid = normalizeNonEmptyString(rawKey.kid, `${fieldPrefix}.kid`);
    const kty = normalizeNonEmptyString(rawKey.kty, `${fieldPrefix}.kty`);

    if (rawKey.use !== undefined && typeof rawKey.use !== "string") {
      throw new OAuthJwksError(`${fieldPrefix}.use must be a string when provided.`, {
        reason: "INVALID_PAYLOAD",
        field: `${fieldPrefix}.use`,
      });
    }
    if (rawKey.alg !== undefined && typeof rawKey.alg !== "string") {
      throw new OAuthJwksError(`${fieldPrefix}.alg must be a string when provided.`, {
        reason: "INVALID_PAYLOAD",
        field: `${fieldPrefix}.alg`,
      });
    }
    if (rawKey.key_ops !== undefined) {
      if (!Array.isArray(rawKey.key_ops) || rawKey.key_ops.some((value) => typeof value !== "string")) {
        throw new OAuthJwksError(`${fieldPrefix}.key_ops must be an array of strings when provided.`, {
          reason: "INVALID_PAYLOAD",
          field: `${fieldPrefix}.key_ops`,
        });
      }
    }

    const normalizedKey: OAuthJwksKey = {
      ...rawKey,
      kid,
      kty,
      ...(rawKey.use !== undefined ? { use: rawKey.use } : {}),
      ...(rawKey.alg !== undefined ? { alg: rawKey.alg } : {}),
    };
    keysByKid.set(kid, normalizedKey);
  }

  if (keysByKid.size === 0) {
    throw new OAuthJwksError("JWKS payload must include at least one key.", {
      reason: "INVALID_PAYLOAD",
      field: "keys",
    });
  }

  return keysByKid;
  // END_BLOCK_PARSE_AND_VALIDATE_JWKS_PAYLOAD_M_OAUTH_JWKS_007
}

// START_CONTRACT: normalizeUnknownJwksError
//   PURPOSE: Convert unknown runtime failures into typed OAuthJwksError values.
//   INPUTS: { error: unknown - Caught runtime error, timeoutControl: TimeoutControl - Timeout state, timeoutMs: number - Configured timeout, startedAtEpochMs: number - Fetch start time, now: () => number - Clock function, jwksUrl: string - Target endpoint URL }
//   OUTPUTS: { OAuthJwksError - Typed JWKS error with stable code/details }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-OAUTH-JWKS]
// END_CONTRACT: normalizeUnknownJwksError
function normalizeUnknownJwksError(
  error: unknown,
  timeoutControl: TimeoutControl,
  timeoutMs: number,
  startedAtEpochMs: number,
  now: () => number,
  jwksUrl: string,
): OAuthJwksError {
  // START_BLOCK_NORMALIZE_UNKNOWN_JWKS_RUNTIME_ERRORS_M_OAUTH_JWKS_008
  if (error instanceof OAuthJwksError) {
    return error;
  }

  const durationMs = Math.max(0, now() - startedAtEpochMs);
  const cause = error instanceof Error ? error.message : String(error);
  if (timeoutControl.didTimeout()) {
    return new OAuthJwksError("JWKS request timed out.", {
      reason: "FETCH_FAILED",
      timeoutMs,
      durationMs,
      jwksUrl,
      cause,
    });
  }

  return new OAuthJwksError("Failed to fetch JWKS payload from issuer.", {
    reason: "FETCH_FAILED",
    timeoutMs,
    durationMs,
    jwksUrl,
    cause,
  });
  // END_BLOCK_NORMALIZE_UNKNOWN_JWKS_RUNTIME_ERRORS_M_OAUTH_JWKS_008
}

// START_CONTRACT: assertDependencies
//   PURPOSE: Validate JWKS client dependency contract before runtime operations.
//   INPUTS: { dependencies: OAuthJwksClientDependencies - Runtime dependencies }
//   OUTPUTS: { void - Throws on invalid dependency wiring }
//   SIDE_EFFECTS: [Throws OAuthJwksError with INVALID_DEPENDENCIES reason]
//   LINKS: [M-OAUTH-JWKS, M-CONFIG, M-LOGGER]
// END_CONTRACT: assertDependencies
function assertDependencies(dependencies: OAuthJwksClientDependencies): void {
  // START_BLOCK_VALIDATE_OAUTH_JWKS_CLIENT_DEPENDENCIES_M_OAUTH_JWKS_009
  if (!dependencies || typeof dependencies !== "object") {
    throw new OAuthJwksError("OAuth JWKS client dependencies are required.", {
      reason: "INVALID_DEPENDENCIES",
      field: "dependencies",
    });
  }

  if (!dependencies.config || typeof dependencies.config !== "object") {
    throw new OAuthJwksError("OAuth JWKS client requires config dependency.", {
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
    throw new OAuthJwksError("OAuth JWKS client requires logger dependency.", {
      reason: "INVALID_DEPENDENCIES",
      field: "logger",
    });
  }

  const { oauth } = dependencies.config;
  if (!oauth || typeof oauth !== "object") {
    throw new OAuthJwksError("OAuth JWKS client requires config.oauth settings.", {
      reason: "INVALID_DEPENDENCIES",
      field: "config.oauth",
    });
  }

  if (
    !Number.isInteger(oauth.jwksCacheTtlMs) ||
    oauth.jwksCacheTtlMs < 1000 ||
    oauth.jwksCacheTtlMs > 86400000
  ) {
    throw new OAuthJwksError("config.oauth.jwksCacheTtlMs must be a valid TTL in milliseconds.", {
      reason: "INVALID_DEPENDENCIES",
      field: "config.oauth.jwksCacheTtlMs",
    });
  }

  if (
    !Number.isInteger(oauth.jwksTimeoutMs) ||
    oauth.jwksTimeoutMs < 1000 ||
    oauth.jwksTimeoutMs > 120000
  ) {
    throw new OAuthJwksError("config.oauth.jwksTimeoutMs must be a valid timeout in milliseconds.", {
      reason: "INVALID_DEPENDENCIES",
      field: "config.oauth.jwksTimeoutMs",
    });
  }
  // END_BLOCK_VALIDATE_OAUTH_JWKS_CLIENT_DEPENDENCIES_M_OAUTH_JWKS_009
}

// START_CONTRACT: createOAuthJwksClient
//   PURPOSE: Create a reusable JWKS client with TTL cache and bounded-timeout refresh behavior.
//   INPUTS: { dependencies: OAuthJwksClientDependencies - Runtime config, logger, and optional fetch/clock overrides }
//   OUTPUTS: { OAuthJwksClient - getSigningKey and refreshJwks API bound to provided dependencies }
//   SIDE_EFFECTS: [Performs HTTP requests to issuer JWKS endpoint and emits structured logs]
//   LINKS: [M-OAUTH-JWKS, M-CONFIG, M-LOGGER]
// END_CONTRACT: createOAuthJwksClient
export function createOAuthJwksClient(dependencies: OAuthJwksClientDependencies): OAuthJwksClient {
  // START_BLOCK_INITIALIZE_OAUTH_JWKS_RUNTIME_STATE_M_OAUTH_JWKS_010
  assertDependencies(dependencies);

  const config = dependencies.config;
  const baseLogger = dependencies.logger;
  const fetchImplementation: FetchImplementation =
    dependencies.fetchImplementation ??
    (async (input: string | URL, init?: RequestInit) => fetch(input, init));
  const now = dependencies.now ?? (() => Date.now());

  const issuer = normalizeNonEmptyString(config.oauth.issuer, "config.oauth.issuer");
  const jwksUrl = buildJwksUrl(issuer);
  const cacheTtlMs = config.oauth.jwksCacheTtlMs;
  const timeoutMs = config.oauth.jwksTimeoutMs;
  const logger = baseLogger.child({ module: "OAuthJwksClient", jwksUrl });

  let cacheState: JwksCacheState = {
    keysByKid: new Map(DEFAULT_CACHE_STATE.keysByKid),
    expiresAtEpochMs: DEFAULT_CACHE_STATE.expiresAtEpochMs,
    lastRefreshEpochMs: DEFAULT_CACHE_STATE.lastRefreshEpochMs,
  };
  let inFlightRefreshPromise: Promise<void> | null = null;
  // END_BLOCK_INITIALIZE_OAUTH_JWKS_RUNTIME_STATE_M_OAUTH_JWKS_010

  // START_BLOCK_DEFINE_REFRESH_AND_LOOKUP_OPERATIONS_M_OAUTH_JWKS_011
  const runRefresh = async (trigger: "manual" | "stale_cache" | "kid_miss"): Promise<void> => {
    const functionName = trigger === "manual" ? "refreshJwks" : "getSigningKey";
    if (inFlightRefreshPromise) {
      logger.debug(
        "Awaiting in-flight JWKS refresh.",
        functionName,
        "DEFINE_REFRESH_AND_LOOKUP_OPERATIONS",
        { trigger },
      );
      return inFlightRefreshPromise;
    }

    inFlightRefreshPromise = (async () => {
      const startedAtEpochMs = now();
      const timeoutControl = createTimeoutControl(timeoutMs);
      logger.info(
        "Starting JWKS refresh from issuer endpoint.",
        functionName,
        "DEFINE_REFRESH_AND_LOOKUP_OPERATIONS",
        {
          trigger,
          timeoutMs,
        },
      );

      try {
        const response = await fetchImplementation(jwksUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: timeoutControl.signal,
        });

        if (!response.ok) {
          const bodyPreview = await readResponsePreview(response);
          throw new OAuthJwksError(`Issuer JWKS endpoint returned status ${response.status}.`, {
            reason: "HTTP_ERROR",
            status: response.status,
            jwksUrl,
            bodyPreview,
          });
        }

        const rawBodyText = await response.text();
        let parsedPayload: unknown;
        try {
          parsedPayload = JSON.parse(rawBodyText);
        } catch {
          throw new OAuthJwksError("Issuer JWKS response must be valid JSON.", {
            reason: "INVALID_PAYLOAD",
            jwksUrl,
            bodyPreview: rawBodyText.slice(0, 1000),
          });
        }

        const keysByKid = parseJwksPayload(parsedPayload);
        const refreshedAtEpochMs = now();
        cacheState = {
          keysByKid,
          lastRefreshEpochMs: refreshedAtEpochMs,
          expiresAtEpochMs: refreshedAtEpochMs + cacheTtlMs,
        };

        logger.info(
          "JWKS refresh completed successfully.",
          functionName,
          "DEFINE_REFRESH_AND_LOOKUP_OPERATIONS",
          {
            trigger,
            keyCount: cacheState.keysByKid.size,
            cacheTtlMs,
            expiresAtEpochMs: cacheState.expiresAtEpochMs,
          },
        );
      } catch (error: unknown) {
        const normalizedError = normalizeUnknownJwksError(
          error,
          timeoutControl,
          timeoutMs,
          startedAtEpochMs,
          now,
          jwksUrl,
        );
        logger.error(
          "JWKS refresh failed.",
          functionName,
          "DEFINE_REFRESH_AND_LOOKUP_OPERATIONS",
          {
            code: normalizedError.code,
            details: normalizedError.details ?? null,
          },
        );
        throw normalizedError;
      } finally {
        timeoutControl.cleanup();
      }
    })();

    try {
      await inFlightRefreshPromise;
    } finally {
      inFlightRefreshPromise = null;
    }
  };

  const resolveSigningKey = async (kid: string): Promise<OAuthJwksKey> => {
    const functionName = "getSigningKey";
    const normalizedKid = normalizeKid(kid);
    const nowEpochMs = now();
    const isCacheFresh = cacheState.expiresAtEpochMs > nowEpochMs;
    const cachedKey = cacheState.keysByKid.get(normalizedKid);

    if (isCacheFresh && cachedKey) {
      logger.debug(
        "Resolved signing key from fresh cache.",
        functionName,
        "DEFINE_REFRESH_AND_LOOKUP_OPERATIONS",
        {
          kid: normalizedKid,
          expiresAtEpochMs: cacheState.expiresAtEpochMs,
        },
      );
      return cachedKey;
    }

    const refreshTrigger = isCacheFresh ? "kid_miss" : "stale_cache";
    logger.info(
      "Refreshing JWKS before signing key lookup.",
      functionName,
      "DEFINE_REFRESH_AND_LOOKUP_OPERATIONS",
      {
        kid: normalizedKid,
        refreshTrigger,
        cacheIsFresh: isCacheFresh,
      },
    );
    await runRefresh(refreshTrigger);

    const refreshedKey = cacheState.keysByKid.get(normalizedKid);
    if (refreshedKey) {
      logger.debug(
        "Resolved signing key after JWKS refresh.",
        functionName,
        "DEFINE_REFRESH_AND_LOOKUP_OPERATIONS",
        {
          kid: normalizedKid,
          cacheExpiresAtEpochMs: cacheState.expiresAtEpochMs,
        },
      );
      return refreshedKey;
    }

    logger.warn(
      "Requested signing key is missing after JWKS refresh.",
      functionName,
      "DEFINE_REFRESH_AND_LOOKUP_OPERATIONS",
      {
        kid: normalizedKid,
        keyCount: cacheState.keysByKid.size,
      },
    );
    throw new OAuthJwksError("Requested signing key is not present in issuer JWKS.", {
      reason: "KEY_NOT_FOUND",
      kid: normalizedKid,
      jwksUrl,
    });
  };
  // END_BLOCK_DEFINE_REFRESH_AND_LOOKUP_OPERATIONS_M_OAUTH_JWKS_011

  // START_BLOCK_RETURN_BOUND_OAUTH_JWKS_CLIENT_API_M_OAUTH_JWKS_012
  return {
    getSigningKey: async (kid: string) => {
      return resolveSigningKey(kid);
    },
    refreshJwks: async () => {
      await runRefresh("manual");
    },
  };
  // END_BLOCK_RETURN_BOUND_OAUTH_JWKS_CLIENT_API_M_OAUTH_JWKS_012
}

let defaultOAuthJwksClient: OAuthJwksClient | null = null;

// START_CONTRACT: resolveDefaultOAuthJwksClient
//   PURPOSE: Lazily initialize default JWKS client instance from runtime config and logger.
//   INPUTS: {}
//   OUTPUTS: { OAuthJwksClient - Singleton JWKS client for standard app usage }
//   SIDE_EFFECTS: [Reads runtime env via loadConfig and initializes logger/client singletons]
//   LINKS: [M-OAUTH-JWKS, M-CONFIG, M-LOGGER]
// END_CONTRACT: resolveDefaultOAuthJwksClient
function resolveDefaultOAuthJwksClient(): OAuthJwksClient {
  // START_BLOCK_LAZILY_INITIALIZE_DEFAULT_JWKS_CLIENT_M_OAUTH_JWKS_013
  if (defaultOAuthJwksClient) {
    return defaultOAuthJwksClient;
  }

  const config = loadConfig();
  const logger = createLogger(config, "OAuthJwksClient");
  defaultOAuthJwksClient = createOAuthJwksClient({ config, logger });
  return defaultOAuthJwksClient;
  // END_BLOCK_LAZILY_INITIALIZE_DEFAULT_JWKS_CLIENT_M_OAUTH_JWKS_013
}

// START_CONTRACT: getSigningKey
//   PURPOSE: Resolve signing key by kid using cache-aware refresh behavior from default JWKS client.
//   INPUTS: { kid: string - Key identifier from token header }
//   OUTPUTS: { Promise<OAuthJwksKey> - Signing key material for token signature verification }
//   SIDE_EFFECTS: [May refresh in-memory JWKS cache and perform issuer fetch]
//   LINKS: [M-OAUTH-JWKS, M-CONFIG, M-LOGGER]
// END_CONTRACT: getSigningKey
export async function getSigningKey(kid: string): Promise<OAuthJwksKey> {
  // START_BLOCK_RESOLVE_SIGNING_KEY_VIA_DEFAULT_CLIENT_M_OAUTH_JWKS_014
  return resolveDefaultOAuthJwksClient().getSigningKey(kid);
  // END_BLOCK_RESOLVE_SIGNING_KEY_VIA_DEFAULT_CLIENT_M_OAUTH_JWKS_014
}

// START_CONTRACT: refreshJwks
//   PURPOSE: Force JWKS refresh from issuer endpoint using default JWKS client.
//   INPUTS: {}
//   OUTPUTS: { Promise<void> - Resolves once cache is refreshed }
//   SIDE_EFFECTS: [Performs issuer JWKS fetch and updates cache state]
//   LINKS: [M-OAUTH-JWKS, M-CONFIG, M-LOGGER]
// END_CONTRACT: refreshJwks
export async function refreshJwks(): Promise<void> {
  // START_BLOCK_FORCE_JWKS_REFRESH_VIA_DEFAULT_CLIENT_M_OAUTH_JWKS_015
  await resolveDefaultOAuthJwksClient().refreshJwks();
  // END_BLOCK_FORCE_JWKS_REFRESH_VIA_DEFAULT_CLIENT_M_OAUTH_JWKS_015
}
