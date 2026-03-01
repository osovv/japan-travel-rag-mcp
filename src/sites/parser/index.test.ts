// FILE: src/sites/parser/index.test.ts
// VERSION: 2.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate deterministic parsing behavior for M-SITES-PARSER with ParserResult discriminated union, and validate the layered cleanup pipeline (global, source adapter, quality gate).
//   SCOPE: Assert URL normalization, title extraction, text cleaning, SHA-256 hashing, error handling, non-200 status warnings, ParserResult discriminated union, global cleanup, wrenjapan adapter, quality gate, full pipeline integration, cleanup registry, and fixture matrix coverage for all 12 source adapters.
//   DEPENDS: M-SITES-PARSER, M-SPIDER-CLOUD-CLIENT, M-LOGGER, M-SITES-PARSER-CLEANUP-GLOBAL, M-SITES-PARSER-CLEANUP-ADAPTERS-WRENJAPAN, M-SITES-PARSER-CLEANUP-QUALITY-GATE, M-SITES-PARSER-CLEANUP-REGISTRY
//   LINKS: M-SITES-PARSER-TEST, M-SITES-PARSER, M-SPIDER-CLOUD-CLIENT, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build deterministic no-op logger for parser tests.
//   createWarnCapturingLogger - Build logger that captures warn calls for assertion.
//   makeCrawlItem - Build SpiderCrawlItem fixture with overrideable fields.
//   URLNormalizationTests - Validate URL fragment stripping, trailing slash, and hostname lowering.
//   TitleExtractionTests - Validate title from metadata, heading, and URL path fallback.
//   TextCleaningTests - Validate HTML removal, whitespace normalization, and boilerplate stripping.
//   TextHashTests - Validate SHA-256 hex digest computation.
//   ErrorHandlingTests - Validate SitesParserError on empty URL, and structured skip on empty content.
//   NonOkStatusTests - Validate warn logging on non-200 status codes.
//   GlobalCleanupTests - Validate Layer A global cleanup rules.
//   WrenjapanAdapterTests - Validate Layer B wrenjapan source adapter cleanup.
//   QualityGateTests - Validate Layer C quality gate accept/reject decisions.
//   CleanupPipelineIntegrationTests - Validate full cleanup pipeline through parseCrawlItem.
//   RegistryTests - Validate cleanup adapter registry completeness and lookup.
//   FixtureMatrixTests - Validate cleanup pipeline for all 12 source adapters via fixture regression.
//   PipelineRegistryIntegrationTests - Validate pipeline routes non-wrenjapan sources through registry.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v3.0.0 - Added cleanup registry tests, fixture matrix coverage for all 12 source adapters, and pipeline-registry integration test.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { Logger } from "../../logger/index";
import type { SpiderCrawlItem } from "../../integrations/spider-cloud-client";
import { parseCrawlItem, SitesParserError, type ParsedPage, type ParserResult } from "./index";
import { globalCleanup } from "./cleanup/global";
import { wrenjapanAdapter } from "./cleanup/adapters/wrenjapan";
import { qualityGate } from "./cleanup/quality-gate";
import { MIN_CLEAN_CHARS } from "./cleanup/types";

// START_CONTRACT: createNoopLogger
//   PURPOSE: Build inert logger implementation for deterministic parser tests.
//   INPUTS: {}
//   OUTPUTS: { Logger - No-op logger with child passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createNoopLogger
function createNoopLogger(): Logger {
  // START_BLOCK_CREATE_NOOP_LOGGER_M_SITES_PARSER_TEST_001
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
  // END_BLOCK_CREATE_NOOP_LOGGER_M_SITES_PARSER_TEST_001
}

type WarnCall = {
  message: string;
  functionName: string;
  blockName: string;
  extra?: Record<string, unknown>;
};

// START_CONTRACT: createWarnCapturingLogger
//   PURPOSE: Build logger that captures warn calls for assertion on non-200 status codes.
//   INPUTS: {}
//   OUTPUTS: { { logger: Logger, warns: WarnCall[] } - Logger and captured warn calls }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-LOGGER]
// END_CONTRACT: createWarnCapturingLogger
function createWarnCapturingLogger(): { logger: Logger; warns: WarnCall[] } {
  // START_BLOCK_CREATE_WARN_CAPTURING_LOGGER_M_SITES_PARSER_TEST_002
  const warns: WarnCall[] = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (message, functionName, blockName, extra) => {
      warns.push({ message, functionName, blockName, extra });
    },
    error: () => {},
    child: () => logger,
  };
  return { logger, warns };
  // END_BLOCK_CREATE_WARN_CAPTURING_LOGGER_M_SITES_PARSER_TEST_002
}

// START_CONTRACT: makeCrawlItem
//   PURPOSE: Build SpiderCrawlItem fixture with overrideable fields for test scenarios.
//   INPUTS: { overrides: Partial<SpiderCrawlItem> - Optional field overrides }
//   OUTPUTS: { SpiderCrawlItem - Fixture crawl item }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SPIDER-CLOUD-CLIENT]
// END_CONTRACT: makeCrawlItem
function makeCrawlItem(overrides?: Partial<SpiderCrawlItem>): SpiderCrawlItem {
  // START_BLOCK_BUILD_CRAWL_ITEM_FIXTURE_M_SITES_PARSER_TEST_003
  return {
    url: "https://example.com/travel/tokyo-guide",
    content: "# Tokyo Guide\n\nTokyo is the capital of Japan and one of the largest cities in the world.\n\nVisit Shibuya for great food and culture.",
    status_code: 200,
    metadata: {
      title: "Tokyo Travel Guide",
    },
    ...overrides,
  };
  // END_BLOCK_BUILD_CRAWL_ITEM_FIXTURE_M_SITES_PARSER_TEST_003
}

// START_CONTRACT: assertAccepted
//   PURPOSE: Type-narrowing helper that asserts a ParserResult is accepted and returns the page.
//   INPUTS: { result: ParserResult - Result from parseCrawlItem }
//   OUTPUTS: { ParsedPage - The accepted page (throws if status is not "accepted") }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER-TEST]
// END_CONTRACT: assertAccepted
function assertAccepted(result: ParserResult): ParsedPage {
  // START_BLOCK_ASSERT_ACCEPTED_M_SITES_PARSER_TEST_012
  expect(result.status).toBe("accepted");
  if (result.status !== "accepted") {
    throw new Error("Expected accepted result");
  }
  return result.page;
  // END_BLOCK_ASSERT_ACCEPTED_M_SITES_PARSER_TEST_012
}

