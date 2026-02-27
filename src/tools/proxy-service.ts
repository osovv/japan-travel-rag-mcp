// FILE: src/tools/proxy-service.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Apply policy-safe normalization and proxy supported MCP tool calls to tg-chat-rag.
//   SCOPE: Enforce tool allowlist, validate inputs, inject internal search chat scope policy, call upstream methods API, and map results/errors to MCP proxy outputs.
//   DEPENDS: M-CONFIG, M-TOOLS-CONTRACTS, M-TG-CHAT-RAG-CLIENT, M-LOGGER
//   LINKS: M-TOOL-PROXY, M-CONFIG, M-TOOLS-CONTRACTS, M-TG-CHAT-RAG-CLIENT, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   McpToolResult - Normalized MCP-compatible tool result payload.
//   ProxyErrorCode - Error code union for proxy execution failures.
//   ProxyExecutionError - Typed proxy execution error with code and details.
//   ToolProxyService - Bound service interface for executing supported proxied tools.
//   createToolProxyService - Build a reusable ToolProxyService with injected dependencies.
//   executeTool - Validate tool input, enforce policy, call upstream, and shape MCP output.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Simplified executeTool orchestration to explicit validate -> policy -> upstream -> normalize flow while keeping deterministic error mapping and chat_ids policy enforcement.
// END_CHANGE_SUMMARY

import type { AppConfig } from "../config/index";
import type { Logger } from "../logger/index";
import type { TgChatRagClient } from "../integrations/tg-chat-rag-client";
import { UpstreamCallError } from "../integrations/tg-chat-rag-client";
import {
  PROXIED_TOOL_NAMES,
  SchemaValidationError,
  isProxiedToolName,
  validateToolInput,
} from "./contracts";
import type { ProxiedToolName, SearchMessagesInputPublic } from "./contracts";

type ValidatedToolInput = ReturnType<typeof validateToolInput>;

export type McpToolResult = {
  content: Array<{
    type: "text";
    text: string;
  }>;
  structuredContent: Record<string, unknown>;
};

export type ProxyErrorCode = "VALIDATION_ERROR" | "UNSUPPORTED_TOOL" | "UPSTREAM_ERROR";

export class ProxyExecutionError extends Error {
  public readonly code: ProxyErrorCode;
  public readonly details?: Record<string, unknown>;

  public constructor(code: ProxyErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ProxyExecutionError";
    this.code = code;
    this.details = details;
  }
}

export type ToolProxyService = {
  executeTool(toolName: string, rawArgs: unknown): Promise<McpToolResult>;
};

// START_CONTRACT: isPlainObject
//   PURPOSE: Validate unknown runtime values as plain objects.
//   INPUTS: { value: unknown - Candidate value to inspect }
//   OUTPUTS: { boolean - True when value is a plain object }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TOOL-PROXY]
// END_CONTRACT: isPlainObject
function isPlainObject(value: unknown): value is Record<string, unknown> {
  // START_BLOCK_CHECK_PLAIN_OBJECT_SHAPE_M_TOOL_PROXY_001
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
  // END_BLOCK_CHECK_PLAIN_OBJECT_SHAPE_M_TOOL_PROXY_001
}

// START_CONTRACT: hasForbiddenChatIdsInFiltersTree
//   PURPOSE: Detect chat_ids keys anywhere under the filters subtree.
//   INPUTS: { filtersValue: unknown - Candidate filters subtree }
//   OUTPUTS: { boolean - True when forbidden filters.chat_ids appears in subtree }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TOOL-PROXY]
// END_CONTRACT: hasForbiddenChatIdsInFiltersTree
function hasForbiddenChatIdsInFiltersTree(filtersValue: unknown): boolean {
  // START_BLOCK_DETECT_CHAT_IDS_IN_FILTERS_SUBTREE_M_TOOL_PROXY_002
  const stack: unknown[] = [filtersValue];
  const visited = new Set<unknown>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || current === null) {
      continue;
    }
    if (typeof current !== "object") {
      continue;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    const objectValue = current as Record<string, unknown>;
    for (const key of Object.keys(objectValue)) {
      if (key === "chat_ids") {
        return true;
      }
      stack.push(objectValue[key]);
    }
  }

  return false;
  // END_BLOCK_DETECT_CHAT_IDS_IN_FILTERS_SUBTREE_M_TOOL_PROXY_002
}

