// FILE: src/sites/parser/index.test.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate deterministic parsing behavior for M-SITES-PARSER.
//   SCOPE: Assert URL normalization, title extraction, text cleaning, SHA-256 hashing, error handling, and non-200 status warnings.
//   DEPENDS: M-SITES-PARSER, M-SPIDER-CLOUD-CLIENT, M-LOGGER
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
//   ErrorHandlingTests - Validate SitesParserError on empty URL or content.
//   NonOkStatusTests - Validate warn logging on non-200 status codes.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Added coverage that undefined status_code does not emit non-200 warning.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { Logger } from "../../logger/index";
import type { SpiderCrawlItem } from "../../integrations/spider-cloud-client";
import { parseCrawlItem, SitesParserError, type ParsedPage } from "./index";

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
    content: "# Tokyo Guide\n\nTokyo is the capital of Japan.\n\nVisit Shibuya for great food.",
    status_code: 200,
    metadata: {
      title: "Tokyo Travel Guide",
    },
    ...overrides,
  };
  // END_BLOCK_BUILD_CRAWL_ITEM_FIXTURE_M_SITES_PARSER_TEST_003
}

const TEST_SOURCE_ID = "src-001";

describe("M-SITES-PARSER", () => {
  // START_BLOCK_URL_NORMALIZATION_TESTS_M_SITES_PARSER_TEST_004
  describe("URL normalization", () => {
    it("should strip URL fragments", () => {
      const item = makeCrawlItem({ url: "https://example.com/page#section-1" });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.url).toBe("https://example.com/page");
      expect(result.canonical_url).toBe("https://example.com/page");
    });

    it("should remove trailing slashes from non-root paths", () => {
      const item = makeCrawlItem({ url: "https://example.com/page/" });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.url).toBe("https://example.com/page");
    });

    it("should preserve trailing slash for root path", () => {
      const item = makeCrawlItem({ url: "https://example.com/" });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.url).toBe("https://example.com/");
    });

    it("should lowercase hostname", () => {
      const item = makeCrawlItem({ url: "https://EXAMPLE.COM/Page" });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.url).toBe("https://example.com/Page");
    });

    it("should preserve query parameters", () => {
      const item = makeCrawlItem({ url: "https://example.com/search?q=tokyo&lang=en" });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.url).toBe("https://example.com/search?q=tokyo&lang=en");
    });

    it("should set canonical_url equal to normalized url", () => {
      const item = makeCrawlItem({ url: "https://example.com/page#frag" });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.canonical_url).toBe(result.url);
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
      expect(result.title).toBe("My Custom Title");
    });

    it("should fall back to first markdown heading when metadata title is missing", () => {
      const item = makeCrawlItem({
        metadata: {},
        content: "Some intro text.\n\n# Welcome to Japan\n\nMore content here.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.title).toBe("Welcome to Japan");
    });

    it("should handle h2-h6 heading levels", () => {
      const item = makeCrawlItem({
        metadata: {},
        content: "Intro.\n\n## Second Level Heading\n\nContent.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.title).toBe("Second Level Heading");
    });

    it("should fall back to URL path when no heading exists", () => {
      const item = makeCrawlItem({
        url: "https://example.com/travel/tokyo-guide",
        metadata: {},
        content: "Just plain text without headings.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.title).toBe("tokyo guide");
    });

    it("should strip file extensions from URL path title", () => {
      const item = makeCrawlItem({
        url: "https://example.com/pages/about-us.html",
        metadata: {},
        content: "Plain text.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.title).toBe("about us");
    });

    it("should use hostname when URL path is root", () => {
      const item = makeCrawlItem({
        url: "https://example.com/",
        metadata: {},
        content: "Root page content.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.title).toBe("example.com");
    });

    it("should skip empty metadata title and use heading", () => {
      const item = makeCrawlItem({
        metadata: { title: "   " },
        content: "# Real Title\n\nContent.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.title).toBe("Real Title");
    });
  });
  // END_BLOCK_TITLE_EXTRACTION_TESTS_M_SITES_PARSER_TEST_005

  // START_BLOCK_TEXT_CLEANING_TESTS_M_SITES_PARSER_TEST_006
  describe("Text cleaning", () => {
    it("should remove residual HTML tags", () => {
      const item = makeCrawlItem({
        content: "# Title\n\n<div>Some <b>bold</b> text</div> and more.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.clean_text).not.toContain("<div>");
      expect(result.clean_text).not.toContain("<b>");
      expect(result.clean_text).not.toContain("</b>");
      expect(result.clean_text).not.toContain("</div>");
      expect(result.clean_text).toContain("Some bold text");
    });

    it("should normalize excessive newlines (3+ -> 2)", () => {
      const item = makeCrawlItem({
        content: "# Title\n\n\n\n\nParagraph one.\n\n\n\nParagraph two.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      // Should not have more than 2 consecutive newlines
      expect(result.clean_text).not.toMatch(/\n{3,}/);
      expect(result.clean_text).toContain("# Title\n\nParagraph one.\n\nParagraph two.");
    });

    it("should trim leading and trailing whitespace", () => {
      const item = makeCrawlItem({
        content: "   \n\n  # Title\n\nContent.\n\n   ",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.clean_text).toBe("# Title\n\nContent.");
    });

    it("should remove navigation boilerplate lines", () => {
      const item = makeCrawlItem({
        content: "Home | About | Contact\n\n# Real Content\n\nText here.\n\nSkip to content",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.clean_text).not.toContain("Home | About | Contact");
      expect(result.clean_text).not.toContain("Skip to content");
      expect(result.clean_text).toContain("# Real Content");
    });

    it("should remove copyright boilerplate lines", () => {
      const item = makeCrawlItem({
        content: "# Title\n\nContent.\n\nCopyright 2024 Example Corp.\n\nAll rights reserved.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.clean_text).not.toContain("Copyright 2024");
      expect(result.clean_text).not.toContain("All rights reserved.");
    });

    it("should remove 'Back to top' lines", () => {
      const item = makeCrawlItem({
        content: "# Title\n\nContent.\n\nBack to top",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.clean_text).not.toContain("Back to top");
    });

    it("should preserve normal content lines", () => {
      const item = makeCrawlItem({
        content: "# Tokyo Guide\n\nTokyo is the capital of Japan.\n\nVisit Shibuya for great food.",
      });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.clean_text).toBe("# Tokyo Guide\n\nTokyo is the capital of Japan.\n\nVisit Shibuya for great food.");
    });
  });
  // END_BLOCK_TEXT_CLEANING_TESTS_M_SITES_PARSER_TEST_006

  // START_BLOCK_TEXT_HASH_TESTS_M_SITES_PARSER_TEST_007
  describe("Text hash", () => {
    it("should produce a 64-character hex SHA-256 hash", () => {
      const item = makeCrawlItem();
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.text_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should produce identical hashes for identical cleaned text", () => {
      const item1 = makeCrawlItem({ content: "# Test\n\nContent here." });
      const item2 = makeCrawlItem({ content: "# Test\n\nContent here." });
      const result1 = parseCrawlItem(item1, TEST_SOURCE_ID, createNoopLogger());
      const result2 = parseCrawlItem(item2, TEST_SOURCE_ID, createNoopLogger());
      expect(result1.text_hash).toBe(result2.text_hash);
    });

    it("should produce different hashes for different content", () => {
      const item1 = makeCrawlItem({ content: "# Test\n\nContent A." });
      const item2 = makeCrawlItem({ content: "# Test\n\nContent B." });
      const result1 = parseCrawlItem(item1, TEST_SOURCE_ID, createNoopLogger());
      const result2 = parseCrawlItem(item2, TEST_SOURCE_ID, createNoopLogger());
      expect(result1.text_hash).not.toBe(result2.text_hash);
    });

    it("should hash the cleaned text, not the raw content", () => {
      // Two items with same meaningful text but different boilerplate
      const item1 = makeCrawlItem({
        content: "# Guide\n\nMain content.",
      });
      const item2 = makeCrawlItem({
        content: "Home | About | Contact\n\n# Guide\n\nMain content.\n\nBack to top",
      });
      const result1 = parseCrawlItem(item1, TEST_SOURCE_ID, createNoopLogger());
      const result2 = parseCrawlItem(item2, TEST_SOURCE_ID, createNoopLogger());
      expect(result1.text_hash).toBe(result2.text_hash);
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

    it("should throw SitesParserError when content is empty", () => {
      const item = makeCrawlItem({ content: "" });
      expect(() =>
        parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger()),
      ).toThrow(SitesParserError);
    });

    it("should throw SitesParserError when content is whitespace only", () => {
      const item = makeCrawlItem({ content: "   " });
      expect(() =>
        parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger()),
      ).toThrow(SitesParserError);
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
      expect(result.http_status).toBe(404);
      expect(result.clean_text.length).toBeGreaterThan(0);
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
      expect(result.source_id).toBe("my-source");
    });

    it("should set http_status from item.status_code", () => {
      const item = makeCrawlItem({ status_code: 200 });
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.http_status).toBe(200);
    });

    it("should default http_status to 200 when status_code is undefined", () => {
      const item = makeCrawlItem();
      (item as Record<string, unknown>).status_code = undefined;
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result.http_status).toBe(200);
    });

    it("should set fetched_at to a recent Date", () => {
      const before = new Date();
      const item = makeCrawlItem();
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      const after = new Date();
      expect(result.fetched_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.fetched_at.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should return all required ParsedPage fields", () => {
      const item = makeCrawlItem();
      const result = parseCrawlItem(item, TEST_SOURCE_ID, createNoopLogger());
      expect(result).toHaveProperty("source_id");
      expect(result).toHaveProperty("url");
      expect(result).toHaveProperty("canonical_url");
      expect(result).toHaveProperty("title");
      expect(result).toHaveProperty("clean_text");
      expect(result).toHaveProperty("text_hash");
      expect(result).toHaveProperty("http_status");
      expect(result).toHaveProperty("fetched_at");
    });
  });
  // END_BLOCK_FULL_PARSE_INTEGRATION_TESTS_M_SITES_PARSER_TEST_010
});
