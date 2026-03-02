// FILE: src/tools/contracts.test.ts
// VERSION: 1.3.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify deterministic validation behavior and public tool surface for M-TOOLS-CONTRACTS.
//   SCOPE: Assert four-tool proxied allowlist, two-tool local registry, schema metadata, forbidden filters.chat_ids behavior, and SchemaValidationError details.
//   DEPENDS: M-TOOLS-CONTRACTS
//   LINKS: M-TOOLS-CONTRACTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   assertSchemaValidationError - Assert thrown validation errors are typed as SchemaValidationError with stable detail payload.
//   ToolContractsTests - Deterministic contract tests for public tool schemas and validator dispatch.
//   LocalToolContractsTests - Deterministic contract tests for local tool schemas (search_sites, get_page_chunk).
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.3.0 - Added comprehensive tests for search_sites and get_page_chunk local tool schemas, LOCAL_TOOL_INPUT_JSON_SCHEMAS, isLocalToolName, and validator functions.
//   PREVIOUS: v1.2.1 - Added strict metadata assertion for list_sources additionalProperties=false to keep JSON schema hints aligned with runtime validators.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import {
  LOCAL_TOOL_INPUT_JSON_SCHEMAS,
  LOCAL_TOOL_NAMES,
  PROXIED_TOOL_NAMES,
  SchemaValidationError,
  TOOL_INPUT_JSON_SCHEMAS,
  isLocalToolName,
  isProxiedToolName,
  validateGetMessageContextInput,
  validateGetPageChunkInput,
  validateGetRelatedMessagesInput,
  validateListSourcesInput,
  validateSearchMessagesInputPublic,
  validateSearchSitesInput,
  validateToolInput,
  type LocalToolName,
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
    expect(TOOL_INPUT_JSON_SCHEMAS.list_sources.additionalProperties).toBe(false);
  });

  it("accepts known proxied tool names and rejects non-public names", () => {
    expect(isProxiedToolName("search_messages")).toBe(true);
    expect(isProxiedToolName("get_message_context")).toBe(true);
    expect(isProxiedToolName("get_related_messages")).toBe(true);
    expect(isProxiedToolName("list_sources")).toBe(true);
    expect(isProxiedToolName("list_chats")).toBe(false);
  });

  it("accepts search_messages payloads that satisfy strict field contracts", () => {
    const input = {
      query: "tokyo coffee roasters",
      country_code: "JP",
      top_k: 20,
      filters: {
        date_from: "2026-01-01T00:00:00.000Z",
        date_to: "2026-01-31T23:59:59.000Z",
        authors: ["alice", "bob"],
        has_media: true,
      },
    };

    expect(validateSearchMessagesInputPublic(input)).toEqual(input);
  });

  it("fills search_messages top_k default when omitted", () => {
    expect(
      validateSearchMessagesInputPublic({
        query: "kyoto breakfast",
        country_code: "JP",
      }),
    ).toEqual({
      query: "kyoto breakfast",
      country_code: "JP",
      top_k: 10,
    });
  });

  it("rejects search_messages payloads when filters.chat_ids is provided", () => {
    assertSchemaValidationError(
      () =>
        validateSearchMessagesInputPublic({
          query: "osaka",
          country_code: "JP",
          top_k: 5,
          filters: {
            chat_ids: ["chat-1"],
          },
        }),
      "search_messages input forbids filters.chat_ids at the public boundary.",
    );
  });

  it("rejects search_messages payloads when filters is not an object", () => {
    assertSchemaValidationError(
      () =>
        validateSearchMessagesInputPublic({
          query: "sapporo ramen",
          country_code: "JP",
          filters: 123,
        }),
      "filters",
    );
  });

  it("rejects search_messages payloads when unknown top-level keys are provided", () => {
    assertSchemaValidationError(
      () =>
        validateSearchMessagesInputPublic({
          query: "nara",
          country_code: "JP",
          top_k: 3,
          unknown_flag: true,
        }),
      "Unrecognized key",
    );
  });

  it("enforces deterministic message_uid validation for get_message_context", () => {
    expect(
      validateGetMessageContextInput({
        message_uid: "  msg-context-001  ",
      }),
    ).toEqual({
      message_uid: "msg-context-001",
      before: 5,
      after: 5,
    });

    assertSchemaValidationError(
      () => validateGetMessageContextInput({ message_uid: "   " }),
      "get_message_context requires non-empty string field message_uid.",
    );
  });

  it("enforces deterministic message_uid validation for get_related_messages", () => {
    expect(
      validateGetRelatedMessagesInput({
        message_uid: "msg-related-001",
      }),
    ).toEqual({
      message_uid: "msg-related-001",
      top_k: 5,
    });

    assertSchemaValidationError(
      () => validateGetRelatedMessagesInput({ message_uid: "" }),
      "get_related_messages requires non-empty string field message_uid.",
    );
  });

  it("enforces deterministic array constraints for list_sources", () => {
    assertSchemaValidationError(
      () => validateListSourcesInput({ message_uids: [], country_code: "JP" }),
      "list_sources requires message_uids array with at least one message UID.",
    );

    assertSchemaValidationError(
      () => validateListSourcesInput({ message_uids: ["ok-id", ""], country_code: "JP" }),
      "list_sources requires each message_uids entry to be a non-empty string.",
    );

    const tooManyMessageUids = Array.from({ length: 101 }, (_, index) => `uid-${index + 1}`);
    assertSchemaValidationError(
      () => validateListSourcesInput({ message_uids: tooManyMessageUids, country_code: "JP" }),
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

describe("M-TOOLS-CONTRACTS local tool contracts", () => {
  it("exports exactly two local tool names in stable order", () => {
    expect(LOCAL_TOOL_NAMES).toEqual(["search_sites", "get_page_chunk"]);
    expect(LOCAL_TOOL_NAMES).toHaveLength(2);
  });

  it("keeps local tool metadata aligned with the two-tool local surface", () => {
    const schemaKeys = Object.keys(LOCAL_TOOL_INPUT_JSON_SCHEMAS).sort();
    expect(schemaKeys).toEqual(["get_page_chunk", "search_sites"]);
    expect(LOCAL_TOOL_INPUT_JSON_SCHEMAS.search_sites.additionalProperties).toBe(false);
    expect(LOCAL_TOOL_INPUT_JSON_SCHEMAS.search_sites.required).toEqual(["query", "country_code"]);
    expect(LOCAL_TOOL_INPUT_JSON_SCHEMAS.get_page_chunk.additionalProperties).toBe(false);
    expect(LOCAL_TOOL_INPUT_JSON_SCHEMAS.get_page_chunk.required).toEqual(["chunk_id"]);
  });

  it("accepts known local tool names and rejects non-local names", () => {
    expect(isLocalToolName("search_sites")).toBe(true);
    expect(isLocalToolName("get_page_chunk")).toBe(true);
    expect(isLocalToolName("search_messages")).toBe(false);
    expect(isLocalToolName("unknown_tool")).toBe(false);
  });

  it("does not include local tool names in PROXIED_TOOL_NAMES", () => {
    expect(isProxiedToolName("search_sites")).toBe(false);
    expect(isProxiedToolName("get_page_chunk")).toBe(false);
  });

  // --- search_sites ---

  it("accepts search_sites payloads with all fields", () => {
    const input = {
      query: "best ramen in tokyo",
      country_code: "JP",
      top_k: 15,
      source_ids: ["src-001", "src-002"],
    };
    expect(validateSearchSitesInput(input)).toEqual(input);
  });

  it("fills search_sites top_k default when omitted", () => {
    expect(
      validateSearchSitesInput({ query: "onsen guide", country_code: "JP" }),
    ).toEqual({
      query: "onsen guide",
      country_code: "JP",
      top_k: 10,
    });
  });

  it("accepts search_sites with source_ids omitted", () => {
    const result = validateSearchSitesInput({ query: "shinkansen tips", country_code: "JP", top_k: 5 });
    expect(result).toEqual({ query: "shinkansen tips", country_code: "JP", top_k: 5 });
  });

  it("accepts search_sites with empty source_ids array", () => {
    const result = validateSearchSitesInput({
      query: "kyoto temples",
      country_code: "JP",
      source_ids: [],
    });
    expect(result).toEqual({
      query: "kyoto temples",
      country_code: "JP",
      top_k: 10,
      source_ids: [],
    });
  });

  it("trims search_sites query whitespace", () => {
    const result = validateSearchSitesInput({ query: "  sushi etiquette  ", country_code: "JP" });
    expect(result.query).toBe("sushi etiquette");
  });

  it("trims search_sites source_ids entry whitespace", () => {
    const result = validateSearchSitesInput({
      query: "tokyo hotels",
      country_code: "JP",
      source_ids: ["  src-trimmed  "],
    });
    expect(result.source_ids).toEqual(["src-trimmed"]);
  });

  it("rejects search_sites when query is missing", () => {
    assertSchemaValidationError(
      () => validateSearchSitesInput({ country_code: "JP" }),
      "expected string, received undefined",
    );
  });

  it("rejects search_sites when query is empty string", () => {
    assertSchemaValidationError(
      () => validateSearchSitesInput({ query: "", country_code: "JP" }),
      "search_sites requires non-empty string field query.",
    );
  });

  it("rejects search_sites when query is whitespace-only", () => {
    assertSchemaValidationError(
      () => validateSearchSitesInput({ query: "   ", country_code: "JP" }),
      "search_sites requires non-empty string field query.",
    );
  });

  it("rejects search_sites when top_k is below minimum", () => {
    assertSchemaValidationError(
      () => validateSearchSitesInput({ query: "test", country_code: "JP", top_k: 0 }),
      "search_sites top_k must be an integer between 1 and 30.",
    );
  });

  it("rejects search_sites when top_k exceeds maximum", () => {
    assertSchemaValidationError(
      () => validateSearchSitesInput({ query: "test", country_code: "JP", top_k: 31 }),
      "search_sites top_k must be an integer between 1 and 30.",
    );
  });

  it("rejects search_sites when top_k is not an integer", () => {
    assertSchemaValidationError(
      () => validateSearchSitesInput({ query: "test", country_code: "JP", top_k: 5.5 }),
      "int",
    );
  });

  it("rejects search_sites when source_ids contains empty string", () => {
    assertSchemaValidationError(
      () => validateSearchSitesInput({ query: "test", country_code: "JP", source_ids: ["good-id", ""] }),
      "search_sites requires each source_ids entry to be a non-empty string.",
    );
  });

  it("rejects search_sites when source_ids contains whitespace-only entry", () => {
    assertSchemaValidationError(
      () => validateSearchSitesInput({ query: "test", country_code: "JP", source_ids: ["  "] }),
      "search_sites requires each source_ids entry to be a non-empty string.",
    );
  });

  it("rejects search_sites when unknown keys are provided", () => {
    assertSchemaValidationError(
      () => validateSearchSitesInput({ query: "test", country_code: "JP", unknown_key: true }),
      "Unrecognized key",
    );
  });

  it("accepts search_sites at boundary top_k values", () => {
    expect(validateSearchSitesInput({ query: "test", country_code: "JP", top_k: 1 }).top_k).toBe(1);
    expect(validateSearchSitesInput({ query: "test", country_code: "JP", top_k: 30 }).top_k).toBe(30);
  });

  // --- get_page_chunk ---

  it("accepts get_page_chunk with all fields", () => {
    const input = { chunk_id: "chunk-abc-123", include_neighbors: true };
    expect(validateGetPageChunkInput(input)).toEqual(input);
  });

  it("fills get_page_chunk include_neighbors default when omitted", () => {
    expect(
      validateGetPageChunkInput({ chunk_id: "chunk-001" }),
    ).toEqual({
      chunk_id: "chunk-001",
      include_neighbors: false,
    });
  });

  it("trims get_page_chunk chunk_id whitespace", () => {
    const result = validateGetPageChunkInput({ chunk_id: "  chunk-trimmed  " });
    expect(result.chunk_id).toBe("chunk-trimmed");
  });

  it("rejects get_page_chunk when chunk_id is missing", () => {
    assertSchemaValidationError(
      () => validateGetPageChunkInput({}),
      "expected string, received undefined",
    );
  });

  it("rejects get_page_chunk when chunk_id is empty string", () => {
    assertSchemaValidationError(
      () => validateGetPageChunkInput({ chunk_id: "" }),
      "get_page_chunk requires non-empty string field chunk_id.",
    );
  });

  it("rejects get_page_chunk when chunk_id is whitespace-only", () => {
    assertSchemaValidationError(
      () => validateGetPageChunkInput({ chunk_id: "   " }),
      "get_page_chunk requires non-empty string field chunk_id.",
    );
  });

  it("rejects get_page_chunk when include_neighbors is not a boolean", () => {
    assertSchemaValidationError(
      () => validateGetPageChunkInput({ chunk_id: "chunk-001", include_neighbors: "yes" }),
      "boolean",
    );
  });

  it("rejects get_page_chunk when unknown keys are provided", () => {
    assertSchemaValidationError(
      () => validateGetPageChunkInput({ chunk_id: "chunk-001", extra_field: 42 }),
      "Unrecognized key",
    );
  });

  it("accepts get_page_chunk with include_neighbors explicitly false", () => {
    const result = validateGetPageChunkInput({ chunk_id: "chunk-002", include_neighbors: false });
    expect(result).toEqual({ chunk_id: "chunk-002", include_neighbors: false });
  });

  it("rejects get_page_chunk when chunk_id is not a string", () => {
    assertSchemaValidationError(
      () => validateGetPageChunkInput({ chunk_id: 123 }),
      "string",
    );
  });
});
