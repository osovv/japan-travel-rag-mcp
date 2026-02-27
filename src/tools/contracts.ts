// FILE: src/tools/contracts.ts
// VERSION: 1.4.1
// START_MODULE_CONTRACT
//   PURPOSE: Define and export MCP tool schemas and tool allowlist for the proxy surface.
//   SCOPE: Provide input types, tool metadata schemas, and zod-based runtime validators for proxied MCP tool inputs.
//   DEPENDS: M-LOGGER
//   LINKS: M-TOOLS-CONTRACTS, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SearchFiltersInputPublic - Strict public filters schema for search_messages (chat_ids forbidden).
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
//   LAST_CHANGE: v1.4.1 - Aligned list_sources JSON metadata with strict validator behavior and clarified search_messages validation contract wording.
//   PREVIOUS: v1.4.0 - Rebased all public tool schemas to strict parameter contracts (wren-chat parity) with explicit fields/defaults and hard rejection of unknown keys/types.
// END_CHANGE_SUMMARY

import { z } from "zod";
import type { Logger } from "../logger/index";

export const PROXIED_TOOL_NAMES = [
  "search_messages",
  "get_message_context",
  "get_related_messages",
  "list_sources",
] as const;

export type ProxiedToolName = (typeof PROXIED_TOOL_NAMES)[number];

const SEARCH_MESSAGES_FORBIDDEN_CHAT_IDS_ERROR =
  "search_messages input forbids filters.chat_ids at the public boundary.";
const SEARCH_MESSAGES_QUERY_REQUIRED_ERROR =
  "search_messages requires non-empty string field query.";
const SEARCH_MESSAGES_TOP_K_MIN_ERROR =
  "search_messages top_k must be an integer between 1 and 100.";
const SEARCH_MESSAGES_TOP_K_MAX_ERROR =
  "search_messages top_k must be an integer between 1 and 100.";
const GET_MESSAGE_CONTEXT_MESSAGE_UID_REQUIRED_ERROR =
  "get_message_context requires non-empty string field message_uid.";
const GET_MESSAGE_CONTEXT_BEFORE_RANGE_ERROR =
  "get_message_context before must be an integer between 0 and 50.";
const GET_MESSAGE_CONTEXT_AFTER_RANGE_ERROR =
  "get_message_context after must be an integer between 0 and 50.";
const GET_RELATED_MESSAGES_MESSAGE_UID_REQUIRED_ERROR =
  "get_related_messages requires non-empty string field message_uid.";
const GET_RELATED_MESSAGES_TOP_K_MIN_ERROR =
  "get_related_messages top_k must be an integer between 1 and 50.";
const GET_RELATED_MESSAGES_TOP_K_MAX_ERROR =
  "get_related_messages top_k must be an integer between 1 and 50.";
const LIST_SOURCES_MESSAGE_UID_ENTRY_REQUIRED_ERROR =
  "list_sources requires each message_uids entry to be a non-empty string.";
const LIST_SOURCES_MESSAGE_UIDS_MIN_ERROR =
  "list_sources requires message_uids array with at least one message UID.";