// START_CONTRACT: validateAndMapInput
//   PURPOSE: Validate tool input and map schema validation failures to proxy validation errors.
//   INPUTS: { toolName: ProxiedToolName - Supported tool name, rawArgs: unknown - Untrusted tool args, logger: Logger - Module logger }
//   OUTPUTS: { ValidatedToolInput - Validated and normalized tool input }
//   SIDE_EFFECTS: [Throws ProxyExecutionError on validation failures]
//   LINKS: [M-TOOL-PROXY, M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: validateAndMapInput
function validateAndMapInput(
  toolName: ProxiedToolName,
  rawArgs: unknown,
  logger: Logger,
): ValidatedToolInput {
  // START_BLOCK_VALIDATE_INPUT_AND_MAP_SCHEMA_ERRORS_M_TOOL_PROXY_004
  try {
    return validateToolInput(toolName, rawArgs, logger);
  } catch (error: unknown) {
    if (error instanceof ProxyExecutionError) {
      throw error;
    }

    const detailMessage = error instanceof Error ? error.message : String(error);
    logger.warn(
      "Tool input validation failed.",
      "executeTool",
      "VALIDATE_INPUT_AND_MAP_SCHEMA_ERRORS",
      { toolName, detailMessage },
    );

    if (error instanceof SchemaValidationError) {
      throw new ProxyExecutionError(
        "VALIDATION_ERROR",
        "Tool input failed schema validation.",
        { toolName, details: error.details },
      );
    }

    throw new ProxyExecutionError(
      "VALIDATION_ERROR",
      "Tool input validation failed.",
      { toolName, cause: detailMessage },
    );
  }
  // END_BLOCK_VALIDATE_INPUT_AND_MAP_SCHEMA_ERRORS_M_TOOL_PROXY_004
}

// START_CONTRACT: buildUpstreamPayloadWithPolicy
//   PURPOSE: Build upstream payload and enforce internal search chat scope policy for search_messages.
//   INPUTS: { toolName: ProxiedToolName - Supported tool name, validatedArgs: ValidatedToolInput - Validated input object, config: AppConfig - Runtime configuration, logger: Logger - Module logger }
//   OUTPUTS: { Record<string, unknown> - Upstream payload object }
//   SIDE_EFFECTS: [Logs policy injection for search_messages, throws ProxyExecutionError on policy boundary violation]
//   LINKS: [M-TOOL-PROXY, M-CONFIG, M-LOGGER]
// END_CONTRACT: buildUpstreamPayloadWithPolicy
function buildUpstreamPayloadWithPolicy(
  toolName: ProxiedToolName,
  validatedArgs: ValidatedToolInput,
  config: AppConfig,
  logger: Logger,
): Record<string, unknown> {
  // START_BLOCK_APPLY_SEARCH_CHAT_SCOPE_POLICY_M_TOOL_PROXY_005
  if (toolName !== "search_messages") {
    return { ...(validatedArgs as Record<string, unknown>) };
  }

  const searchArgs = validatedArgs as SearchMessagesInputPublic;
  if (hasForbiddenChatIdsInFiltersTree(searchArgs.filters)) {
    logger.warn(
      "Rejected search_messages request containing forbidden filters.chat_ids.",
      "executeTool",
      "APPLY_SEARCH_CHAT_SCOPE_POLICY",
      { toolName },
    );
    throw new ProxyExecutionError(
      "VALIDATION_ERROR",
      "search_messages input forbids filters.chat_ids at public boundary.",
      { reason: "FORBIDDEN_PUBLIC_SEARCH_CHAT_IDS" },
    );
  }

  const basePayload: Record<string, unknown> = { ...searchArgs };
  const existingFilters = isPlainObject(searchArgs.filters) ? { ...searchArgs.filters } : {};

  existingFilters.chat_ids = [...config.tgChatRag.chatIds];
  basePayload.filters = existingFilters;

  logger.info(
    "Injected internal chat_ids policy for search_messages.",
    "executeTool",
    "APPLY_SEARCH_CHAT_SCOPE_POLICY",
    {
      toolName,
      injectedChatIdsCount: config.tgChatRag.chatIds.length,
    },
  );

  return basePayload;
  // END_BLOCK_APPLY_SEARCH_CHAT_SCOPE_POLICY_M_TOOL_PROXY_005
}

// START_CONTRACT: buildMcpToolResult
//   PURPOSE: Normalize upstream object response to MCP tool result envelope.
//   INPUTS: { upstreamResponse: Record<string, unknown> - Raw object response from upstream }
//   OUTPUTS: { McpToolResult - MCP-style result with text and structured content }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TOOL-PROXY]
// END_CONTRACT: buildMcpToolResult
function buildMcpToolResult(upstreamResponse: Record<string, unknown>): McpToolResult {
  // START_BLOCK_MAP_UPSTREAM_RESPONSE_TO_MCP_RESULT_M_TOOL_PROXY_006
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(upstreamResponse),
      },
    ],
    structuredContent: upstreamResponse,
  };
  // END_BLOCK_MAP_UPSTREAM_RESPONSE_TO_MCP_RESULT_M_TOOL_PROXY_006
}

