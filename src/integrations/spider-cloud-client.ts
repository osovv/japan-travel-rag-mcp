// FILE: src/integrations/spider-cloud-client.ts
// VERSION: 1.2.0
// START_MODULE_CONTRACT
//   PURPOSE: Call Spider crawl API through a unified proxy for scheduled and targeted crawl jobs.
//   SCOPE: Build proxy crawl URLs, execute authenticated HTTP calls with timeout policy, normalize errors, and return parsed crawl response objects.
//   DEPENDS: M-CONFIG, M-LOGGER
//   LINKS: M-SPIDER-CLOUD-CLIENT, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SpiderCrawlRequest - Input parameters for a Spider crawl job.
//   SpiderCrawlItem - Single crawled page result with extracted content and metadata.
//   SpiderCrawlResponse - Aggregated crawl response with data array and status.
//   SpiderErrorCode - Supported Spider client error codes.
//   SpiderProxyError - Typed error for HTTP/network failures during Spider proxy calls.
//   SpiderTimeoutError - Typed error for timeout failures during Spider proxy calls.
//   SpiderCloudClient - Runtime client interface exposing runCrawl.
//   createSpiderCloudClient - Build client bound to AppConfig and Logger.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.2.0 - Accept optional status_code in SpiderCrawlItem payloads to match provider/runtime variance.
// END_CHANGE_SUMMARY

import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";

// START_BLOCK_DEFINE_SPIDER_CRAWL_TYPES_M_SPIDER_CLOUD_CLIENT_001
export type SpiderCrawlRequest = {
  url: string;
  limit?: number;
  depth?: number;
  return_format?: string;
};

export type SpiderCrawlItem = {
  url: string;
  content: string;
  status_code?: number;
  metadata?: {
    title?: string;
    description?: string;
    [key: string]: unknown;
  };
};

export type SpiderCrawlResponse = {
  data: SpiderCrawlItem[];
  status: string;
};
// END_BLOCK_DEFINE_SPIDER_CRAWL_TYPES_M_SPIDER_CLOUD_CLIENT_001

// START_BLOCK_DEFINE_SPIDER_ERROR_TYPES_M_SPIDER_CLOUD_CLIENT_002
export type SpiderErrorCode = "SPIDER_PROXY_ERROR" | "SPIDER_TIMEOUT";

export class SpiderProxyError extends Error {
  public readonly code: "SPIDER_PROXY_ERROR" = "SPIDER_PROXY_ERROR";
  public readonly status?: number;
  public readonly details?: Record<string, unknown>;

  public constructor(
    message: string,
    status?: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SpiderProxyError";
    this.status = status;
    this.details = details;
  }
}

export class SpiderTimeoutError extends Error {
  public readonly code: "SPIDER_TIMEOUT" = "SPIDER_TIMEOUT";
  public readonly details?: Record<string, unknown>;

  public constructor(
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SpiderTimeoutError";
    this.details = details;
  }
}
// END_BLOCK_DEFINE_SPIDER_ERROR_TYPES_M_SPIDER_CLOUD_CLIENT_002