const LIST_SOURCES_MESSAGE_UIDS_MAX_ERROR =
  "list_sources supports at most 100 message_uids per request.";

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
    description:
      "Public input for search_messages. Caller may provide query and filters, but filters.chat_ids is forbidden and injected internally.",
    required: ["query"],
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        description: "Search query text sent to upstream semantic retrieval.",
      },
      top_k: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Maximum number of results to return (1-100, default 10).",
      },
      filters: {
        type: "object",
        additionalProperties: false,
        description:
          "Optional strict search filters. filters.chat_ids is explicitly forbidden at public boundary.",
        properties: {
          date_from: {
            type: "string",
            format: "date-time",
          },
          date_to: {
            type: "string",
            format: "date-time",
          },
          authors: {
            type: "array",
            items: {
              type: "string",
              minLength: 1,
            },
          },
          has_media: {
            type: "boolean",
          },
        },
      },
    },
    x_forbidden_paths: ["filters.chat_ids"],
  },
  get_message_context: {
    type: "object",
    description:
      "Input for get_message_context. Requires a non-empty message_uid identifying the anchor message.",
    required: ["message_uid"],
    additionalProperties: false,
    properties: {
      message_uid: {
        type: "string",
        minLength: 1,
        description: "Unique message identifier used to fetch context window.",
      },
      before: {
        type: "integer",
        minimum: 0,
        maximum: 50,
      },
      after: {
        type: "integer",
        minimum: 0,
        maximum: 50,
      },
    },
  },
  get_related_messages: {
    type: "object",
    description:
      "Input for get_related_messages. Requires a non-empty message_uid used as relation anchor.",
    required: ["message_uid"],
    additionalProperties: false,
    properties: {
      message_uid: {
        type: "string",
        minLength: 1,
        description: "Unique message identifier used to retrieve semantically related messages.",
      },
      top_k: {
        type: "integer",
        minimum: 1,
        maximum: 50,
      },
    },
  },
  list_sources: {
    type: "object",
    description:
      "Input for list_sources. Requires bounded message_uids array to resolve source provenance for each message.",
    additionalProperties: false,
    properties: {
      message_uids: {
        type: "array",
        description: "List of message UIDs to resolve source records for.",
        items: {
          type: "string",
          minLength: 1,
          description: "Single message UID entry.",
        },
        minItems: 1,
        maxItems: 100,
      },
    },
    required: ["message_uids"],
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

export const SearchFiltersInputPublicSchema = z
  .object({
    date_from: z.string().datetime().optional(),
    date_to: z.string().datetime().optional(),
    authors: z.array(z.string().trim().min(1)).optional(),
    has_media: z.boolean().optional(),
    chat_ids: z.any().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.prototype.hasOwnProperty.call(value, "chat_ids")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: SEARCH_MESSAGES_FORBIDDEN_CHAT_IDS_ERROR,
        path: ["chat_ids"],
      });
    }
  });

export const SearchMessagesInputPublicSchema = z
  .object({
    query: z.string().trim().min(1, SEARCH_MESSAGES_QUERY_REQUIRED_ERROR),
    top_k: z
      .number()
      .int()
      .min(1, SEARCH_MESSAGES_TOP_K_MIN_ERROR)
      .max(100, SEARCH_MESSAGES_TOP_K_MAX_ERROR)
      .default(10),
    filters: SearchFiltersInputPublicSchema.optional(),
  })
  .strict();

export const GetMessageContextInputSchema = z
  .object({
    message_uid: z
      .string()
      .trim()
      .min(1, GET_MESSAGE_CONTEXT_MESSAGE_UID_REQUIRED_ERROR),
    before: z
      .number()
      .int()
      .min(0, GET_MESSAGE_CONTEXT_BEFORE_RANGE_ERROR)
      .max(50, GET_MESSAGE_CONTEXT_BEFORE_RANGE_ERROR)
      .default(5),
    after: z
      .number()
      .int()
      .min(0, GET_MESSAGE_CONTEXT_AFTER_RANGE_ERROR)
      .max(50, GET_MESSAGE_CONTEXT_AFTER_RANGE_ERROR)
      .default(5),
  })
  .strict();

export const GetRelatedMessagesInputSchema = z
  .object({
    message_uid: z
      .string()
      .trim()
      .min(1, GET_RELATED_MESSAGES_MESSAGE_UID_REQUIRED_ERROR),
    top_k: z
      .number()
      .int()
      .min(1, GET_RELATED_MESSAGES_TOP_K_MIN_ERROR)
      .max(50, GET_RELATED_MESSAGES_TOP_K_MAX_ERROR)
      .default(5),
  })
  .strict();

export const ListSourcesInputSchema = z
  .object({
    message_uids: z
      .array(z.string().trim().min(1, LIST_SOURCES_MESSAGE_UID_ENTRY_REQUIRED_ERROR))
      .min(1, LIST_SOURCES_MESSAGE_UIDS_MIN_ERROR)
      .max(100, LIST_SOURCES_MESSAGE_UIDS_MAX_ERROR),
  })
  .strict();

