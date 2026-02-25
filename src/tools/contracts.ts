// FILE: src/tools/contracts.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Define and export MCP tool schemas and tool allowlist for the proxy surface.
//   SCOPE: Provide input types, tool metadata schemas, and runtime validators for proxied MCP tool inputs.
//   DEPENDS: M-LOGGER
//   LINKS: M-TOOLS-CONTRACTS, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SearchMessagesInputPublic - Public search input schema that forbids filters.chat_ids.
//   GetMessageContextInput - Input shape for get_message_context tool.
//   GetRelatedMessagesInput - Input shape for get_related_messages tool.
//   ListSourcesInput - Input shape for list_sources tool.
//   ProxiedToolName - Union of supported proxied tool names.
//   PROXIED_TOOL_NAMES - Allowlist of proxied MCP tool names.
//   TOOL_INPUT_JSON_SCHEMAS - JSON-schema-like metadata for supported tool inputs.
//   SchemaValidationError - Typed validation error with SCHEMA_VALIDATION_ERROR code.
//   isProxiedToolName - Type guard for supported tool names.
//   validateSearchMessagesInputPublic - Validate search_messages public input boundary.
//   validateGetMessageContextInput - Validate get_message_context input.
//   validateGetRelatedMessagesInput - Validate get_related_messages input.
//   validateListSourcesInput - Validate list_sources input.
//   validateToolInput - Dispatch tool input validation by tool name.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation from development plan for M-TOOLS-CONTRACTS.
// END_CHANGE_SUMMARY

import type { Logger } from "../logger/index";

export interface SearchMessagesInputPublic {
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GetMessageContextInput {
  message_id: string;
  [key: string]: unknown;
}

export interface GetRelatedMessagesInput {
  message_id: string;
  [key: string]: unknown;
}

export type ListSourcesInput = Record<string, never>;

export const PROXIED_TOOL_NAMES = [
  "search_messages",
  "get_message_context",
  "get_related_messages",
  "list_sources",
] as const;

export type ProxiedToolName = (typeof PROXIED_TOOL_NAMES)[number];

type ToolInputSchema = {
  type: "object";
  description: string;
  required?: readonly string[];
  additionalProperties: boolean;
  properties?: Record<string, unknown>;
  x_forbidden_paths?: readonly string[];
};

export const TOOL_INPUT_JSON_SCHEMAS: Record<ProxiedToolName, ToolInputSchema> = {
  search_messages: {
    type: "object",
    description: "Public input for search_messages. filters.chat_ids is forbidden.",
    additionalProperties: true,
    properties: {
      query: { type: "string" },
      filters: { type: "object", additionalProperties: true },
    },
    x_forbidden_paths: ["filters.chat_ids"],
  },
  get_message_context: {
    type: "object",
    description: "Input for get_message_context. Requires message_id.",
    required: ["message_id"],
    additionalProperties: true,
    properties: {
      message_id: { type: "string", minLength: 1 },
    },
  },
  get_related_messages: {
    type: "object",
    description: "Input for get_related_messages. Requires message_id.",
    required: ["message_id"],
    additionalProperties: true,
    properties: {
      message_id: { type: "string", minLength: 1 },
    },
  },
  list_sources: {
    type: "object",
    description: "Input for list_sources. Only empty object is allowed.",
    additionalProperties: false,
    properties: {},
  },
};

export class SchemaValidationError extends Error {
  public readonly code = "SCHEMA_VALIDATION_ERROR" as const;
  public readonly details: string[];