export type SpiderCloudClient = {
  runCrawl(request: SpiderCrawlRequest): Promise<SpiderCrawlResponse>;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const SPIDER_CRAWL_PATH = "api.spider.cloud/v1/crawl";
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_JITTER_MAX_MS = 500;

type TimeoutControl = {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
};

// START_CONTRACT: createTimeoutControl
//   PURPOSE: Create a timeout-aware AbortSignal for Spider proxy fetch calls.
//   INPUTS: { timeoutMs: number - Timeout in milliseconds }
//   OUTPUTS: { TimeoutControl - Signal and timeout bookkeeping helpers }
//   SIDE_EFFECTS: [Starts timeout timer when AbortSignal.timeout is unavailable]
//   LINKS: [M-SPIDER-CLOUD-CLIENT]
// END_CONTRACT: createTimeoutControl
function createTimeoutControl(timeoutMs: number): TimeoutControl {
  // START_BLOCK_CREATE_TIMEOUT_SIGNAL_M_SPIDER_CLOUD_CLIENT_003
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
  // END_BLOCK_CREATE_TIMEOUT_SIGNAL_M_SPIDER_CLOUD_CLIENT_003
}

// START_CONTRACT: buildCrawlUrl
//   PURPOSE: Build the Spider proxy crawl URL from the proxy base URL.
//   INPUTS: { proxyBaseUrl: string - Base proxy URL from config }
//   OUTPUTS: { string - Absolute request URL for the Spider crawl endpoint }
//   SIDE_EFFECTS: [Throws SpiderProxyError on invalid URL]
//   LINKS: [M-SPIDER-CLOUD-CLIENT, M-CONFIG]
// END_CONTRACT: buildCrawlUrl
function buildCrawlUrl(proxyBaseUrl: string): string {
  // START_BLOCK_BUILD_SPIDER_CRAWL_URL_M_SPIDER_CLOUD_CLIENT_004
  const trimmed = proxyBaseUrl.trim();
  if (!trimmed) {
    throw new SpiderProxyError(
      "config.proxy.baseUrl must be a non-empty string.",
      undefined,
      { proxyBaseUrl },
    );
  }

  try {
    const base = trimmed.replace(/\/+$/, "");
    const url = new URL(`${base}/${SPIDER_CRAWL_PATH}`);
    return url.toString();
  } catch (error: unknown) {
    throw new SpiderProxyError(
      "Failed to build Spider proxy crawl URL.",
      undefined,
      {
        proxyBaseUrl: trimmed,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  // END_BLOCK_BUILD_SPIDER_CRAWL_URL_M_SPIDER_CLOUD_CLIENT_004
}

// START_CONTRACT: readResponsePreview
//   PURPOSE: Read and cap response payload text for diagnostics.
//   INPUTS: { response: Response - Fetch response, maxLength: number | undefined - Optional max preview length }
//   OUTPUTS: { Promise<string> - Preview text for logs and error details }
//   SIDE_EFFECTS: [Consumes response body stream]
//   LINKS: [M-SPIDER-CLOUD-CLIENT]
// END_CONTRACT: readResponsePreview
async function readResponsePreview(response: Response, maxLength = 1000): Promise<string> {
  // START_BLOCK_READ_RESPONSE_PREVIEW_M_SPIDER_CLOUD_CLIENT_005
  try {
    const text = await response.text();
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}...`;
  } catch {
    return "";
  }
  // END_BLOCK_READ_RESPONSE_PREVIEW_M_SPIDER_CLOUD_CLIENT_005
}

// START_CONTRACT: parseSpiderCrawlResponse
//   PURPOSE: Parse successful Spider proxy response as SpiderCrawlResponse.
//   INPUTS: { response: Response - HTTP response from Spider proxy }
//   OUTPUTS: { Promise<SpiderCrawlResponse> - Parsed crawl response }
//   SIDE_EFFECTS: [Consumes response body stream]
//   LINKS: [M-SPIDER-CLOUD-CLIENT]
// END_CONTRACT: parseSpiderCrawlResponse
async function parseSpiderCrawlResponse(response: Response): Promise<SpiderCrawlResponse> {
  // START_BLOCK_PARSE_SPIDER_CRAWL_RESPONSE_M_SPIDER_CLOUD_CLIENT_006
  const rawText = await response.text();
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new SpiderProxyError(
      "Spider proxy response is not valid JSON.",
      response.status,
      { bodyPreview: rawText.slice(0, 1000) },
    );
  }

  if (parsed === null || (typeof parsed !== "object" && !Array.isArray(parsed))) {
    throw new SpiderProxyError(
      "Spider proxy response JSON must be an object or array.",
      response.status,
      { bodyPreview: rawText.slice(0, 1000) },
    );
  }

  // Spider API returns a JSON array of crawl results directly
  if (Array.isArray(parsed)) {
    return { data: parsed as SpiderCrawlItem[], status: "ok" };
  }

  const result = parsed as Record<string, unknown>;
  const data = Array.isArray(result.data) ? result.data : [];
  const status = typeof result.status === "string" ? result.status : "unknown";

  return { data: data as SpiderCrawlItem[], status };
  // END_BLOCK_PARSE_SPIDER_CRAWL_RESPONSE_M_SPIDER_CLOUD_CLIENT_006
}

// START_CONTRACT: normalizeSpiderError
//   PURPOSE: Convert unknown runtime errors to typed SpiderProxyError or SpiderTimeoutError.
//   INPUTS: { error: unknown - Caught error, timedOut: boolean - Timeout flag, durationMs: number - Elapsed request time }
//   OUTPUTS: { SpiderProxyError | SpiderTimeoutError - Normalized typed error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SPIDER-CLOUD-CLIENT]
// END_CONTRACT: normalizeSpiderError
function normalizeSpiderError(
  error: unknown,
  timedOut: boolean,
  durationMs: number,
): SpiderProxyError | SpiderTimeoutError {
  // START_BLOCK_NORMALIZE_SPIDER_ERRORS_M_SPIDER_CLOUD_CLIENT_007
  if (error instanceof SpiderProxyError || error instanceof SpiderTimeoutError) {
    return error;
  }

  const errorName = error instanceof Error ? error.name : "";
  if (timedOut || errorName === "TimeoutError") {
    return new SpiderTimeoutError(
      "Spider proxy request timed out.",
      {
        durationMs,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  return new SpiderProxyError(
    "Spider proxy request failed before receiving a valid response.",
    undefined,
    {
      durationMs,
      cause: error instanceof Error ? error.message : String(error),
    },
  );
  // END_BLOCK_NORMALIZE_SPIDER_ERRORS_M_SPIDER_CLOUD_CLIENT_007
}

// START_CONTRACT: isTransientSpiderError
//   PURPOSE: Determine if a Spider error is transient and eligible for retry.
//   INPUTS: { error: SpiderProxyError | SpiderTimeoutError - Normalized error }
//   OUTPUTS: { boolean - True if the error is transient (5xx, timeout, network) }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SPIDER-CLOUD-CLIENT]
// END_CONTRACT: isTransientSpiderError
export function isTransientSpiderError(error: SpiderProxyError | SpiderTimeoutError): boolean {
  // START_BLOCK_IS_TRANSIENT_SPIDER_ERROR_M_SPIDER_CLOUD_CLIENT_012
  if (error instanceof SpiderTimeoutError) {
    return true;
  }
  if (error instanceof SpiderProxyError) {
    // No status means network-level failure (no response received)
    if (error.status === undefined) {
      return true;
    }
    // 5xx server errors are transient
    return error.status >= 500 && error.status < 600;
  }
  return false;
  // END_BLOCK_IS_TRANSIENT_SPIDER_ERROR_M_SPIDER_CLOUD_CLIENT_012
}

// START_CONTRACT: computeRetryDelay
//   PURPOSE: Compute exponential backoff delay with jitter for retry attempts.
//   INPUTS: { attempt: number - Zero-based retry attempt index }
//   OUTPUTS: { number - Delay in milliseconds }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SPIDER-CLOUD-CLIENT]
// END_CONTRACT: computeRetryDelay
export function computeRetryDelay(attempt: number): number {
  // START_BLOCK_COMPUTE_RETRY_DELAY_M_SPIDER_CLOUD_CLIENT_013
  const exponentialDelay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * RETRY_JITTER_MAX_MS;
  return exponentialDelay + jitter;
  // END_BLOCK_COMPUTE_RETRY_DELAY_M_SPIDER_CLOUD_CLIENT_013
}

// START_CONTRACT: createSpiderCloudClient
//   PURPOSE: Create a reusable Spider crawl client bound to config and logger.
//   INPUTS: { config: AppConfig - Runtime configuration, logger: Logger - Module logger }
//   OUTPUTS: { SpiderCloudClient - Client facade exposing runCrawl }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SPIDER-CLOUD-CLIENT, M-CONFIG, M-LOGGER]
// END_CONTRACT: createSpiderCloudClient
export function createSpiderCloudClient(config: AppConfig, logger: Logger): SpiderCloudClient {
  // START_BLOCK_CREATE_BOUND_SPIDER_CLOUD_CLIENT_M_SPIDER_CLOUD_CLIENT_008
  return {
    runCrawl: async (request: SpiderCrawlRequest): Promise<SpiderCrawlResponse> => {
      return runCrawl(config, logger, request);
    },
  };
  // END_BLOCK_CREATE_BOUND_SPIDER_CLOUD_CLIENT_M_SPIDER_CLOUD_CLIENT_008
}

// START_CONTRACT: runCrawl
//   PURPOSE: Execute a Spider proxy crawl call with auth, timeout, logging, and normalized errors.
//   INPUTS: { config: AppConfig - Runtime configuration, logger: Logger - Module logger, request: SpiderCrawlRequest - Crawl parameters, timeoutMs: number | undefined - Optional timeout override }
//   OUTPUTS: { Promise<SpiderCrawlResponse> - Parsed crawl response }
//   SIDE_EFFECTS: [Performs HTTP request and emits logs]
//   LINKS: [M-SPIDER-CLOUD-CLIENT, M-CONFIG, M-LOGGER]
// END_CONTRACT: runCrawl
export async function runCrawl(
  config: AppConfig,
  logger: Logger,
  request: SpiderCrawlRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SpiderCrawlResponse> {
  // START_BLOCK_VALIDATE_RUN_CRAWL_INPUTS_M_SPIDER_CLOUD_CLIENT_009
  const functionName = "runCrawl";

  const seedUrl = (request.url ?? "").trim();
  if (!seedUrl) {
    throw new SpiderProxyError(
      "request.url must be a non-empty string.",
      undefined,
      { request },
    );
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new SpiderProxyError(
      "timeoutMs must be a positive integer.",
      undefined,
      { timeoutMs },
    );
  }
  // END_BLOCK_VALIDATE_RUN_CRAWL_INPUTS_M_SPIDER_CLOUD_CLIENT_009

  // START_BLOCK_BUILD_REQUEST_URL_AND_HEADERS_M_SPIDER_CLOUD_CLIENT_010
  const requestUrl = buildCrawlUrl(config.proxy.baseUrl);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.proxy.spiderApiKey}`,
    "X-Proxy-Key": config.proxy.secret,
    "Content-Type": "application/json",
  };

  const body: Record<string, unknown> = {
    url: seedUrl,
  };
  if (request.limit !== undefined) {
    body.limit = request.limit;
  }
  if (request.depth !== undefined) {
    body.depth = request.depth;
  }
  body.return_format = request.return_format ?? "markdown";
  // END_BLOCK_BUILD_REQUEST_URL_AND_HEADERS_M_SPIDER_CLOUD_CLIENT_010

  // START_BLOCK_EXECUTE_FETCH_WITH_RETRY_AND_LOGGING_M_SPIDER_CLOUD_CLIENT_011
  logger.info(
    "Starting Spider proxy crawl request.",
    functionName,
    "EXECUTE_FETCH_WITH_RETRY_AND_LOGGING",
    { seedUrl, timeoutMs },
  );

  let lastError: SpiderProxyError | SpiderTimeoutError | undefined;

  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delayMs = computeRetryDelay(attempt - 1);
      logger.warn(
        `Retrying Spider crawl (attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS}) after ${Math.round(delayMs)}ms delay.`,
        functionName,
        "SPIDER_RETRY",
        { seedUrl, attempt: attempt + 1, maxAttempts: RETRY_MAX_ATTEMPTS, delayMs: Math.round(delayMs) },
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
        "Received Spider proxy response status.",
        functionName,
        "EXECUTE_FETCH_WITH_RETRY_AND_LOGGING",
        { seedUrl, status: response.status, durationMs, attempt: attempt + 1 },
      );

      if (!response.ok) {
        const bodyPreview = await readResponsePreview(response);
        throw new SpiderProxyError(
          `Spider proxy returned non-success status ${response.status}.`,
          response.status,
          {
            seedUrl,
            status: response.status,
            durationMs,
            bodyPreview,
          },
        );
      }

      return await parseSpiderCrawlResponse(response);
    } catch (error: unknown) {
      const durationMs = Date.now() - startedAt;
      const normalizedError = normalizeSpiderError(
        error,
        timeoutControl.didTimeout(),
        durationMs,
      );

      lastError = normalizedError;

      // Only retry on transient errors; throw immediately on non-transient
      if (!isTransientSpiderError(normalizedError) || attempt === RETRY_MAX_ATTEMPTS - 1) {
        const logMethod = normalizedError instanceof SpiderProxyError ? logger.warn : logger.error;
        logMethod(
          "Spider proxy call failed.",
          functionName,
          "NORMALIZE_SPIDER_FAILURE",
          {
            code: normalizedError.code,
            seedUrl,
            status: normalizedError instanceof SpiderProxyError ? normalizedError.status : undefined,
            durationMs,
            attempt: attempt + 1,
            retriesExhausted: attempt === RETRY_MAX_ATTEMPTS - 1,
          },
        );
        throw normalizedError;
      }

      // Transient error: log and continue to next attempt
      logger.warn(
        `Spider proxy call failed with transient error (attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS}).`,
        functionName,
        "SPIDER_TRANSIENT_ERROR",
        {
          code: normalizedError.code,
          seedUrl,
          status: normalizedError instanceof SpiderProxyError ? normalizedError.status : undefined,
          durationMs,
          attempt: attempt + 1,
        },
      );
    } finally {
      timeoutControl.cleanup();
    }
  }

  // Should not reach here, but satisfy TypeScript
  throw lastError ?? new SpiderProxyError("Spider proxy call failed after all retries.", undefined, { seedUrl });
  // END_BLOCK_EXECUTE_FETCH_WITH_RETRY_AND_LOGGING_M_SPIDER_CLOUD_CLIENT_011
}