export type SearchMessagesInputPublic = z.infer<typeof SearchMessagesInputPublicSchema>;
export type GetMessageContextInput = z.infer<typeof GetMessageContextInputSchema>;
export type GetRelatedMessagesInput = z.infer<typeof GetRelatedMessagesInputSchema>;
export type ListSourcesInput = z.infer<typeof ListSourcesInputSchema>;

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
  // START_BLOCK_EMIT_DIAGNOSTICS_AND_THROW_SCHEMA_ERROR_M_TOOLS_CONTRACTS_002
  if (logger) {
    logger.warn(
      "Schema validation failed.",
      functionName,
      blockName,
      { errorCode: "SCHEMA_VALIDATION_ERROR", details },
    );
  }
  throw new SchemaValidationError(details);
  // END_BLOCK_EMIT_DIAGNOSTICS_AND_THROW_SCHEMA_ERROR_M_TOOLS_CONTRACTS_002
}

// START_CONTRACT: formatZodIssues
//   PURPOSE: Convert zod issues into stable human-readable validation detail strings.
//   INPUTS: { toolName: string - Tool identifier for fallback text, error: z.ZodError - Zod parse error }
//   OUTPUTS: { string[] - Normalized validation detail lines }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TOOLS-CONTRACTS]
// END_CONTRACT: formatZodIssues
function formatZodIssues(toolName: string, error: z.ZodError): string[] {
  // START_BLOCK_FORMAT_ZOD_ISSUES_TO_DETAILS_M_TOOLS_CONTRACTS_003
  if (error.issues.length === 0) {
    return [`${toolName} input is invalid.`];
  }

  return error.issues.map((issue) => {
    const pathPrefix =
      issue.path.length > 0 ? `${issue.path.map((segment) => String(segment)).join(".")}: ` : "";
    return `${pathPrefix}${issue.message}`;
  });
  // END_BLOCK_FORMAT_ZOD_ISSUES_TO_DETAILS_M_TOOLS_CONTRACTS_003
}