const TEST_SOURCE_ID = "src-001";

describe("M-SITES-PARSER", () => {
  // START_BLOCK_URL_NORMALIZATION_TESTS_M_SITES_PARSER_TEST_004
  describe("URL normalization", () => {
    it("should strip URL fragments", () => {
      const item = makeCrawlItem({ url: "https://example.com/page#section-1" });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.url).toBe("https://example.com/page");
      expect(page.canonical_url).toBe("https://example.com/page");
    });

    it("should remove trailing slashes from non-root paths", () => {
      const item = makeCrawlItem({ url: "https://example.com/page/" });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.url).toBe("https://example.com/page");
    });

    it("should preserve trailing slash for root path", () => {
      const item = makeCrawlItem({ url: "https://example.com/" });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.url).toBe("https://example.com/");
    });

    it("should lowercase hostname", () => {
      const item = makeCrawlItem({ url: "https://EXAMPLE.COM/Page" });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.url).toBe("https://example.com/Page");
    });

    it("should preserve query parameters", () => {
      const item = makeCrawlItem({ url: "https://example.com/search?q=tokyo&lang=en" });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.url).toBe("https://example.com/search?q=tokyo&lang=en");
    });

    it("should set canonical_url equal to normalized url", () => {
      const item = makeCrawlItem({ url: "https://example.com/page#frag" });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.canonical_url).toBe(page.url);
    });
  });
  // END_BLOCK_URL_NORMALIZATION_TESTS_M_SITES_PARSER_TEST_004

  // START_BLOCK_TITLE_EXTRACTION_TESTS_M_SITES_PARSER_TEST_005
  describe("Title extraction", () => {
    it("should use metadata.title when present", () => {
      const item = makeCrawlItem({
        metadata: { title: "My Custom Title" },
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.title).toBe("My Custom Title");
    });

    it("should fall back to first markdown heading when metadata title is missing", () => {
      const item = makeCrawlItem({
        metadata: {},
        content: "Some intro text that provides context.\n\n# Welcome to Japan\n\nMore content here with additional details.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.title).toBe("Welcome to Japan");
    });

    it("should handle h2-h6 heading levels", () => {
      const item = makeCrawlItem({
        metadata: {},
        content: "Intro text that is long enough.\n\n## Second Level Heading\n\nContent that provides enough characters to pass the gate.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.title).toBe("Second Level Heading");
    });

    it("should fall back to URL path when no heading exists", () => {
      const item = makeCrawlItem({
        url: "https://example.com/travel/tokyo-guide",
        metadata: {},
        content: "Just plain text without headings that is long enough to pass the quality gate minimum threshold.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.title).toBe("tokyo guide");
    });

    it("should strip file extensions from URL path title", () => {
      const item = makeCrawlItem({
        url: "https://example.com/pages/about-us.html",
        metadata: {},
        content: "Plain text that is long enough to pass the quality gate minimum threshold for the cleanup pipeline.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.title).toBe("about us");
    });

    it("should use hostname when URL path is root", () => {
      const item = makeCrawlItem({
        url: "https://example.com/",
        metadata: {},
        content: "Root page content that is long enough to pass the quality gate minimum threshold for the cleanup.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.title).toBe("example.com");
    });

    it("should skip empty metadata title and use heading", () => {
      const item = makeCrawlItem({
        metadata: { title: "   " },
        content: "# Real Title\n\nContent that is long enough to pass the quality gate minimum threshold for the cleanup pipeline.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.title).toBe("Real Title");
    });
  });
  // END_BLOCK_TITLE_EXTRACTION_TESTS_M_SITES_PARSER_TEST_005

  // START_BLOCK_TEXT_CLEANING_TESTS_M_SITES_PARSER_TEST_006
  describe("Text cleaning", () => {
    it("should remove residual HTML tags", () => {
      const item = makeCrawlItem({
        content: "# Title\n\n<div>Some <b>bold</b> text</div> and more content to pass the quality gate threshold.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.clean_text).not.toContain("<div>");
      expect(page.clean_text).not.toContain("<b>");
      expect(page.clean_text).not.toContain("</b>");
      expect(page.clean_text).not.toContain("</div>");
      expect(page.clean_text).toContain("Some bold text");
    });

    it("should normalize excessive newlines (3+ -> 2)", () => {
      const item = makeCrawlItem({
        content: "# Title\n\n\n\n\nParagraph one with enough text to pass the quality gate.\n\n\n\nParagraph two with additional content.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      // Should not have more than 2 consecutive newlines
      expect(page.clean_text).not.toMatch(/\n{3,}/);
      expect(page.clean_text).toContain("# Title\n\nParagraph one with enough text to pass the quality gate.\n\nParagraph two with additional content.");
    });

    it("should trim leading and trailing whitespace", () => {
      const item = makeCrawlItem({
        content: "   \n\n  # Title\n\nContent that is long enough to pass the quality gate threshold requirement.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.clean_text).toBe("# Title\n\nContent that is long enough to pass the quality gate threshold requirement.");
    });

    it("should remove navigation boilerplate lines", () => {
      const item = makeCrawlItem({
        content: "Home | About | Contact\n\n# Real Content\n\nText here that is long enough to pass quality gate.\n\nSkip to content",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.clean_text).not.toContain("Home | About | Contact");
      expect(page.clean_text).not.toContain("Skip to content");
      expect(page.clean_text).toContain("# Real Content");
    });

    it("should remove copyright boilerplate lines", () => {
      const item = makeCrawlItem({
        content: "# Title\n\nContent that is long enough to pass quality gate threshold minimum.\n\nCopyright 2024 Example Corp.\n\nAll rights reserved.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.clean_text).not.toContain("Copyright 2024");
      expect(page.clean_text).not.toContain("All rights reserved.");
    });

    it("should remove 'Back to top' lines", () => {
      const item = makeCrawlItem({
        content: "# Title\n\nContent that is long enough to pass quality gate threshold minimum.\n\nBack to top",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.clean_text).not.toContain("Back to top");
    });

    it("should preserve normal content lines", () => {
      const item = makeCrawlItem({
        content: "# Tokyo Guide\n\nTokyo is the capital of Japan and one of the largest cities in the world.\n\nVisit Shibuya for great food and culture.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.clean_text).toBe("# Tokyo Guide\n\nTokyo is the capital of Japan and one of the largest cities in the world.\n\nVisit Shibuya for great food and culture.");
    });
  });
  // END_BLOCK_TEXT_CLEANING_TESTS_M_SITES_PARSER_TEST_006

  // START_BLOCK_TEXT_HASH_TESTS_M_SITES_PARSER_TEST_007
  describe("Text hash", () => {
    it("should produce a 64-character hex SHA-256 hash", () => {
      const item = makeCrawlItem();
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.text_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should produce identical hashes for identical cleaned text", () => {
      const item1 = makeCrawlItem({ content: "# Test\n\nContent here that is long enough to pass the quality gate threshold minimum." });
      const item2 = makeCrawlItem({ content: "# Test\n\nContent here that is long enough to pass the quality gate threshold minimum." });
      const result1 = parseCrawlItem(item1, TEST_SOURCE_ID, createNoopLogger());
      const result2 = parseCrawlItem(item2, TEST_SOURCE_ID, createNoopLogger());
      const page1 = assertAccepted(result1);
      const page2 = assertAccepted(result2);
      expect(page1.text_hash).toBe(page2.text_hash);
    });

    it("should produce different hashes for different content", () => {
      const item1 = makeCrawlItem({ content: "# Test\n\nContent A that is long enough to pass the quality gate threshold minimum requirement." });
      const item2 = makeCrawlItem({ content: "# Test\n\nContent B that is long enough to pass the quality gate threshold minimum requirement." });
      const result1 = parseCrawlItem(item1, TEST_SOURCE_ID, createNoopLogger());
      const result2 = parseCrawlItem(item2, TEST_SOURCE_ID, createNoopLogger());
      const page1 = assertAccepted(result1);
      const page2 = assertAccepted(result2);
      expect(page1.text_hash).not.toBe(page2.text_hash);
    });

    it("should hash the cleaned text, not the raw content", () => {
      // Two items with same meaningful text but different boilerplate
      const item1 = makeCrawlItem({
        content: "# Guide\n\nMain content that is long enough to pass the quality gate threshold for both tests.",
      });
      const item2 = makeCrawlItem({
        content: "Home | About | Contact\n\n# Guide\n\nMain content that is long enough to pass the quality gate threshold for both tests.\n\nBack to top",
      });
      const result1 = parseCrawlItem(item1, TEST_SOURCE_ID, createNoopLogger());
      const result2 = parseCrawlItem(item2, TEST_SOURCE_ID, createNoopLogger());
      const page1 = assertAccepted(result1);
      const page2 = assertAccepted(result2);
      expect(page1.text_hash).toBe(page2.text_hash);
    });
  });
  // END_BLOCK_TEXT_HASH_TESTS_M_SITES_PARSER_TEST_007

  // START_BLOCK_ERROR_HANDLING_TESTS_M_SITES_PARSER_TEST_008
  describe("Error handling", () => {
    it("should throw SitesParserError when URL is empty", () => {
      const item = makeCrawlItem({ url: "" });
      expect(() =>
        parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger()),
      ).toThrow(SitesParserError);
    });

    it("should throw SitesParserError when URL is whitespace only", () => {
      const item = makeCrawlItem({ url: "   " });
      expect(() =>
        parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger()),
      ).toThrow(SitesParserError);
    });

    it("should return skipped with EMPTY_CONTENT when content is empty", () => {
      const item = makeCrawlItem({ content: "" });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.status).toBe("skipped");
      if (result.status === "skipped") {
        expect(result.reason).toBe("EMPTY_CONTENT");
        expect(result.source_id).toBe(TEST_SOURCE_ID);
        expect(result.url).toBeDefined();
      }
    });

    it("should return skipped with EMPTY_CONTENT when content is whitespace only", () => {
      const item = makeCrawlItem({ content: "   " });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.status).toBe("skipped");
      if (result.status === "skipped") {
        expect(result.reason).toBe("EMPTY_CONTENT");
      }
    });

    it("should include SITES_PARSER_ERROR code on thrown errors", () => {
      const item = makeCrawlItem({ url: "" });
      try {
        parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SitesParserError);
        expect((err as SitesParserError).code).toBe("SITES_PARSER_ERROR");
      }
    });

    it("should include details in thrown error", () => {
      const item = makeCrawlItem({ url: "" });
      try {
        parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SitesParserError);
        expect((err as SitesParserError).details).toBeDefined();
        expect((err as SitesParserError).details?.sourceId).toBe(TEST_SOURCE_ID);
      }
    });
  });
  // END_BLOCK_ERROR_HANDLING_TESTS_M_SITES_PARSER_TEST_008

  // START_BLOCK_CONTENT_FALLBACK_TESTS_M_SITES_PARSER_TEST_011
  describe("Content fallback fields", () => {
    it("should use markdown when content is empty", () => {
      const item = {
        ...makeCrawlItem({ content: "", metadata: {} }),
        markdown: "# Markdown Title\n\nFallback markdown content that is long enough to pass quality gate.",
      };
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.clean_text).toContain("Fallback markdown content");
      expect(page.title).toBe("Markdown Title");
    });

    it("should use text when content and markdown are empty", () => {
      const item = {
        ...makeCrawlItem({ content: "", metadata: {} }),
        markdown: "",
        text: "# Text Title\n\nFallback text content that is long enough to pass quality gate threshold.",
      };
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.clean_text).toContain("Fallback text content");
      expect(page.title).toBe("Text Title");
    });

    it("should use html when other fields are empty", () => {
      const item = {
        ...makeCrawlItem({ content: "", metadata: {} }),
        markdown: "",
        text: "",
        html: "<h1>HTML Title</h1><p>Fallback html content that is long enough to pass quality gate threshold requirement.</p>",
      };
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.clean_text).toContain("HTML TitleFallback html content");
      expect(page.title).toBe("tokyo guide");
    });
  });
  // END_BLOCK_CONTENT_FALLBACK_TESTS_M_SITES_PARSER_TEST_011

  // START_BLOCK_NON_OK_STATUS_TESTS_M_SITES_PARSER_TEST_009
  describe("Non-200 status handling", () => {
    it("should log a warning for non-200 status codes", () => {
      const { logger, warns } = createWarnCapturingLogger();
      const item = makeCrawlItem({ status_code: 301 });
      parseCrawlItem(item, TEST_SOURCE_ID, logger);
      expect(warns.length).toBe(1);
      expect(warns[0].message).toContain("301");
    });

    it("should still produce a ParsedPage for non-200 status", () => {
      const { logger } = createWarnCapturingLogger();
      const item = makeCrawlItem({ status_code: 404 });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, logger);
      const page = assertAccepted(result);
      expect(page.http_status).toBe(404);
      expect(page.clean_text.length).toBeGreaterThan(0);
    });

    it("should not log a warning for 200 status", () => {
      const { logger, warns } = createWarnCapturingLogger();
      const item = makeCrawlItem({ status_code: 200 });
      parseCrawlItem(item, TEST_SOURCE_ID, logger);
      expect(warns.length).toBe(0);
    });

    it("should not log a warning when status_code is undefined", () => {
      const { logger, warns } = createWarnCapturingLogger();
      const item = makeCrawlItem();
      (item as Record<string, unknown>).status_code = undefined;
      parseCrawlItem(item, TEST_SOURCE_ID, logger);
      expect(warns.length).toBe(0);
    });
  });
  // END_BLOCK_NON_OK_STATUS_TESTS_M_SITES_PARSER_TEST_009

  // START_BLOCK_FULL_PARSE_INTEGRATION_TESTS_M_SITES_PARSER_TEST_010
  describe("Full parse integration", () => {
    it("should set source_id from the provided argument", () => {
      const item = makeCrawlItem();
      const result = parseCrawlItem(item, "my-source", createNoopLogger());
      const page = assertAccepted(result);
      expect(page.source_id).toBe("my-source");
    });

    it("should set http_status from item.status_code", () => {
      const item = makeCrawlItem({ status_code: 200 });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.http_status).toBe(200);
    });

    it("should default http_status to 200 when status_code is undefined", () => {
      const item = makeCrawlItem();
      (item as Record<string, unknown>).status_code = undefined;
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      expect(page.http_status).toBe(200);
    });

    it("should set fetched_at to a recent Date", () => {
      const before = new Date();
      const item = makeCrawlItem();
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const page = assertAccepted(result);
      const after = new Date();
      expect(page.fetched_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(page.fetched_at.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should return all required ParsedPage fields for accepted result", () => {
      const item = makeCrawlItem();
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.status).toBe("accepted");
      if (result.status === "accepted") {
        expect(result.page).toHaveProperty("source_id");
        expect(result.page).toHaveProperty("url");
        expect(result.page).toHaveProperty("canonical_url");
        expect(result.page).toHaveProperty("title");
        expect(result.page).toHaveProperty("clean_text");
        expect(result.page).toHaveProperty("text_hash");
        expect(result.page).toHaveProperty("http_status");
        expect(result.page).toHaveProperty("fetched_at");
      }
    });
  });
  // END_BLOCK_FULL_PARSE_INTEGRATION_TESTS_M_SITES_PARSER_TEST_010
});

// START_BLOCK_GLOBAL_CLEANUP_TESTS_M_SITES_PARSER_TEST_013
describe("M-SITES-PARSER-CLEANUP-GLOBAL", () => {
  describe("Global cleanup", () => {
    it("should remove data-URI images", () => {
      const input = "Some text\n\n![alt](data:image/gif;base64,R0lGODlhAQABAIAAAA==)\n\nMore text";
      const result = globalCleanup(input);
      expect(result).not.toContain("data:image");
      expect(result).toContain("Some text");
      expect(result).toContain("More text");
    });

    it("should remove empty bold/italic markers", () => {
      const input = "Content before\n**\nContent after\n***\nMore content";
      const result = globalCleanup(input);
      expect(result).not.toMatch(/^\s*\*{2,3}\s*$/m);
      expect(result).toContain("Content before");
      expect(result).toContain("Content after");
    });

    it("should remove social signup lines", () => {
      const input = "Content\nSign up with your email address to be the first to know\nMore content";
      const result = globalCleanup(input);
      expect(result).not.toContain("Sign up with your email");
      expect(result).toContain("Content");
      expect(result).toContain("More content");
    });

    it("should remove standalone nav link lines", () => {
      const input = "Content\n[Home](/) | [About](/about) | [Contact](/contact)\nMore content";
      const result = globalCleanup(input);
      expect(result).not.toContain("[Home](/)");
      expect(result).toContain("Content");
      expect(result).toContain("More content");
    });

    it("should remove site name header lines", () => {
      const input = "# [My Site](https://example.com/)\nActual article content here.";
      const result = globalCleanup(input);
      expect(result).not.toContain("[My Site]");
      expect(result).toContain("Actual article content here.");
    });

    it("should collapse excessive newlines", () => {
      const input = "First paragraph\n\n\n\n\nSecond paragraph";
      const result = globalCleanup(input);
      expect(result).not.toMatch(/\n{3,}/);
      expect(result).toContain("First paragraph\n\nSecond paragraph");
    });

    it("should preserve normal content", () => {
      const input = "# Article Title\n\nThis is a normal paragraph with [a link](https://example.com/page).\n\n## Section Two\n\nMore content here.";
      const result = globalCleanup(input);
      expect(result).toBe(input);
    });
  });
});
// END_BLOCK_GLOBAL_CLEANUP_TESTS_M_SITES_PARSER_TEST_013

// START_BLOCK_WRENJAPAN_ADAPTER_TESTS_M_SITES_PARSER_TEST_014
describe("M-SITES-PARSER-CLEANUP-ADAPTERS-WRENJAPAN", () => {
  describe("Wrenjapan adapter", () => {
    it("should have sourceId set to wrenjapan", () => {
      expect(wrenjapanAdapter.sourceId).toBe("wrenjapan");
    });

    it("should remove nav menu lines", () => {
      const input = "Content\n* [Игры](https://wrenjapan.com/category/igry/)\n* [Аниме](https://wrenjapan.com/category/anime/)\nMore content";
      const result = wrenjapanAdapter.clean(input);
      expect(result).not.toContain("wrenjapan.com/category/");
      expect(result).toContain("Content");
      expect(result).toContain("More content");
    });

    it("should remove newsletter promo text", () => {
      const input = "Content\nSign up with your email address to be the first to know about new products, VIP offers\nMore content";
      const result = wrenjapanAdapter.clean(input);
      expect(result).not.toContain("Sign up with your email address");
      expect(result).toContain("Content");
    });

    it("should remove base64 placeholder images", () => {
      const input = "Content\n![](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)\nMore content";
      const result = wrenjapanAdapter.clean(input);
      expect(result).not.toContain("data:image/gif;base64");
      expect(result).toContain("Content");
      expect(result).toContain("More content");
    });

    it("should remove site name header", () => {
      const input = "[Тот самый Врен](https://wrenjapan.com/)\nArticle content here.";
      const result = wrenjapanAdapter.clean(input);
      expect(result).not.toContain("Тот самый Врен");
      expect(result).toContain("Article content here.");
    });

    it("should preserve article content", () => {
      const input = "#### Как устроена Осака?\nУ Осаки, как и у Токио, нет одного ярко выраженного центра.";
      const result = wrenjapanAdapter.clean(input);
      expect(result).toContain("Как устроена Осака?");
      expect(result).toContain("нет одного ярко выраженного центра");
    });

    it("should clean wrenjapan osaka fixture with substantially less noise", () => {
      const fixture = require("./__fixtures__/wrenjapan/raw/wrenjapan.com-yaponiya-gde-selitsya-v-osake-f7df7c56.json");
      const rawContent: string = fixture.body[0].content;

      // Verify fixture has noise markers
      expect(rawContent).toContain("wrenjapan.com/category/");
      expect(rawContent).toContain("Sign up with your email address");
      expect(rawContent).toContain("data:image/gif;base64");

      const cleaned = wrenjapanAdapter.clean(rawContent);

      // Noise should be removed
      expect(cleaned).not.toContain("wrenjapan.com/category/igry");
      expect(cleaned).not.toContain("Sign up with your email address to be the first");
      expect(cleaned).not.toContain("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");

      // Article content should be preserved
      expect(cleaned).toContain("Как устроена Осака?");

      // Cleaned output should be substantially shorter
      expect(cleaned.length).toBeLessThan(rawContent.length * 0.95);
    });

    it("should clean wrenjapan hakone fixture with substantially less noise", () => {
      const fixture = require("./__fixtures__/wrenjapan/raw/wrenjapan.com-yaponiya-poezdka-v-hakone-4b01c7b8.json");
      const rawContent: string = fixture.body[0].content;

      // Verify fixture has noise markers
      expect(rawContent).toContain("wrenjapan.com/category/");
      expect(rawContent).toContain("data:image/gif;base64");

      const cleaned = wrenjapanAdapter.clean(rawContent);

      // Noise should be removed
      expect(cleaned).not.toContain("wrenjapan.com/category/igry");
      expect(cleaned).not.toContain("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");

      // Article content should be preserved
      expect(cleaned).toContain("Как добраться до Хаконе");

      // Cleaned output should be substantially shorter
      expect(cleaned.length).toBeLessThan(rawContent.length * 0.95);
    });
  });
});
// END_BLOCK_WRENJAPAN_ADAPTER_TESTS_M_SITES_PARSER_TEST_014

// START_BLOCK_QUALITY_GATE_TESTS_M_SITES_PARSER_TEST_015
describe("M-SITES-PARSER-CLEANUP-QUALITY-GATE", () => {
  describe("Quality gate", () => {
    it("should accept text with 80+ chars", () => {
      const text = "A".repeat(MIN_CLEAN_CHARS);
      const result = qualityGate(text);
      expect(result.accepted).toBe(true);
      if (result.accepted) {
        expect(result.text).toBe(text);
        expect(result.metrics.clean_char_count).toBe(MIN_CLEAN_CHARS);
      }
    });

    it("should reject empty text with EMPTY_AFTER_CLEANUP", () => {
      const result = qualityGate("");
      expect(result.accepted).toBe(false);
      if (!result.accepted) {
        expect(result.reason).toBe("EMPTY_AFTER_CLEANUP");
        expect(result.metrics.clean_char_count).toBe(0);
      }
    });

    it("should reject whitespace-only text with EMPTY_AFTER_CLEANUP", () => {
      const result = qualityGate("   \n\n  ");
      expect(result.accepted).toBe(false);
      if (!result.accepted) {
        expect(result.reason).toBe("EMPTY_AFTER_CLEANUP");
        expect(result.metrics.clean_char_count).toBe(0);
      }
    });

    it("should reject short text (<80 chars) with TOO_SHORT_AFTER_CLEANUP", () => {
      const shortText = "Short text.";
      expect(shortText.length).toBeLessThan(MIN_CLEAN_CHARS);
      const result = qualityGate(shortText);
      expect(result.accepted).toBe(false);
      if (!result.accepted) {
        expect(result.reason).toBe("TOO_SHORT_AFTER_CLEANUP");
      }
    });

    it("should return clean_char_count in metrics", () => {
      const text = "A".repeat(100);
      const result = qualityGate(text);
      expect(result.metrics).toBeDefined();
      expect(result.metrics.clean_char_count).toBe(100);
    });

    it("should return clean_char_count for rejected text", () => {
      const text = "Short";
      const result = qualityGate(text);
      expect(result.accepted).toBe(false);
      expect(result.metrics.clean_char_count).toBe(5);
    });

    it("should confirm MIN_CLEAN_CHARS is 80", () => {
      expect(MIN_CLEAN_CHARS).toBe(80);
    });
  });
});
// END_BLOCK_QUALITY_GATE_TESTS_M_SITES_PARSER_TEST_015

// START_BLOCK_CLEANUP_PIPELINE_INTEGRATION_TESTS_M_SITES_PARSER_TEST_016
describe("M-SITES-PARSER-CLEANUP-PIPELINE", () => {
  describe("Full pipeline integration via parseCrawlItem", () => {
    it("should return accepted with cleaned content for wrenjapan source_id", () => {
      const fixture = require("./__fixtures__/wrenjapan/raw/wrenjapan.com-yaponiya-gde-selitsya-v-osake-f7df7c56.json");
      const fixtureBody = fixture.body[0];
      const item: SpiderCrawlItem = {
        url: fixtureBody.url,
        content: fixtureBody.content,
        status_code: fixtureBody.status,
        metadata: { title: "Где селиться в Осаке" },
      };
      const result = parseCrawlItem(item, "wrenjapan", createNoopLogger());
      expect(result.status).toBe("accepted");
      if (result.status === "accepted") {
        // Noise should be cleaned from the output
        expect(result.page.clean_text).not.toContain("wrenjapan.com/category/igry");
        expect(result.page.clean_text).not.toContain("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");
        // Meaningful content should be preserved
        expect(result.page.clean_text).toContain("Как устроена Осака?");
        expect(result.page.source_id).toBe("wrenjapan");
        expect(result.page.clean_text.length).toBeGreaterThan(MIN_CLEAN_CHARS);
      }
    });

    it("should return skipped for very short content that fails quality gate", () => {
      const item = makeCrawlItem({
        content: "Hi.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.status).toBe("skipped");
      if (result.status === "skipped") {
        expect(result.reason).toBe("TOO_SHORT_AFTER_CLEANUP");
        expect(result.source_id).toBe(TEST_SOURCE_ID);
        expect(result.metrics).toBeDefined();
        expect(result.metrics!.clean_char_count).toBeLessThan(MIN_CLEAN_CHARS);
      }
    });

    it("should return skipped with EMPTY_CONTENT when all content fields are empty", () => {
      const item: SpiderCrawlItem = {
        url: "https://example.com/empty",
        content: "",
        status_code: 200,
        metadata: {},
      };
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.status).toBe("skipped");
      if (result.status === "skipped") {
        expect(result.reason).toBe("EMPTY_CONTENT");
      }
    });

    it("should return accepted for content exactly at MIN_CLEAN_CHARS boundary", () => {
      // Create content that, after cleanup, is exactly MIN_CLEAN_CHARS long
      const content = "A".repeat(MIN_CLEAN_CHARS);
      const item = makeCrawlItem({ content });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.status).toBe("accepted");
    });
  });
});
// END_BLOCK_CLEANUP_PIPELINE_INTEGRATION_TESTS_M_SITES_PARSER_TEST_016

// START_BLOCK_REGISTRY_TESTS_M_SITES_PARSER_TEST_017
import { SUPPORTED_CLEANUP_SOURCE_IDS, getCleanupAdapter } from "./cleanup/registry";
import { runCleanupPipeline } from "./cleanup/index";

describe("M-SITES-PARSER-CLEANUP-REGISTRY", () => {
  it("should have exactly 12 entries in SUPPORTED_CLEANUP_SOURCE_IDS", () => {
    expect(SUPPORTED_CLEANUP_SOURCE_IDS).toHaveLength(12);
  });

  it("should contain all expected source IDs", () => {
    const expected = [
      "insidekyoto",
      "invisible_tourist",
      "japan_guide",
      "japan_unravelled",
      "jorudan",
      "jreast",
      "kansai_odyssey",
      "navitime",
      "reddit_japantravel",
      "smart_ex",
      "trulytokyo",
      "wrenjapan",
    ];
    expect(SUPPORTED_CLEANUP_SOURCE_IDS).toEqual(expected);
  });

  it("should return an adapter for each registered source", () => {
    for (const sourceId of SUPPORTED_CLEANUP_SOURCE_IDS) {
      const adapter = getCleanupAdapter(sourceId);
      expect(adapter).not.toBeNull();
    }
  });

  it("should return null for unknown source", () => {
    expect(getCleanupAdapter("nonexistent_source")).toBeNull();
  });

  it("should have correct sourceId on each adapter", () => {
    for (const sourceId of SUPPORTED_CLEANUP_SOURCE_IDS) {
      const adapter = getCleanupAdapter(sourceId);
      expect(adapter!.sourceId).toBe(sourceId);
    }
  });
});
// END_BLOCK_REGISTRY_TESTS_M_SITES_PARSER_TEST_017

// START_BLOCK_INSIDEKYOTO_FIXTURE_TESTS_M_SITES_PARSER_TEST_018
describe("M-SITES-PARSER-CLEANUP-ADAPTERS-INSIDEKYOTO", () => {
  it("should clean insidekyoto one-day itinerary fixture", () => {
    const fixture = require("./__fixtures__/insidekyoto/raw/insidekyoto.com-kyoto-one-day-itinerary-bc6429fe.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "insidekyoto");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("Kyoto Vacation Checklist");
      expect(result.text).not.toContain("Kyoto District Map");
      expect(result.text).not.toContain("About InsideKyoto.com");
      // Preserve article headings and body text
      expect(result.text).toContain("##");
      expect(result.text.toLowerCase()).toContain("temple");
    }
  });

  it("should clean insidekyoto districts fixture", () => {
    const fixture = require("./__fixtures__/insidekyoto/raw/insidekyoto.com-kyoto-districts-e204753f.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "insidekyoto");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("Kyoto Vacation Checklist");
      expect(result.text).not.toContain("About InsideKyoto.com");
      expect(result.text.toLowerCase()).toContain("kyoto");
    }
  });
});
// END_BLOCK_INSIDEKYOTO_FIXTURE_TESTS_M_SITES_PARSER_TEST_018

// START_BLOCK_TRULYTOKYO_FIXTURE_TESTS_M_SITES_PARSER_TEST_019
describe("M-SITES-PARSER-CLEANUP-ADAPTERS-TRULYTOKYO", () => {
  it("should clean trulytokyo restaurants fixture", () => {
    const fixture = require("./__fixtures__/trulytokyo/raw/trulytokyo.com-best-tokyo-restaurants-570f3ef4.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "trulytokyo");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("Tokyo Vacation Checklist");
      expect(result.text).not.toContain("Tokyo District Map");
      expect(result.text).not.toContain("Top Activities In Tokyo");
      // Preserve restaurant listings
      expect(result.text.toLowerCase()).toContain("restaurant");
      expect(result.text.toLowerCase()).toContain("shinjuku");
    }
  });

  it("should clean trulytokyo luxury hotels fixture", () => {
    const fixture = require("./__fixtures__/trulytokyo/raw/trulytokyo.com-best-tokyo-luxury-hotels-0937f367.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "trulytokyo");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("Tokyo Vacation Checklist");
      expect(result.text).not.toContain("Top Activities In Tokyo");
      expect(result.text.toLowerCase()).toContain("hotel");
    }
  });
});
// END_BLOCK_TRULYTOKYO_FIXTURE_TESTS_M_SITES_PARSER_TEST_019

// START_BLOCK_KANSAI_ODYSSEY_FIXTURE_TESTS_M_SITES_PARSER_TEST_020
describe("M-SITES-PARSER-CLEANUP-ADAPTERS-KANSAI_ODYSSEY", () => {
  it("should clean kansai_odyssey koyasan fixture", () => {
    const fixture = require("./__fixtures__/kansai_odyssey/raw/kansai-odyssey.com-koyasan-okunoin-cemetery-d4543146.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "kansai_odyssey");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("[Kansai Odyssey]");
      expect(result.text).not.toContain("Adventures in Kansai");
      expect(result.text).not.toContain("You May Also Like");
      // Preserve article text
      expect(result.text.toLowerCase()).toContain("okunoin");
      expect(result.text.toLowerCase()).toContain("cemetery");
    }
  });

  it("should clean kansai_odyssey hamadera park fixture", () => {
    const fixture = require("./__fixtures__/kansai_odyssey/raw/kansai-odyssey.com-hamadera-park-4d0bd65d.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "kansai_odyssey");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("[Kansai Odyssey]");
      expect(result.text).not.toContain("You May Also Like");
      expect(result.text.toLowerCase()).toContain("park");
    }
  });
});
// END_BLOCK_KANSAI_ODYSSEY_FIXTURE_TESTS_M_SITES_PARSER_TEST_020

// START_BLOCK_INVISIBLE_TOURIST_FIXTURE_TESTS_M_SITES_PARSER_TEST_021
describe("M-SITES-PARSER-CLEANUP-ADAPTERS-INVISIBLE_TOURIST", () => {
  it("should clean invisible_tourist etiquette fixture", () => {
    const fixture = require("./__fixtures__/invisible_tourist/raw/theinvisibletourist.com-dos-and-donts-in-japan-tourist-guide-etiquette-72165e6e.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "invisible_tourist");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("ByAlyse");
      expect(result.text).not.toContain("affiliate links");
      expect(result.text).not.toContain("Like it? Pin it!");
      expect(result.text).not.toContain("READ MORE:");
      // Preserve article headings and tips
      expect(result.text).toContain("##");
      expect(result.text.toLowerCase()).toContain("etiquette");
    }
  });

  it("should clean invisible_tourist japan travel fixture", () => {
    const fixture = require("./__fixtures__/invisible_tourist/raw/theinvisibletourist.com-japan-travel-2bad8bee.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "invisible_tourist");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("ByAlyse");
      expect(result.text).not.toContain("Like it? Pin it!");
      expect(result.text.toLowerCase()).toContain("japan");
    }
  });
});
// END_BLOCK_INVISIBLE_TOURIST_FIXTURE_TESTS_M_SITES_PARSER_TEST_021

// START_BLOCK_JAPAN_UNRAVELLED_FIXTURE_TESTS_M_SITES_PARSER_TEST_022
describe("M-SITES-PARSER-CLEANUP-ADAPTERS-JAPAN_UNRAVELLED", () => {
  it("should clean japan_unravelled best time fixture", () => {
    const fixture = require("./__fixtures__/japan_unravelled/raw/japanunravelled.substack.com-p-best-time-to-visit-japan-3eb25182.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "japan_unravelled");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("SubscribeSign in");
      expect(result.text).not.toContain("Trip Essentials");
      expect(result.text).not.toContain("Ready for more?");
      expect(result.text).not.toContain("Discussion about this post");
      // Preserve article advice content
      expect(result.text.toLowerCase()).toContain("japan");
      expect(result.text.toLowerCase()).toContain("september");
    }
  });

  it("should clean japan_unravelled getting around fixture", () => {
    const fixture = require("./__fixtures__/japan_unravelled/raw/japanunravelled.substack.com-p-how-to-get-around-japan-cb950aaf.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "japan_unravelled");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("SubscribeSign in");
      expect(result.text).not.toContain("Ready for more?");
      expect(result.text.toLowerCase()).toContain("japan");
    }
  });
});
// END_BLOCK_JAPAN_UNRAVELLED_FIXTURE_TESTS_M_SITES_PARSER_TEST_022

// START_BLOCK_JAPAN_GUIDE_FIXTURE_TESTS_M_SITES_PARSER_TEST_023
describe("M-SITES-PARSER-CLEANUP-ADAPTERS-JAPAN_GUIDE", () => {
  it("should clean japan_guide kyoto fixture", () => {
    const fixture = require("./__fixtures__/japan_guide/raw/japan-guide.com-e-e2158.html-2abc4b3d.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "japan_guide");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("Choose a destinationTokyo");
      expect(result.text).not.toContain("Sponsored Story");
      expect(result.text).not.toContain("Search stays");
      // Preserve practical info
      expect(result.text.toLowerCase()).toContain("kyoto");
      expect(result.text.toLowerCase()).toContain("temple");
    }
  });

  it("should clean japan_guide fushimi inari fixture", () => {
    const fixture = require("./__fixtures__/japan_guide/raw/japan-guide.com-e-e3915.html-27873f53.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "japan_guide");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("Choose a destinationTokyo");
      expect(result.text).not.toContain("Sponsored Story");
      expect(result.text.toLowerCase()).toContain("fushimi inari");
    }
  });
});
// END_BLOCK_JAPAN_GUIDE_FIXTURE_TESTS_M_SITES_PARSER_TEST_023

// START_BLOCK_NAVITIME_FIXTURE_TESTS_M_SITES_PARSER_TEST_024
describe("M-SITES-PARSER-CLEANUP-ADAPTERS-NAVITIME", () => {
  it("should clean navitime museum fixture", () => {
    const fixture = require("./__fixtures__/navitime/raw/japantravel.navitime.com-en-area-jp-guide-ntjtrv0699-en-475e6a09.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "navitime");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("検索ボックス");
      expect(result.text).not.toContain("JAPAN TRAVEL INSTAGRAM");
      expect(result.text).not.toContain("Premium Plan");
      // Preserve spot info
      expect(result.text.toLowerCase()).toContain("museum");
      expect(result.text.toLowerCase()).toContain("yamagata");
    }
  });

  it("should reject navitime 404 page fixture", () => {
    const fixture = require("./__fixtures__/navitime/raw/japantravel.navitime.com-en-area-jp-guide-ntjonry2528004-en-b47bb4c2.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "navitime");
    expect(result.accepted).toBe(false);
  });
});
// END_BLOCK_NAVITIME_FIXTURE_TESTS_M_SITES_PARSER_TEST_024

// START_BLOCK_JORUDAN_FIXTURE_TESTS_M_SITES_PARSER_TEST_025
describe("M-SITES-PARSER-CLEANUP-ADAPTERS-JORUDAN", () => {
  it("should reject jorudan JS redirect stub", () => {
    const fixture = require("./__fixtures__/jorudan/raw/world.jorudan.co.jp-mln-en-4abd19b1.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "jorudan");
    expect(result.accepted).toBe(false);
  });

  it("should accept jorudan FAQ page and preserve content", () => {
    const fixture = require("./__fixtures__/jorudan/raw/world.jorudan.co.jp-mln-en-faq-f121d970.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "jorudan");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      // Preserve FAQ content
      expect(result.text.toLowerCase()).toContain("japan transit planner");
      expect(result.text.toLowerCase()).toContain("english");
    }
  });
});
// END_BLOCK_JORUDAN_FIXTURE_TESTS_M_SITES_PARSER_TEST_025

// START_BLOCK_JREAST_FIXTURE_TESTS_M_SITES_PARSER_TEST_026
describe("M-SITES-PARSER-CLEANUP-ADAPTERS-JREAST", () => {
  it("should clean jreast multi fixture", () => {
    const fixture = require("./__fixtures__/jreast/raw/jreast.co.jp-en-multi-51d46a18.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "jreast");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("Reserve Today!");
      expect(result.text).not.toContain("Opens in a new window");
      // Preserve train/station info
      expect(result.text.toLowerCase()).toContain("train");
      expect(result.text.toLowerCase()).toContain("station");
    }
  });

  it("should clean jreast information center fixture", () => {
    const fixture = require("./__fixtures__/jreast/raw/jreast.co.jp-en-multi-customer_support-information_center.html-acf3a17e.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "jreast");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("Reserve Today!");
      expect(result.text.toLowerCase()).toContain("information");
    }
  });
});
// END_BLOCK_JREAST_FIXTURE_TESTS_M_SITES_PARSER_TEST_026

// START_BLOCK_SMART_EX_FIXTURE_TESTS_M_SITES_PARSER_TEST_027
describe("M-SITES-PARSER-CLEANUP-ADAPTERS-SMART_EX", () => {
  it("should clean smart_ex beginner fixture", () => {
    const fixture = require("./__fixtures__/smart_ex/raw/smart-ex.jp-en-beginner-d049b9ea.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "smart_ex");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("Download on the App Store");
      expect(result.text).not.toContain("GET IT ON Google Play");
      expect(result.text).not.toContain("Register Here");
      // Preserve Shinkansen info
      expect(result.text.toLowerCase()).toContain("shinkansen");
      expect(result.text.toLowerCase()).toContain("ticket");
    }
  });

  it("should clean smart_ex ticket place fixture", () => {
    const fixture = require("./__fixtures__/smart_ex/raw/smart-ex.jp-en-entraining-ticket-place-6e775076.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "smart_ex");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("Download on the App Store");
      expect(result.text).not.toContain("GET IT ON Google Play");
      expect(result.text.toLowerCase()).toContain("shinkansen");
    }
  });
});
// END_BLOCK_SMART_EX_FIXTURE_TESTS_M_SITES_PARSER_TEST_027

// START_BLOCK_REDDIT_JAPANTRAVEL_FIXTURE_TESTS_M_SITES_PARSER_TEST_028
describe("M-SITES-PARSER-CLEANUP-ADAPTERS-REDDIT_JAPANTRAVEL", () => {
  it("should clean reddit_japantravel 108 days fixture", () => {
    const fixture = require("./__fixtures__/reddit_japantravel/raw/reddit.com-r-japantravel-comments-1cwwfc0-i_spent_108_days_in_japan_and_this_is_what_i-e6a55dde.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "reddit_japantravel");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("Reddit - The heart of the internet");
      expect(result.text).not.toContain("Related Answers Section");
      expect(result.text).not.toContain("New to Reddit?");
      expect(result.text).not.toContain("Top Posts");
      // Preserve post title and body
      expect(result.text.toLowerCase()).toContain("108 days");
      expect(result.text.toLowerCase()).toContain("japan");
    }
  });

  it("should clean reddit_japantravel medical emergency fixture", () => {
    const fixture = require("./__fixtures__/reddit_japantravel/raw/reddit.com-r-japantravel-comments-12qlz68-my_experience_with_a_medical_emergency_in_japan-3f1b6f36.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "reddit_japantravel");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.text).not.toContain("New to Reddit?");
      expect(result.text).not.toContain("Top Posts");
      expect(result.text.toLowerCase()).toContain("japan");
    }
  });
});
// END_BLOCK_REDDIT_JAPANTRAVEL_FIXTURE_TESTS_M_SITES_PARSER_TEST_028

// START_BLOCK_PIPELINE_REGISTRY_INTEGRATION_TESTS_M_SITES_PARSER_TEST_029
describe("M-SITES-PARSER-CLEANUP-PIPELINE-REGISTRY-INTEGRATION", () => {
  it("pipeline routes insidekyoto through correct adapter", () => {
    const fixture = require("./__fixtures__/insidekyoto/raw/insidekyoto.com-kyoto-one-day-itinerary-bc6429fe.json");
    const raw: string = fixture.body[0].content;
    const result = runCleanupPipeline(raw, "insidekyoto");
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      // insidekyoto-specific noise should be removed (not just global cleanup)
      expect(result.text).not.toContain("Kyoto Vacation Checklist");
      expect(result.text).not.toContain("Kyoto District Map");
      expect(result.text).not.toContain("About InsideKyoto.com");
      expect(result.metrics.clean_char_count).toBeGreaterThan(MIN_CLEAN_CHARS);
    }
  });
});
// END_BLOCK_PIPELINE_REGISTRY_INTEGRATION_TESTS_M_SITES_PARSER_TEST_029