  public constructor(details: string[]) {
    super(`Schema validation failed: ${details.join("; ")}`);
    this.name = "SchemaValidationError";
    this.details = details;
  }
}

// START_CONTRACT: isPlainObject
//   PURPOSE: Check whether a value is a plain object suitable for runtime input validation.
//   INPUTS: { value: unknown - Candidate input value }
//   OUTPUTS: { boolean - True when value is a non-null plain object }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TOOLS-CONTRACTS]
// END_CONTRACT: isPlainObject
function isPlainObject(value: unknown): value is Record<string, unknown> {
  // START_BLOCK_CHECK_PLAIN_OBJECT_SHAPE_M_TOOLS_CONTRACTS_001
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
  // END_BLOCK_CHECK_PLAIN_OBJECT_SHAPE_M_TOOLS_CONTRACTS_001
}

// START_CONTRACT: hasForbiddenChatIdsInFilters
//   PURPOSE: Detect forbidden chat_ids keys anywhere inside the filters subtree.
//   INPUTS: { filtersValue: unknown - filters subtree candidate }
//   OUTPUTS: { boolean - True when chat_ids key exists under filters }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TOOLS-CONTRACTS]
// END_CONTRACT: hasForbiddenChatIdsInFilters
function hasForbiddenChatIdsInFilters(filtersValue: unknown): boolean {
  // START_BLOCK_TRAVERSE_FILTERS_SUBTREE_FOR_CHAT_IDS_M_TOOLS_CONTRACTS_002
  const stack: unknown[] = [filtersValue];
  const seen = new Set<unknown>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || current === null) {
      continue;
    }
    if (typeof current !== "object") {
      continue;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

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
  // END_BLOCK_TRAVERSE_FILTERS_SUBTREE_FOR_CHAT_IDS_M_TOOLS_CONTRACTS_002
}

// START_CONTRACT: buildSchemaValidationError
//   PURPOSE: Build and throw typed schema validation errors with optional diagnostics logging.
//   INPUTS: { details: string[] - Validation error details, logger: Logger | undefined - Optional logger for diagnostics, functionName: string - Validation function name, blockName: string - Semantic block name }
//   OUTPUTS: { never - Always throws SchemaValidationError }
//   SIDE_EFFECTS: [May emit logger.warn diagnostics]
//   LINKS: [M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: buildSchemaValidationError
function buildSchemaValidationError(
  details: string[],
  logger: Logger | undefined,
  functionName: string,
  blockName: string,
): never {
  // START_BLOCK_EMIT_DIAGNOSTICS_AND_THROW_SCHEMA_ERROR_M_TOOLS_CONTRACTS_003
  if (logger) {
    logger.warn(
      "Schema validation failed.",
      functionName,
      blockName,
      { errorCode: "SCHEMA_VALIDATION_ERROR", details },
    );
  }
  throw new SchemaValidationError(details);
  // END_BLOCK_EMIT_DIAGNOSTICS_AND_THROW_SCHEMA_ERROR_M_TOOLS_CONTRACTS_003
}

// START_CONTRACT: assertPlainObjectInput
//   PURPOSE: Enforce plain object input requirement for tool argument validation.
//   INPUTS: { rawArgs: unknown - Untrusted tool args, toolName: string - Tool identifier for error context, logger: Logger | undefined - Optional diagnostics logger, functionName: string - Current function name, blockName: string - Current block name }
//   OUTPUTS: { Record<string, unknown> - Validated plain object input }
//   SIDE_EFFECTS: [Throws SchemaValidationError when input is not a plain object]
//   LINKS: [M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: assertPlainObjectInput
function assertPlainObjectInput(
  rawArgs: unknown,
  toolName: string,
  logger: Logger | undefined,
  functionName: string,
  blockName: string,
): Record<string, unknown> {
  // START_BLOCK_VALIDATE_ROOT_ARGUMENT_IS_PLAIN_OBJECT_M_TOOLS_CONTRACTS_004
  if (!isPlainObject(rawArgs)) {
    buildSchemaValidationError(
      [`${toolName} input must be a plain object.`],
      logger,
      functionName,
      blockName,
    );
  }
  return rawArgs;
  // END_BLOCK_VALIDATE_ROOT_ARGUMENT_IS_PLAIN_OBJECT_M_TOOLS_CONTRACTS_004
}

// START_CONTRACT: isProxiedToolName
//   PURPOSE: Validate tool name membership in proxy allowlist.
//   INPUTS: { value: string - Tool name candidate }
//   OUTPUTS: { boolean - True when value is a supported proxied tool name }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TOOLS-CONTRACTS]
// END_CONTRACT: isProxiedToolName
export function isProxiedToolName(value: string): value is ProxiedToolName {
  // START_BLOCK_MATCH_TOOL_NAME_AGAINST_ALLOWLIST_M_TOOLS_CONTRACTS_005
  return (PROXIED_TOOL_NAMES as readonly string[]).includes(value);
  // END_BLOCK_MATCH_TOOL_NAME_AGAINST_ALLOWLIST_M_TOOLS_CONTRACTS_005
}

// START_CONTRACT: validateSearchMessagesInputPublic
//   PURPOSE: Validate public search_messages input and forbid filters.chat_ids at any depth.
//   INPUTS: { rawArgs: unknown - Untrusted tool args, logger: Logger | undefined - Optional diagnostics logger }
//   OUTPUTS: { SearchMessagesInputPublic - Validated public search_messages input }
//   SIDE_EFFECTS: [Throws SchemaValidationError on validation failures]
//   LINKS: [M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: validateSearchMessagesInputPublic
export function validateSearchMessagesInputPublic(
  rawArgs: unknown,
  logger?: Logger,
): SearchMessagesInputPublic {
  // START_BLOCK_VALIDATE_SEARCH_MESSAGES_ROOT_OBJECT_M_TOOLS_CONTRACTS_006
  const args = assertPlainObjectInput(
    rawArgs,
    "search_messages",
    logger,
    "validateSearchMessagesInputPublic",
    "VALIDATE_SEARCH_MESSAGES_ROOT_OBJECT",
  );
  // END_BLOCK_VALIDATE_SEARCH_MESSAGES_ROOT_OBJECT_M_TOOLS_CONTRACTS_006

  // START_BLOCK_ENFORCE_FORBIDDEN_SEARCH_FILTERS_CHAT_IDS_M_TOOLS_CONTRACTS_007
  if (Object.prototype.hasOwnProperty.call(args, "filters")) {
    const filtersValue = args["filters"];
    if (hasForbiddenChatIdsInFilters(filtersValue)) {
      buildSchemaValidationError(
        ["search_messages input forbids filters.chat_ids at the public boundary."],
        logger,
        "validateSearchMessagesInputPublic",
        "ENFORCE_FORBIDDEN_SEARCH_FILTERS_CHAT_IDS",
      );
    }
  }
  // END_BLOCK_ENFORCE_FORBIDDEN_SEARCH_FILTERS_CHAT_IDS_M_TOOLS_CONTRACTS_007

  // START_BLOCK_RETURN_SEARCH_MESSAGES_VALIDATED_INPUT_M_TOOLS_CONTRACTS_008
  return { ...args };
  // END_BLOCK_RETURN_SEARCH_MESSAGES_VALIDATED_INPUT_M_TOOLS_CONTRACTS_008
}

// START_CONTRACT: validateGetMessageContextInput
//   PURPOSE: Validate get_message_context input and require non-empty message_id.
//   INPUTS: { rawArgs: unknown - Untrusted tool args, logger: Logger | undefined - Optional diagnostics logger }
//   OUTPUTS: { GetMessageContextInput - Validated get_message_context input }
//   SIDE_EFFECTS: [Throws SchemaValidationError on validation failures]
//   LINKS: [M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: validateGetMessageContextInput
export function validateGetMessageContextInput(
  rawArgs: unknown,
  logger?: Logger,
): GetMessageContextInput {
  // START_BLOCK_VALIDATE_MESSAGE_CONTEXT_ROOT_OBJECT_M_TOOLS_CONTRACTS_009
  const args = assertPlainObjectInput(
    rawArgs,
    "get_message_context",
    logger,
    "validateGetMessageContextInput",
    "VALIDATE_MESSAGE_CONTEXT_ROOT_OBJECT",
  );
  // END_BLOCK_VALIDATE_MESSAGE_CONTEXT_ROOT_OBJECT_M_TOOLS_CONTRACTS_009

  // START_BLOCK_VALIDATE_REQUIRED_MESSAGE_ID_FOR_CONTEXT_M_TOOLS_CONTRACTS_010
  const messageId = typeof args["message_id"] === "string" ? args["message_id"].trim() : "";
  if (!messageId) {
    buildSchemaValidationError(
      ["get_message_context requires non-empty string field message_id."],
      logger,
      "validateGetMessageContextInput",
      "VALIDATE_REQUIRED_MESSAGE_ID_FOR_CONTEXT",
    );
  }
  // END_BLOCK_VALIDATE_REQUIRED_MESSAGE_ID_FOR_CONTEXT_M_TOOLS_CONTRACTS_010

  // START_BLOCK_RETURN_MESSAGE_CONTEXT_VALIDATED_INPUT_M_TOOLS_CONTRACTS_011
  return { ...args, message_id: messageId };
  // END_BLOCK_RETURN_MESSAGE_CONTEXT_VALIDATED_INPUT_M_TOOLS_CONTRACTS_011
}

// START_CONTRACT: validateGetRelatedMessagesInput
//   PURPOSE: Validate get_related_messages input and require non-empty message_id.
//   INPUTS: { rawArgs: unknown - Untrusted tool args, logger: Logger | undefined - Optional diagnostics logger }
//   OUTPUTS: { GetRelatedMessagesInput - Validated get_related_messages input }
//   SIDE_EFFECTS: [Throws SchemaValidationError on validation failures]
//   LINKS: [M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: validateGetRelatedMessagesInput
export function validateGetRelatedMessagesInput(
  rawArgs: unknown,
  logger?: Logger,
): GetRelatedMessagesInput {
  // START_BLOCK_VALIDATE_RELATED_MESSAGES_ROOT_OBJECT_M_TOOLS_CONTRACTS_012
  const args = assertPlainObjectInput(
    rawArgs,
    "get_related_messages",
    logger,
    "validateGetRelatedMessagesInput",
    "VALIDATE_RELATED_MESSAGES_ROOT_OBJECT",
  );
  // END_BLOCK_VALIDATE_RELATED_MESSAGES_ROOT_OBJECT_M_TOOLS_CONTRACTS_012

  // START_BLOCK_VALIDATE_REQUIRED_MESSAGE_ID_FOR_RELATED_M_TOOLS_CONTRACTS_013
  const messageId = typeof args["message_id"] === "string" ? args["message_id"].trim() : "";
  if (!messageId) {
    buildSchemaValidationError(
      ["get_related_messages requires non-empty string field message_id."],
      logger,
      "validateGetRelatedMessagesInput",
      "VALIDATE_REQUIRED_MESSAGE_ID_FOR_RELATED",
    );
  }
  // END_BLOCK_VALIDATE_REQUIRED_MESSAGE_ID_FOR_RELATED_M_TOOLS_CONTRACTS_013

  // START_BLOCK_RETURN_RELATED_MESSAGES_VALIDATED_INPUT_M_TOOLS_CONTRACTS_014
  return { ...args, message_id: messageId };
  // END_BLOCK_RETURN_RELATED_MESSAGES_VALIDATED_INPUT_M_TOOLS_CONTRACTS_014
}

// START_CONTRACT: validateListSourcesInput
//   PURPOSE: Validate list_sources input allowing only empty object or undefined normalized to empty object.
//   INPUTS: { rawArgs: unknown - Untrusted tool args, logger: Logger | undefined - Optional diagnostics logger }
//   OUTPUTS: { ListSourcesInput - Normalized empty object input }
//   SIDE_EFFECTS: [Throws SchemaValidationError on validation failures]
//   LINKS: [M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: validateListSourcesInput
export function validateListSourcesInput(rawArgs: unknown, logger?: Logger): ListSourcesInput {
  // START_BLOCK_NORMALIZE_LIST_SOURCES_UNDEFINED_INPUT_M_TOOLS_CONTRACTS_015
  if (rawArgs === undefined) {
    return {};
  }
  // END_BLOCK_NORMALIZE_LIST_SOURCES_UNDEFINED_INPUT_M_TOOLS_CONTRACTS_015

  // START_BLOCK_VALIDATE_LIST_SOURCES_EMPTY_OBJECT_ONLY_M_TOOLS_CONTRACTS_016
  const args = assertPlainObjectInput(
    rawArgs,
    "list_sources",
    logger,
    "validateListSourcesInput",
    "VALIDATE_LIST_SOURCES_EMPTY_OBJECT_ONLY",
  );
  if (Object.keys(args).length > 0) {
    buildSchemaValidationError(
      ["list_sources allows only an empty object input."],
      logger,
      "validateListSourcesInput",
      "VALIDATE_LIST_SOURCES_EMPTY_OBJECT_ONLY",
    );
  }
  // END_BLOCK_VALIDATE_LIST_SOURCES_EMPTY_OBJECT_ONLY_M_TOOLS_CONTRACTS_016

  // START_BLOCK_RETURN_LIST_SOURCES_NORMALIZED_OBJECT_M_TOOLS_CONTRACTS_017
  return {};
  // END_BLOCK_RETURN_LIST_SOURCES_NORMALIZED_OBJECT_M_TOOLS_CONTRACTS_017
}

// START_CONTRACT: validateToolInput
//   PURPOSE: Route tool arguments to the corresponding validator for supported proxied tools.
//   INPUTS: { toolName: ProxiedToolName - Supported tool name, rawArgs: unknown - Untrusted tool args, logger: Logger | undefined - Optional diagnostics logger }
//   OUTPUTS: { SearchMessagesInputPublic | GetMessageContextInput | GetRelatedMessagesInput | ListSourcesInput - Validated tool input }
//   SIDE_EFFECTS: [Throws SchemaValidationError on validation failures]
//   LINKS: [M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: validateToolInput
export function validateToolInput(
  toolName: ProxiedToolName,
  rawArgs: unknown,
  logger?: Logger,
):
  | SearchMessagesInputPublic
  | GetMessageContextInput
  | GetRelatedMessagesInput
  | ListSourcesInput {
  // START_BLOCK_DISPATCH_TOOL_INPUT_VALIDATION_BY_TOOL_NAME_M_TOOLS_CONTRACTS_018
  switch (toolName) {
    case "search_messages":
      return validateSearchMessagesInputPublic(rawArgs, logger);
    case "get_message_context":
      return validateGetMessageContextInput(rawArgs, logger);
    case "get_related_messages":
      return validateGetRelatedMessagesInput(rawArgs, logger);
    case "list_sources":
      return validateListSourcesInput(rawArgs, logger);
    default:
      buildSchemaValidationError(
        [`Unsupported tool name: ${String(toolName)}`],
        logger,
        "validateToolInput",
        "DISPATCH_TOOL_INPUT_VALIDATION_BY_TOOL_NAME",
      );
  }
  // END_BLOCK_DISPATCH_TOOL_INPUT_VALIDATION_BY_TOOL_NAME_M_TOOLS_CONTRACTS_018
}