// START_CONTRACT: parseWithSchema
//   PURPOSE: Parse raw args with a zod schema and map parse failures to SchemaValidationError.
//   INPUTS: { rawArgs: unknown - Untrusted tool args, schema: z.ZodType<T> - Target zod schema, toolName: string - Tool identifier, logger: Logger | undefined - Optional diagnostics logger, functionName: string - Current function, blockName: string - Semantic block name }
//   OUTPUTS: { T - Parsed and validated tool arguments }
//   SIDE_EFFECTS: [Throws SchemaValidationError on parse failures]
//   LINKS: [M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: parseWithSchema
function parseWithSchema<T>(
  rawArgs: unknown,
  schema: z.ZodType<T>,
  toolName: string,
  logger: Logger | undefined,
  functionName: string,
  blockName: string,
): T {
  // START_BLOCK_PARSE_INPUT_WITH_ZOD_SCHEMA_M_TOOLS_CONTRACTS_004
  const parsed = schema.safeParse(rawArgs);
  if (!parsed.success) {
    buildSchemaValidationError(
      formatZodIssues(toolName, parsed.error),
      logger,
      functionName,
      blockName,
    );
  }
  return parsed.data;
  // END_BLOCK_PARSE_INPUT_WITH_ZOD_SCHEMA_M_TOOLS_CONTRACTS_004
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
//   PURPOSE: Validate strict public search_messages input and forbid caller-provided filters.chat_ids.
//   INPUTS: { rawArgs: unknown - Untrusted tool args, logger: Logger | undefined - Optional diagnostics logger }
//   OUTPUTS: { SearchMessagesInputPublic - Validated public search_messages input }
//   SIDE_EFFECTS: [Throws SchemaValidationError on validation failures]
//   LINKS: [M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: validateSearchMessagesInputPublic
export function validateSearchMessagesInputPublic(
  rawArgs: unknown,
  logger?: Logger,
): SearchMessagesInputPublic {
  // START_BLOCK_VALIDATE_SEARCH_MESSAGES_INPUT_WITH_ZOD_M_TOOLS_CONTRACTS_006
  return parseWithSchema(
    rawArgs,
    SearchMessagesInputPublicSchema,
    "search_messages",
    logger,
    "validateSearchMessagesInputPublic",
    "VALIDATE_SEARCH_MESSAGES_INPUT_WITH_ZOD",
  );
  // END_BLOCK_VALIDATE_SEARCH_MESSAGES_INPUT_WITH_ZOD_M_TOOLS_CONTRACTS_006
}

// START_CONTRACT: validateGetMessageContextInput
//   PURPOSE: Validate get_message_context input and require non-empty message_uid.
//   INPUTS: { rawArgs: unknown - Untrusted tool args, logger: Logger | undefined - Optional diagnostics logger }
//   OUTPUTS: { GetMessageContextInput - Validated get_message_context input }
//   SIDE_EFFECTS: [Throws SchemaValidationError on validation failures]
//   LINKS: [M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: validateGetMessageContextInput
export function validateGetMessageContextInput(
  rawArgs: unknown,
  logger?: Logger,
): GetMessageContextInput {
  // START_BLOCK_VALIDATE_GET_MESSAGE_CONTEXT_INPUT_WITH_ZOD_M_TOOLS_CONTRACTS_007
  return parseWithSchema(
    rawArgs,
    GetMessageContextInputSchema,
    "get_message_context",
    logger,
    "validateGetMessageContextInput",
    "VALIDATE_GET_MESSAGE_CONTEXT_INPUT_WITH_ZOD",
  );
  // END_BLOCK_VALIDATE_GET_MESSAGE_CONTEXT_INPUT_WITH_ZOD_M_TOOLS_CONTRACTS_007
}

// START_CONTRACT: validateGetRelatedMessagesInput
//   PURPOSE: Validate get_related_messages input and require non-empty message_uid.
//   INPUTS: { rawArgs: unknown - Untrusted tool args, logger: Logger | undefined - Optional diagnostics logger }
//   OUTPUTS: { GetRelatedMessagesInput - Validated get_related_messages input }
//   SIDE_EFFECTS: [Throws SchemaValidationError on validation failures]
//   LINKS: [M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: validateGetRelatedMessagesInput
export function validateGetRelatedMessagesInput(
  rawArgs: unknown,
  logger?: Logger,
): GetRelatedMessagesInput {
  // START_BLOCK_VALIDATE_GET_RELATED_MESSAGES_INPUT_WITH_ZOD_M_TOOLS_CONTRACTS_008
  return parseWithSchema(
    rawArgs,
    GetRelatedMessagesInputSchema,
    "get_related_messages",
    logger,
    "validateGetRelatedMessagesInput",
    "VALIDATE_GET_RELATED_MESSAGES_INPUT_WITH_ZOD",
  );
  // END_BLOCK_VALIDATE_GET_RELATED_MESSAGES_INPUT_WITH_ZOD_M_TOOLS_CONTRACTS_008
}

// START_CONTRACT: validateListSourcesInput
//   PURPOSE: Validate list_sources input requiring message_uids array.
//   INPUTS: { rawArgs: unknown - Untrusted tool args, logger: Logger | undefined - Optional diagnostics logger }
//   OUTPUTS: { ListSourcesInput - Validated list_sources input with message_uids }
//   SIDE_EFFECTS: [Throws SchemaValidationError on validation failures]
//   LINKS: [M-TOOLS-CONTRACTS, M-LOGGER]
// END_CONTRACT: validateListSourcesInput
export function validateListSourcesInput(rawArgs: unknown, logger?: Logger): ListSourcesInput {
  // START_BLOCK_VALIDATE_LIST_SOURCES_INPUT_WITH_ZOD_M_TOOLS_CONTRACTS_009
  return parseWithSchema(
    rawArgs,
    ListSourcesInputSchema,
    "list_sources",
    logger,
    "validateListSourcesInput",
    "VALIDATE_LIST_SOURCES_INPUT_WITH_ZOD",
  );
  // END_BLOCK_VALIDATE_LIST_SOURCES_INPUT_WITH_ZOD_M_TOOLS_CONTRACTS_009
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
  // START_BLOCK_DISPATCH_TOOL_INPUT_VALIDATION_BY_TOOL_NAME_M_TOOLS_CONTRACTS_010
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
  // END_BLOCK_DISPATCH_TOOL_INPUT_VALIDATION_BY_TOOL_NAME_M_TOOLS_CONTRACTS_010
}
