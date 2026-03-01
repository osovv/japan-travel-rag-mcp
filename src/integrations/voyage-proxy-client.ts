// FILE: src/integrations/voyage-proxy-client.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Call Voyage embedding API through a unified proxy for document and query embedding.
//   SCOPE: Build proxy embedding URLs, execute authenticated HTTP calls with timeout policy, normalize errors, parse embedding vectors, and log token usage for cost observability.
//   DEPENDS: M-CONFIG, M-LOGGER
//   LINKS: M-VOYAGE-PROXY-CLIENT, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   VoyageEmbeddingRequest - Input parameters for a Voyage embedding call.
//   VoyageEmbeddingItem - Single embedding result with vector and index.
//   VoyageEmbeddingResponse - Full Voyage API response with data array, model, and usage.
//   VoyageErrorCode - Supported Voyage client error codes.
//   VoyageProxyError - Typed error for HTTP/network failures during Voyage proxy calls.
//   VoyageTimeoutError - Typed error for timeout failures during Voyage proxy calls.
//   VoyageProxyClient - Runtime client interface exposing embedDocuments and embedQuery.
//   createVoyageProxyClient - Build client bound to AppConfig and Logger.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Add exponential backoff retry to callEmbeddingEndpoint for transient errors (5xx, 429, timeout, network).
// END_CHANGE_SUMMARY

import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";

// START_BLOCK_DEFINE_VOYAGE_EMBEDDING_TYPES_M_VOYAGE_PROXY_CLIENT_001
export type VoyageEmbeddingRequest = {
  input: string[];
  input_type: "document" | "query";
  model?: string;
};

export type VoyageEmbeddingItem = {
  object: "embedding";
  embedding: number[];
  index: number;
};

export type VoyageEmbeddingResponse = {
  object: "list";
  data: VoyageEmbeddingItem[];
  model: string;
  usage: { total_tokens: number };
};
// END_BLOCK_DEFINE_VOYAGE_EMBEDDING_TYPES_M_VOYAGE_PROXY_CLIENT_001

// START_BLOCK_DEFINE_VOYAGE_ERROR_TYPES_M_VOYAGE_PROXY_CLIENT_002
export type VoyageErrorCode = "VOYAGE_PROXY_ERROR" | "VOYAGE_TIMEOUT";

export class VoyageProxyError extends Error {
  public readonly code: "VOYAGE_PROXY_ERROR" = "VOYAGE_PROXY_ERROR";
  public readonly status?: number;
  public readonly details?: Record<string, unknown>;

  public constructor(
    message: string,
    status?: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "VoyageProxyError";
    this.status = status;
    this.details = details;
  }
}

export class VoyageTimeoutError extends Error {
  public readonly code: "VOYAGE_TIMEOUT" = "VOYAGE_TIMEOUT";
  public readonly details?: Record<string, unknown>;

  public constructor(
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "VoyageTimeoutError";
    this.details = details;
  }
}
// END_BLOCK_DEFINE_VOYAGE_ERROR_TYPES_M_VOYAGE_PROXY_CLIENT_002

