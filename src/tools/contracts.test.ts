// FILE: src/tools/contracts.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify deterministic validation behavior and public tool surface for M-TOOLS-CONTRACTS.
//   SCOPE: Assert four-tool allowlist, schema metadata, forbidden filters.chat_ids behavior, and SchemaValidationError details.
//   DEPENDS: M-TOOLS-CONTRACTS
//   LINKS: M-TOOLS-CONTRACTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   assertSchemaValidationError - Assert thrown validation errors are typed as SchemaValidationError with stable detail payload.
//   ToolContractsTests - Deterministic contract tests for public tool schemas and validator dispatch.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Added focused Step 2/8 verification tests for M-TOOLS-CONTRACTS deterministic behavior.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import {
  PROXIED_TOOL_NAMES,
  SchemaValidationError,
  TOOL_INPUT_JSON_SCHEMAS,
  isProxiedToolName,
  validateGetMessageContextInput,
  validateGetRelatedMessagesInput,
  validateListSourcesInput,
  validateSearchMessagesInputPublic,
  validateToolInput,
  type ProxiedToolName,
} from "./contracts";

// START_CONTRACT: assertSchemaValidationError
//   PURPOSE: Assert a validator call throws SchemaValidationError with expected detail text.
//   INPUTS: { execute: () => unknown - Validation call expected to throw, expectedDetailSubstring: string - Stable detail fragment expected in error details }
//   OUTPUTS: { SchemaValidationError - Captured typed validation error instance }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-TOOLS-CONTRACTS]
// END_CONTRACT: assertSchemaValidationError
function assertSchemaValidationError(
  execute: () => unknown,
  expectedDetailSubstring: string,
): SchemaValidationError {
  // START_BLOCK_ASSERT_TYPED_SCHEMA_VALIDATION_ERROR_M_TOOLS_CONTRACTS_TEST_001
  let thrown: unknown;
  try {
    execute();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(SchemaValidationError);
  const schemaError = thrown as SchemaValidationError;
  expect(schemaError.code).toBe("SCHEMA_VALIDATION_ERROR");
  expect(
    schemaError.details.some((detail) => detail.includes(expectedDetailSubstring)),
  ).toBe(true);

  return schemaError;
  // END_BLOCK_ASSERT_TYPED_SCHEMA_VALIDATION_ERROR_M_TOOLS_CONTRACTS_TEST_001
}

describe("M-TOOLS-CONTRACTS deterministic tool contracts", () => {
  it("exports exactly four proxied tool names in stable order", () => {
    expect(PROXIED_TOOL_NAMES).toEqual([
      "search_messages",
      "get_message_context",
      "get_related_messages",
      "list_sources",
    ]);
    expect(PROXIED_TOOL_NAMES).toHaveLength(4);
  });

  it("keeps tool metadata aligned with the four-tool public surface", () => {
    const schemaKeys = Object.keys(TOOL_INPUT_JSON_SCHEMAS).sort();
    expect(schemaKeys).toEqual([
      "get_message_context",
      "get_related_messages",
      "list_sources",
      "search_messages",
    ]);
    expect(TOOL_INPUT_JSON_SCHEMAS.search_messages.x_forbidden_paths).toEqual([
      "filters.chat_ids",
    ]);
  });

  it("accepts known proxied tool names and rejects non-public names", () => {
    expect(isProxiedToolName("search_messages")).toBe(true);
    expect(isProxiedToolName("get_message_context")).toBe(true);
    expect(isProxiedToolName("get_related_messages")).toBe(true);
    expect(isProxiedToolName("list_sources")).toBe(true);
    expect(isProxiedToolName("list_chats")).toBe(false);
  });

  it("accepts search_messages payloads that do not include filters.chat_ids", () => {
    const input = {
      query: "tokyo coffee roasters",
      filters: {
        source: "telegram",
        nested: {
          tenant_id: "JP",
          tags: ["specialty", "sangenjaya"],
        },
      },
      top_k: 20,
    };

    expect(validateSearchMessagesInputPublic(input)).toEqual(input);
  });

  it("rejects search_messages payloads with nested filters.chat_ids", () => {
    assertSchemaValidationError(
      () =>
        validateSearchMessagesInputPublic({
          query: "osaka",
          filters: {
            nested: [
              {
                deeper: {
                  chat_ids: ["chat-1"],
                },
              },
            ],
          },
        }),
      "search_messages input forbids filters.chat_ids at the public boundary.",
    );
  });

  it("enforces deterministic message_uid validation for get_message_context", () => {
    expect(
      validateGetMessageContextInput({
        message_uid: "  msg-context-001  ",
        include_neighbors: true,
      }),
    ).toEqual({
      message_uid: "msg-context-001",
      include_neighbors: true,
    });

    assertSchemaValidationError(
      () => validateGetMessageContextInput({ message_uid: "   " }),
      "get_message_context requires non-empty string field message_uid.",
    );
  });

  it("enforces deterministic message_uid validation for get_related_messages", () => {
    assertSchemaValidationError(
      () => validateGetRelatedMessagesInput({ message_uid: "" }),
      "get_related_messages requires non-empty string field message_uid.",
    );
  });

  it("enforces deterministic array constraints for list_sources", () => {
    assertSchemaValidationError(
      () => validateListSourcesInput({ message_uids: [] }),
      "list_sources requires message_uids array with at least one message UID.",
    );

    assertSchemaValidationError(
      () => validateListSourcesInput({ message_uids: ["ok-id", ""] }),
      "list_sources requires each message_uids entry to be a non-empty string.",
    );

    const tooManyMessageUids = Array.from({ length: 101 }, (_, index) => `uid-${index + 1}`);
    assertSchemaValidationError(
      () => validateListSourcesInput({ message_uids: tooManyMessageUids }),
      "list_sources supports at most 100 message_uids per request.",
    );
  });

  it("throws SchemaValidationError for unsupported tool names in runtime dispatch guard", () => {
    const schemaError = assertSchemaValidationError(
      () => validateToolInput("unsupported_tool" as ProxiedToolName, {}),
      "Unsupported tool name: unsupported_tool",
    );
    expect(schemaError.details).toEqual(["Unsupported tool name: unsupported_tool"]);
  });
});
