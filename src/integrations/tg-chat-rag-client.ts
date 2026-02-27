// FILE: src/integrations/tg-chat-rag-client.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Call tg-chat-rag methods API via POST /api/v1/methods/<tool_name> with Bearer auth.
//   SCOPE: Build upstream method URLs, execute authenticated HTTP calls, apply timeout policy, normalize errors, and return parsed JSON objects.
//   DEPENDS: M-CONFIG, M-LOGGER
//   LINKS: M-TG-CHAT-RAG-CLIENT, M-CONFIG, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   UpstreamErrorCode - Supported normalized upstream error codes.
//   UpstreamCallError - Typed upstream integration error with code, status, and details.
//   TgChatRagClient - Runtime client interface for calling upstream tg-chat-rag methods.
//   createTgChatRagClient - Build client bound to AppConfig and Logger.
//   callMethod - Execute a single upstream methods API call and return parsed JSON object response.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Hardened URL construction and timeout normalization for deterministic upstream error mapping while preserving callMethod contract.
// END_CHANGE_SUMMARY

import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";

export type UpstreamErrorCode =
  | "UPSTREAM_HTTP_ERROR"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_PROTOCOL_ERROR";

export class UpstreamCallError extends Error {
  public readonly code: UpstreamErrorCode;
  public readonly status?: number;
  public readonly details?: Record<string, unknown>;