export type VoyageProxyClient = {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = "voyage-4";
const VOYAGE_EMBEDDINGS_PATH = "api.voyageai.com/v1/embeddings";
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_JITTER_MAX_MS = 500;

type TimeoutControl = {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
};

// START_CONTRACT: createTimeoutControl
//   PURPOSE: Create a timeout-aware AbortSignal for Voyage proxy fetch calls.
//   INPUTS: { timeoutMs: number - Timeout in milliseconds }
//   OUTPUTS: { TimeoutControl - Signal and timeout bookkeeping helpers }
//   SIDE_EFFECTS: [Starts timeout timer when AbortSignal.timeout is unavailable]
//   LINKS: [M-VOYAGE-PROXY-CLIENT]
// END_CONTRACT: createTimeoutControl
function createTimeoutControl(timeoutMs: number): TimeoutControl {
  // START_BLOCK_CREATE_TIMEOUT_SIGNAL_M_VOYAGE_PROXY_CLIENT_003
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
  // END_BLOCK_CREATE_TIMEOUT_SIGNAL_M_VOYAGE_PROXY_CLIENT_003
}

// START_CONTRACT: buildEmbeddingUrl
//   PURPOSE: Build the Voyage proxy embedding URL from the proxy base URL.
//   INPUTS: { proxyBaseUrl: string - Base proxy URL from config }
//   OUTPUTS: { string - Absolute request URL for the Voyage embedding endpoint }
//   SIDE_EFFECTS: [Throws VoyageProxyError on invalid URL]
//   LINKS: [M-VOYAGE-PROXY-CLIENT, M-CONFIG]
// END_CONTRACT: buildEmbeddingUrl
function buildEmbeddingUrl(proxyBaseUrl: string): string {
  // START_BLOCK_BUILD_VOYAGE_EMBEDDING_URL_M_VOYAGE_PROXY_CLIENT_004
  const trimmed = proxyBaseUrl.trim();
  if (!trimmed) {
    throw new VoyageProxyError(
      "config.proxy.baseUrl must be a non-empty string.",
      undefined,
      { proxyBaseUrl },
    );
  }

  try {
    const base = trimmed.replace(/\/+$/, "");
    const url = new URL(`${base}/${VOYAGE_EMBEDDINGS_PATH}`);
    return url.toString();
  } catch (error: unknown) {
    throw new VoyageProxyError(
      "Failed to build Voyage proxy embedding URL.",
      undefined,
      {
        proxyBaseUrl: trimmed,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  // END_BLOCK_BUILD_VOYAGE_EMBEDDING_URL_M_VOYAGE_PROXY_CLIENT_004
}

// START_CONTRACT: readResponsePreview
//   PURPOSE: Read and cap response payload text for diagnostics.
//   INPUTS: { response: Response - Fetch response, maxLength: number | undefined - Optional max preview length }
//   OUTPUTS: { Promise<string> - Preview text for logs and error details }
//   SIDE_EFFECTS: [Consumes response body stream]
//   LINKS: [M-VOYAGE-PROXY-CLIENT]
// END_CONTRACT: readResponsePreview
async function readResponsePreview(response: Response, maxLength = 1000): Promise<string> {
  // START_BLOCK_READ_RESPONSE_PREVIEW_M_VOYAGE_PROXY_CLIENT_005
  try {
    const text = await response.text();
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}...`;
  } catch {
    return "";
  }
  // END_BLOCK_READ_RESPONSE_PREVIEW_M_VOYAGE_PROXY_CLIENT_005
}

// START_CONTRACT: parseVoyageEmbeddingResponse
//   PURPOSE: Parse successful Voyage proxy response as VoyageEmbeddingResponse.
//   INPUTS: { response: Response - HTTP response from Voyage proxy }
//   OUTPUTS: { Promise<VoyageEmbeddingResponse> - Parsed embedding response }
//   SIDE_EFFECTS: [Consumes response body stream]
//   LINKS: [M-VOYAGE-PROXY-CLIENT]
// END_CONTRACT: parseVoyageEmbeddingResponse
async function parseVoyageEmbeddingResponse(response: Response): Promise<VoyageEmbeddingResponse> {
  // START_BLOCK_PARSE_VOYAGE_EMBEDDING_RESPONSE_M_VOYAGE_PROXY_CLIENT_006
  const rawText = await response.text();
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new VoyageProxyError(
      "Voyage proxy response is not valid JSON.",
      response.status,
      { bodyPreview: rawText.slice(0, 1000) },
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new VoyageProxyError(
      "Voyage proxy response JSON must be an object.",
      response.status,
      { bodyPreview: rawText.slice(0, 1000) },
    );
  }

  const result = parsed as Record<string, unknown>;
  const data = Array.isArray(result.data) ? result.data : [];
  const model = typeof result.model === "string" ? result.model : "unknown";
  const usage =
    typeof result.usage === "object" && result.usage !== null
      ? (result.usage as Record<string, unknown>)
      : {};
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : 0;

  return {
    object: "list",
    data: data as VoyageEmbeddingItem[],
    model,
    usage: { total_tokens: totalTokens },
  };
  // END_BLOCK_PARSE_VOYAGE_EMBEDDING_RESPONSE_M_VOYAGE_PROXY_CLIENT_006
}

// START_CONTRACT: normalizeVoyageError
//   PURPOSE: Convert unknown runtime errors to typed VoyageProxyError or VoyageTimeoutError.
//   INPUTS: { error: unknown - Caught error, timedOut: boolean - Timeout flag, durationMs: number - Elapsed request time }
//   OUTPUTS: { VoyageProxyError | VoyageTimeoutError - Normalized typed error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-VOYAGE-PROXY-CLIENT]
// END_CONTRACT: normalizeVoyageError
function normalizeVoyageError(
  error: unknown,
  timedOut: boolean,
  durationMs: number,
): VoyageProxyError | VoyageTimeoutError {
  // START_BLOCK_NORMALIZE_VOYAGE_ERRORS_M_VOYAGE_PROXY_CLIENT_007
  if (error instanceof VoyageProxyError || error instanceof VoyageTimeoutError) {
    return error;
  }

  const errorName = error instanceof Error ? error.name : "";
  if (timedOut || errorName === "TimeoutError") {
    return new VoyageTimeoutError(
      "Voyage proxy request timed out.",
      {
        durationMs,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  return new VoyageProxyError(
    "Voyage proxy request failed before receiving a valid response.",
    undefined,
    {
      durationMs,
      cause: error instanceof Error ? error.message : String(error),
    },
  );
  // END_BLOCK_NORMALIZE_VOYAGE_ERRORS_M_VOYAGE_PROXY_CLIENT_007
}

// START_CONTRACT: isTransientVoyageError
//   PURPOSE: Determine if a Voyage error is transient and eligible for retry.
//   INPUTS: { error: VoyageProxyError | VoyageTimeoutError - Normalized error }
//   OUTPUTS: { boolean - True if the error is transient (5xx, 429, timeout, network) }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-VOYAGE-PROXY-CLIENT]
// END_CONTRACT: isTransientVoyageError
export function isTransientVoyageError(error: VoyageProxyError | VoyageTimeoutError): boolean {
  // START_BLOCK_IS_TRANSIENT_VOYAGE_ERROR_M_VOYAGE_PROXY_CLIENT_012
  if (error instanceof VoyageTimeoutError) {
    return true;
  }
  if (error instanceof VoyageProxyError) {
    // No status means network-level failure (no response received)
    if (error.status === undefined) {
      return true;
    }
    // 429 rate limit is transient
    if (error.status === 429) {
      return true;
    }
    // 5xx server errors are transient
    return error.status >= 500 && error.status < 600;
  }
  return false;
  // END_BLOCK_IS_TRANSIENT_VOYAGE_ERROR_M_VOYAGE_PROXY_CLIENT_012
}

// START_CONTRACT: computeVoyageRetryDelay
//   PURPOSE: Compute exponential backoff delay with jitter for Voyage retry attempts.
//   INPUTS: { attempt: number - Zero-based retry attempt index }
//   OUTPUTS: { number - Delay in milliseconds }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-VOYAGE-PROXY-CLIENT]
// END_CONTRACT: computeVoyageRetryDelay
export function computeVoyageRetryDelay(attempt: number): number {
  // START_BLOCK_COMPUTE_VOYAGE_RETRY_DELAY_M_VOYAGE_PROXY_CLIENT_013
  const exponentialDelay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * RETRY_JITTER_MAX_MS;
  return exponentialDelay + jitter;
  // END_BLOCK_COMPUTE_VOYAGE_RETRY_DELAY_M_VOYAGE_PROXY_CLIENT_013
}

// START_CONTRACT: callEmbeddingEndpoint
//   PURPOSE: Execute a Voyage proxy embedding call with auth, timeout, logging, normalized errors, and retry on transient failures.
//   INPUTS: { config: AppConfig - Runtime configuration, logger: Logger - Module logger, request: VoyageEmbeddingRequest - Embedding parameters, timeoutMs: number | undefined - Optional timeout override }
//   OUTPUTS: { Promise<VoyageEmbeddingResponse> - Parsed embedding response }
//   SIDE_EFFECTS: [Performs HTTP request and emits logs]
//   LINKS: [M-VOYAGE-PROXY-CLIENT, M-CONFIG, M-LOGGER]
// END_CONTRACT: callEmbeddingEndpoint
export async function callEmbeddingEndpoint(
  config: AppConfig,
  logger: Logger,
  request: VoyageEmbeddingRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<VoyageEmbeddingResponse> {
  // START_BLOCK_VALIDATE_EMBEDDING_INPUTS_M_VOYAGE_PROXY_CLIENT_008
  const functionName = "callEmbeddingEndpoint";

  if (!Array.isArray(request.input) || request.input.length === 0) {
    throw new VoyageProxyError(
      "request.input must be a non-empty array of strings.",
      undefined,
      { request },
    );
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new VoyageProxyError(
      "timeoutMs must be a positive integer.",
      undefined,
      { timeoutMs },
    );
  }
  // END_BLOCK_VALIDATE_EMBEDDING_INPUTS_M_VOYAGE_PROXY_CLIENT_008

  // START_BLOCK_BUILD_REQUEST_URL_AND_HEADERS_M_VOYAGE_PROXY_CLIENT_009
  const requestUrl = buildEmbeddingUrl(config.proxy.baseUrl);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.proxy.voyageApiKey}`,
    "X-Proxy-Key": config.proxy.secret,
    "Content-Type": "application/json",
  };

  const model = request.model ?? DEFAULT_MODEL;
  const body = {
    model,
    input: request.input,
    input_type: request.input_type,
  };
  // END_BLOCK_BUILD_REQUEST_URL_AND_HEADERS_M_VOYAGE_PROXY_CLIENT_009

  // START_BLOCK_EXECUTE_FETCH_WITH_RETRY_AND_LOGGING_M_VOYAGE_PROXY_CLIENT_010
  logger.info(
    "Starting Voyage proxy embedding request.",
    functionName,
    "EXECUTE_FETCH_WITH_RETRY_AND_LOGGING",
    { inputCount: request.input.length, inputType: request.input_type, model, timeoutMs },
  );

  let lastError: VoyageProxyError | VoyageTimeoutError | undefined;

  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delayMs = computeVoyageRetryDelay(attempt - 1);
      logger.warn(
        `Retrying Voyage embedding (attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS}) after ${Math.round(delayMs)}ms delay.`,
        functionName,
        "VOYAGE_RETRY",
        { attempt: attempt + 1, maxAttempts: RETRY_MAX_ATTEMPTS, delayMs: Math.round(delayMs) },
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const startedAt = Date.now();
    const timeoutControl = createTimeoutControl(timeoutMs);

    try {
      const response = await fetch(requestUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: timeoutControl.signal,
      });

      const durationMs = Date.now() - startedAt;
      logger.info(
        "Received Voyage proxy response status.",
        functionName,
        "EXECUTE_FETCH_WITH_RETRY_AND_LOGGING",
        { status: response.status, durationMs, attempt: attempt + 1 },
      );

      if (!response.ok) {
        const bodyPreview = await readResponsePreview(response);
        throw new VoyageProxyError(
          `Voyage proxy returned non-success status ${response.status}.`,
          response.status,
          {
            status: response.status,
            durationMs,
            bodyPreview,
          },
        );
      }

      const parsed = await parseVoyageEmbeddingResponse(response);

      logger.info(
        "Voyage embedding call succeeded.",
        functionName,
        "LOG_TOKEN_USAGE",
        {
          model: parsed.model,
          totalTokens: parsed.usage.total_tokens,
          embeddingCount: parsed.data.length,
          durationMs,
          attempt: attempt + 1,
        },
      );

      return parsed;
    } catch (error: unknown) {
      const durationMs = Date.now() - startedAt;
      const normalizedError = normalizeVoyageError(
        error,
        timeoutControl.didTimeout(),
        durationMs,
      );

      lastError = normalizedError;

      // Only retry on transient errors; throw immediately on non-transient
      if (!isTransientVoyageError(normalizedError) || attempt === RETRY_MAX_ATTEMPTS - 1) {
        const logMethod = normalizedError instanceof VoyageProxyError ? logger.warn : logger.error;
        logMethod(
          "Voyage proxy call failed.",
          functionName,
          "NORMALIZE_VOYAGE_FAILURE",
          {
            code: normalizedError.code,
            status: normalizedError instanceof VoyageProxyError ? normalizedError.status : undefined,
            durationMs,
            attempt: attempt + 1,
            retriesExhausted: attempt === RETRY_MAX_ATTEMPTS - 1,
          },
        );
        throw normalizedError;
      }

      // Transient error: log and continue to next attempt
      logger.warn(
        `Voyage proxy call failed with transient error (attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS}).`,
        functionName,
        "VOYAGE_TRANSIENT_ERROR",
        {
          code: normalizedError.code,
          status: normalizedError instanceof VoyageProxyError ? normalizedError.status : undefined,
          durationMs,
          attempt: attempt + 1,
        },
      );
    } finally {
      timeoutControl.cleanup();
    }
  }

  // Should not reach here, but satisfy TypeScript
  throw lastError ?? new VoyageProxyError("Voyage proxy call failed after all retries.");
  // END_BLOCK_EXECUTE_FETCH_WITH_RETRY_AND_LOGGING_M_VOYAGE_PROXY_CLIENT_010
}

// START_CONTRACT: createVoyageProxyClient
//   PURPOSE: Create a reusable Voyage embedding client bound to config and logger.
//   INPUTS: { config: AppConfig - Runtime configuration, logger: Logger - Module logger }
//   OUTPUTS: { VoyageProxyClient - Client facade exposing embedDocuments and embedQuery }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-VOYAGE-PROXY-CLIENT, M-CONFIG, M-LOGGER]
// END_CONTRACT: createVoyageProxyClient
export function createVoyageProxyClient(config: AppConfig, logger: Logger): VoyageProxyClient {
  // START_BLOCK_CREATE_BOUND_VOYAGE_PROXY_CLIENT_M_VOYAGE_PROXY_CLIENT_011
  return {
    embedDocuments: async (texts: string[]): Promise<number[][]> => {
      const response = await callEmbeddingEndpoint(config, logger, {
        input: texts,
        input_type: "document",
      });
      return response.data.map((item) => item.embedding);
    },
    embedQuery: async (text: string): Promise<number[]> => {
      const response = await callEmbeddingEndpoint(config, logger, {
        input: [text],
        input_type: "query",
      });
      if (!response.data[0]) {
        throw new VoyageProxyError(
          "Voyage proxy returned empty data array for query embedding.",
          undefined,
          { text },
        );
      }
      return response.data[0].embedding;
    },
  };
  // END_BLOCK_CREATE_BOUND_VOYAGE_PROXY_CLIENT_M_VOYAGE_PROXY_CLIENT_011
}