// START_CONTRACT: createToolProxyService
//   PURPOSE: Create a bound proxy service with shared dependencies.
//   INPUTS: { config: AppConfig - Runtime configuration, logger: Logger - Module logger, client: TgChatRagClient - Upstream client }
//   OUTPUTS: { ToolProxyService - Service facade exposing executeTool }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TOOL-PROXY, M-CONFIG, M-LOGGER, M-TG-CHAT-RAG-CLIENT]
// END_CONTRACT: createToolProxyService
export function createToolProxyService(
  config: AppConfig,
  logger: Logger,
  client: TgChatRagClient,
): ToolProxyService {
  // START_BLOCK_CREATE_BOUND_PROXY_SERVICE_M_TOOL_PROXY_007
  return {
    executeTool: async (toolName: string, rawArgs: unknown) => {
      return executeTool(config, logger, client, toolName, rawArgs);
    },
  };
  // END_BLOCK_CREATE_BOUND_PROXY_SERVICE_M_TOOL_PROXY_007
}

// START_CONTRACT: executeTool
//   PURPOSE: Execute policy-safe tool proxy flow from input validation to upstream call and MCP response mapping.
//   INPUTS: { config: AppConfig - Runtime configuration, logger: Logger - Module logger, client: TgChatRagClient - Upstream client, toolName: string - Requested tool name, rawArgs: unknown - Untrusted input args }
//   OUTPUTS: { Promise<McpToolResult> - MCP-style tool execution result }
//   SIDE_EFFECTS: [Performs logging and upstream HTTP call through client]
//   LINKS: [M-TOOL-PROXY, M-CONFIG, M-TOOLS-CONTRACTS, M-TG-CHAT-RAG-CLIENT, M-LOGGER]
// END_CONTRACT: executeTool
export async function executeTool(
  config: AppConfig,
  logger: Logger,
  client: TgChatRagClient,
  toolName: string,
  rawArgs: unknown,
): Promise<McpToolResult> {
  // START_BLOCK_VALIDATE_ALLOWLIST_AND_INPUT_M_TOOL_PROXY_008
  const functionName = "executeTool";
  const startedAt = Date.now();
  const normalizedToolName = toolName.trim();

  logger.info(
    "Dispatching tool execution request.",
    functionName,
    "VALIDATE_ALLOWLIST_AND_INPUT",
    { toolName: normalizedToolName },
  );

  if (!isProxiedToolName(normalizedToolName)) {
    logger.warn(
      "Rejected unsupported tool request.",
      functionName,
      "VALIDATE_ALLOWLIST_AND_INPUT",
      { toolName: normalizedToolName, allowlist: [...PROXIED_TOOL_NAMES] },
    );
    throw new ProxyExecutionError(
      "UNSUPPORTED_TOOL",
      "Tool is not supported by proxy surface.",
      { toolName: normalizedToolName, allowlist: [...PROXIED_TOOL_NAMES] },
    );
  }
  // END_BLOCK_VALIDATE_ALLOWLIST_AND_INPUT_M_TOOL_PROXY_008

  // START_BLOCK_APPLY_POLICY_AFTER_VALIDATION_M_TOOL_PROXY_009
  const validatedArgs = validateAndMapInput(normalizedToolName, rawArgs, logger);
  const upstreamPayload = buildUpstreamPayloadWithPolicy(
    normalizedToolName,
    validatedArgs,
    config,
    logger,
  );
  // END_BLOCK_APPLY_POLICY_AFTER_VALIDATION_M_TOOL_PROXY_009

  // START_BLOCK_EXECUTE_UPSTREAM_AND_NORMALIZE_RESULT_M_TOOL_PROXY_010
  try {
    const upstreamResponse = await client.callMethod(normalizedToolName, upstreamPayload);
    const durationMs = Date.now() - startedAt;

    logger.info(
      "Tool execution completed successfully.",
      functionName,
      "EXECUTE_UPSTREAM_AND_NORMALIZE_RESULT",
      { toolName: normalizedToolName, durationMs },
    );

    const normalizedResult = buildMcpToolResult(upstreamResponse);
    return normalizedResult;
  } catch (error: unknown) {
    const durationMs = Date.now() - startedAt;

    if (error instanceof ProxyExecutionError) {
      throw error;
    }

    if (error instanceof UpstreamCallError) {
      logger.error(
        "Upstream call failed while executing tool.",
        functionName,
        "MAP_UPSTREAM_FAILURE_TO_PROXY_ERROR",
        {
          toolName: normalizedToolName,
          durationMs,
          upstreamCode: error.code,
          status: error.status,
        },
      );
      throw new ProxyExecutionError(
        "UPSTREAM_ERROR",
        "Upstream call failed during tool execution.",
        {
          toolName: normalizedToolName,
          durationMs,
          upstreamCode: error.code,
          status: error.status,
          upstreamDetails: error.details,
        },
      );
    }

    const detailMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      "Unexpected upstream failure while executing tool.",
      functionName,
      "MAP_UPSTREAM_FAILURE_TO_PROXY_ERROR",
      { toolName: normalizedToolName, durationMs, cause: detailMessage },
    );
    throw new ProxyExecutionError(
      "UPSTREAM_ERROR",
      "Upstream call failed during tool execution.",
      {
        toolName: normalizedToolName,
        durationMs,
        cause: detailMessage,
      },
    );
  }
  // END_BLOCK_EXECUTE_UPSTREAM_AND_NORMALIZE_RESULT_M_TOOL_PROXY_010
}