  public constructor(
    code: UpstreamErrorCode,
    message: string,
    status?: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "UpstreamCallError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type TgChatRagClient = {
  callMethod(toolName: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
};

type TimeoutControl = {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
};

// START_CONTRACT: isPlainObject
//   PURPOSE: Validate unknown runtime values as non-null plain objects.
//   INPUTS: { value: unknown - Candidate value to inspect }
//   OUTPUTS: { boolean - True when value is a plain object }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TG-CHAT-RAG-CLIENT]
// END_CONTRACT: isPlainObject
function isPlainObject(value: unknown): value is Record<string, unknown> {
  // START_BLOCK_VALIDATE_PLAIN_OBJECT_INPUT_M_TG_CHAT_RAG_CLIENT_001
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
  // END_BLOCK_VALIDATE_PLAIN_OBJECT_INPUT_M_TG_CHAT_RAG_CLIENT_001
}

// START_CONTRACT: normalizeNonEmptyString
//   PURPOSE: Normalize string inputs and reject empty results.
//   INPUTS: { value: unknown - Candidate value, fieldName: string - Field label for diagnostics }
//   OUTPUTS: { string - Trimmed non-empty string value }
//   SIDE_EFFECTS: [Throws UpstreamCallError when value is not a non-empty string]
//   LINKS: [M-TG-CHAT-RAG-CLIENT]
// END_CONTRACT: normalizeNonEmptyString
function normalizeNonEmptyString(value: unknown, fieldName: string): string {
  // START_BLOCK_NORMALIZE_AND_VALIDATE_STRING_FIELDS_M_TG_CHAT_RAG_CLIENT_002
  if (typeof value !== "string") {
    throw new UpstreamCallError(
      "UPSTREAM_PROTOCOL_ERROR",
      `${fieldName} must be a non-empty string.`,
      undefined,
      { fieldName },
    );
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new UpstreamCallError(
      "UPSTREAM_PROTOCOL_ERROR",
      `${fieldName} must be a non-empty string.`,
      undefined,
      { fieldName },
    );
  }

  return normalized;
  // END_BLOCK_NORMALIZE_AND_VALIDATE_STRING_FIELDS_M_TG_CHAT_RAG_CLIENT_002
}

// START_CONTRACT: buildMethodUrl
//   PURPOSE: Build the tg-chat-rag methods API URL for a specific tool name.
//   INPUTS: { baseUrl: string - Base upstream URL, toolName: string - Method name }
//   OUTPUTS: { string - Absolute request URL }
//   SIDE_EFFECTS: [Throws UpstreamCallError on invalid URL or tool name]
//   LINKS: [M-TG-CHAT-RAG-CLIENT, M-CONFIG]
// END_CONTRACT: buildMethodUrl
function buildMethodUrl(baseUrl: string, toolName: string): string {
  // START_BLOCK_BUILD_UPSTREAM_METHOD_URL_M_TG_CHAT_RAG_CLIENT_003
  const normalizedBaseUrl = normalizeNonEmptyString(baseUrl, "config.tgChatRag.baseUrl");
  const normalizedToolName = normalizeNonEmptyString(toolName, "toolName");
  try {
    const base = normalizedBaseUrl.replace(/\/+$/, "");
    const url = new URL(`${base}/api/v1/methods/${encodeURIComponent(normalizedToolName)}`);
    return url.toString();
  } catch (error: unknown) {
    throw new UpstreamCallError(
      "UPSTREAM_PROTOCOL_ERROR",
      "Failed to build upstream method URL.",
      undefined,
      {
        toolName: normalizedToolName,
        baseUrl: normalizedBaseUrl,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  // END_BLOCK_BUILD_UPSTREAM_METHOD_URL_M_TG_CHAT_RAG_CLIENT_003
}

// START_CONTRACT: createTimeoutControl
//   PURPOSE: Create a timeout-aware AbortSignal for upstream fetch calls.
//   INPUTS: { timeoutMs: number - Timeout in milliseconds }
//   OUTPUTS: { TimeoutControl - Signal and timeout bookkeeping helpers }
//   SIDE_EFFECTS: [Starts timeout timer when AbortSignal.timeout is unavailable]
//   LINKS: [M-TG-CHAT-RAG-CLIENT, M-CONFIG]
// END_CONTRACT: createTimeoutControl
function createTimeoutControl(timeoutMs: number): TimeoutControl {
  // START_BLOCK_CREATE_TIMEOUT_SIGNAL_FOR_FETCH_M_TG_CHAT_RAG_CLIENT_004
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
  // END_BLOCK_CREATE_TIMEOUT_SIGNAL_FOR_FETCH_M_TG_CHAT_RAG_CLIENT_004
}

// START_CONTRACT: readResponsePreview
//   PURPOSE: Read and cap upstream response payload text for diagnostics.
//   INPUTS: { response: Response - Fetch response, maxLength: number | undefined - Optional max preview length }
//   OUTPUTS: { Promise<string> - Preview text for logs and error details }
//   SIDE_EFFECTS: [Consumes response body stream]
//   LINKS: [M-TG-CHAT-RAG-CLIENT]
// END_CONTRACT: readResponsePreview
async function readResponsePreview(response: Response, maxLength = 1000): Promise<string> {
  // START_BLOCK_READ_AND_TRIM_RESPONSE_PREVIEW_M_TG_CHAT_RAG_CLIENT_005
  try {
    const text = await response.text();
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}...`;
  } catch {
    return "";
  }
  // END_BLOCK_READ_AND_TRIM_RESPONSE_PREVIEW_M_TG_CHAT_RAG_CLIENT_005
}

// START_CONTRACT: parseSuccessJsonObject
//   PURPOSE: Parse successful upstream response as a JSON object.
//   INPUTS: { response: Response - Upstream HTTP response, toolName: string - Tool context for error details }
//   OUTPUTS: { Promise<Record<string, unknown>> - Parsed upstream JSON object }
//   SIDE_EFFECTS: [Consumes response body stream]
//   LINKS: [M-TG-CHAT-RAG-CLIENT]
// END_CONTRACT: parseSuccessJsonObject
async function parseSuccessJsonObject(
  response: Response,
  toolName: string,
): Promise<Record<string, unknown>> {
  // START_BLOCK_PARSE_AND_VALIDATE_SUCCESS_JSON_BODY_M_TG_CHAT_RAG_CLIENT_006
  const rawText = await response.text();
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new UpstreamCallError(
      "UPSTREAM_PROTOCOL_ERROR",
      "Upstream response is not valid JSON.",
      response.status,
      {
        toolName,
        bodyPreview: rawText.slice(0, 1000),
      },
    );
  }

  if (!isPlainObject(parsed)) {
    throw new UpstreamCallError(
      "UPSTREAM_PROTOCOL_ERROR",
      "Upstream response JSON must be an object.",
      response.status,
      { toolName },
    );
  }

  return parsed;
  // END_BLOCK_PARSE_AND_VALIDATE_SUCCESS_JSON_BODY_M_TG_CHAT_RAG_CLIENT_006
}

// START_CONTRACT: normalizeUnknownCallError
//   PURPOSE: Convert unknown runtime errors to typed UpstreamCallError values.
//   INPUTS: { error: unknown - Caught error, timedOut: boolean - Timeout flag, toolName: string - Tool context, durationMs: number - Elapsed request time }
//   OUTPUTS: { UpstreamCallError - Normalized typed error }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TG-CHAT-RAG-CLIENT]
// END_CONTRACT: normalizeUnknownCallError
function normalizeUnknownCallError(
  error: unknown,
  timedOut: boolean,
  toolName: string,
  durationMs: number,
): UpstreamCallError {
  // START_BLOCK_NORMALIZE_UNKNOWN_FETCH_ERRORS_M_TG_CHAT_RAG_CLIENT_007
  if (error instanceof UpstreamCallError) {
    return error;
  }

  const errorName = error instanceof Error ? error.name : "";
  if (timedOut || errorName === "TimeoutError") {
    return new UpstreamCallError(
      "UPSTREAM_TIMEOUT",
      "Upstream request timed out.",
      undefined,
      {
        toolName,
        durationMs,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  return new UpstreamCallError(
    "UPSTREAM_PROTOCOL_ERROR",
    "Upstream request failed before receiving a valid response.",
    undefined,
    {
      toolName,
      durationMs,
      cause: error instanceof Error ? error.message : String(error),
    },
  );
  // END_BLOCK_NORMALIZE_UNKNOWN_FETCH_ERRORS_M_TG_CHAT_RAG_CLIENT_007
}

// START_CONTRACT: createTgChatRagClient
//   PURPOSE: Create a reusable tg-chat-rag client bound to config and logger.
//   INPUTS: { config: AppConfig - Runtime configuration, logger: Logger - Module logger }
//   OUTPUTS: { TgChatRagClient - Client facade exposing callMethod }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TG-CHAT-RAG-CLIENT, M-CONFIG, M-LOGGER]
// END_CONTRACT: createTgChatRagClient
export function createTgChatRagClient(config: AppConfig, logger: Logger): TgChatRagClient {
  // START_BLOCK_CREATE_BOUND_TG_CHAT_RAG_CLIENT_M_TG_CHAT_RAG_CLIENT_008
  return {
    callMethod: async (toolName: string, payload: Record<string, unknown>) => {
      return callMethod(config, logger, toolName, payload);
    },
  };
  // END_BLOCK_CREATE_BOUND_TG_CHAT_RAG_CLIENT_M_TG_CHAT_RAG_CLIENT_008
}

// START_CONTRACT: callMethod
//   PURPOSE: Execute a tg-chat-rag methods API call with auth, timeout, logging, and normalized errors.
//   INPUTS: { config: AppConfig - Runtime configuration, logger: Logger - Module logger, toolName: string - Upstream method name, payload: Record<string, unknown> - JSON payload object }
//   OUTPUTS: { Promise<Record<string, unknown>> - Parsed upstream JSON response object }
//   SIDE_EFFECTS: [Performs HTTP request and emits logs]
//   LINKS: [M-TG-CHAT-RAG-CLIENT, M-CONFIG, M-LOGGER]
// END_CONTRACT: callMethod
export async function callMethod(
  config: AppConfig,
  logger: Logger,
  toolName: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // START_BLOCK_VALIDATE_CALL_METHOD_INPUTS_M_TG_CHAT_RAG_CLIENT_009
  const functionName = "callMethod";
  const normalizedToolName = normalizeNonEmptyString(toolName, "toolName");
  if (!isPlainObject(payload)) {
    throw new UpstreamCallError(
      "UPSTREAM_PROTOCOL_ERROR",
      "payload must be a plain object.",
      undefined,
      { toolName: normalizedToolName },
    );
  }

  const timeoutMs = config.tgChatRag.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new UpstreamCallError(
      "UPSTREAM_PROTOCOL_ERROR",
      "config.tgChatRag.timeoutMs must be a positive integer.",
      undefined,
      { timeoutMs },
    );
  }
  // END_BLOCK_VALIDATE_CALL_METHOD_INPUTS_M_TG_CHAT_RAG_CLIENT_009

  // START_BLOCK_BUILD_REQUEST_URL_AND_HEADERS_M_TG_CHAT_RAG_CLIENT_010
  const requestUrl = buildMethodUrl(config.tgChatRag.baseUrl, normalizedToolName);
  const bearerToken = normalizeNonEmptyString(
    config.tgChatRag.bearerToken,
    "config.tgChatRag.bearerToken",
  );
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearerToken}`,
    "Content-Type": "application/json",
  };
  // END_BLOCK_BUILD_REQUEST_URL_AND_HEADERS_M_TG_CHAT_RAG_CLIENT_010

  // START_BLOCK_EXECUTE_FETCH_WITH_TIMEOUT_AND_LOGGING_M_TG_CHAT_RAG_CLIENT_011
  const startedAt = Date.now();
  const timeoutControl = createTimeoutControl(timeoutMs);
  logger.info(
    "Starting upstream method call.",
    functionName,
    "EXECUTE_FETCH_WITH_TIMEOUT_AND_LOGGING",
    { toolName: normalizedToolName, timeoutMs },
  );

  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: timeoutControl.signal,
    });

    const durationMs = Date.now() - startedAt;
    logger.info(
      "Received upstream response status.",
      functionName,
      "EXECUTE_FETCH_WITH_TIMEOUT_AND_LOGGING",
      { toolName: normalizedToolName, status: response.status, durationMs },
    );

    if (!response.ok) {
      const bodyPreview = await readResponsePreview(response);
      throw new UpstreamCallError(
        "UPSTREAM_HTTP_ERROR",
        `Upstream returned non-success status ${response.status}.`,
        response.status,
        {
          toolName: normalizedToolName,
          status: response.status,
          durationMs,
          bodyPreview,
        },
      );
    }

    return await parseSuccessJsonObject(response, normalizedToolName);
  } catch (error: unknown) {
    const durationMs = Date.now() - startedAt;
    const normalizedError = normalizeUnknownCallError(
      error,
      timeoutControl.didTimeout(),
      normalizedToolName,
      durationMs,
    );
    const logMethod = normalizedError.code === "UPSTREAM_HTTP_ERROR" ? logger.warn : logger.error;
    logMethod(
      "Upstream call failed.",
      functionName,
      "NORMALIZE_UPSTREAM_FAILURE",
      {
        code: normalizedError.code,
        toolName: normalizedToolName,
        status: normalizedError.status,
        durationMs,
      },
    );
    throw normalizedError;
  } finally {
    timeoutControl.cleanup();
  }
  // END_BLOCK_EXECUTE_FETCH_WITH_TIMEOUT_AND_LOGGING_M_TG_CHAT_RAG_CLIENT_011
}
