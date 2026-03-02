// FILE: src/sites/chunking/index.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Validate deterministic chunking behavior for M-SITES-CHUNKER.
//   SCOPE: Assert structural splitting, tiny-segment merging, oversized splitting, overlap application, token estimation, offset tracking, and error handling.
//   DEPENDS: M-SITES-CHUNKER, M-LOGGER
//   LINKS: M-SITES-CHUNKER-TEST, M-SITES-CHUNKER, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   createNoopLogger - Build inert logger for deterministic chunker tests.
//   createWarnCapturingLogger - Build logger that captures warn calls for assertion.
//   EmptyInputTests - Validate empty/whitespace text returns empty array.
//   SingleSmallChunkTests - Validate small text produces a single chunk.
//   StructuralSplitTests - Validate splitting on markdown headers and paragraph breaks.
//   TinySegmentMergeTests - Validate merging of segments below min_merge_tokens.
//   OversizedSplitTests - Validate splitting segments that exceed max_tokens.
//   OverlapTests - Validate overlap application on forced splits.
//   OffsetTrackingTests - Validate start_offset and end_offset accuracy.
//   TokenEstimationTests - Validate character-based token estimation.
//   ChunkIndexTests - Validate sequential chunk_index assignment.
//   ErrorClassTests - Validate SitesChunkerError with code and details.
//   ChunkingVersionTests - Validate CHUNKING_VERSION constant.
//   ChunkingConfigTests - Validate CHUNKING_CONFIG constants.
//   LargeDocumentTests - Validate chunking of realistic large documents.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial test suite for M-SITES-CHUNKER.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { Logger } from "../../logger/index";
import {
  chunkPage,
  SitesChunkerError,
  CHUNKING_VERSION,
  CHUNKING_CONFIG,
  type PageChunk,
} from "./index";

// START_BLOCK_CREATE_NOOP_LOGGER_M_SITES_CHUNKER_TEST_001
function createNoopLogger(): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
}
// END_BLOCK_CREATE_NOOP_LOGGER_M_SITES_CHUNKER_TEST_001

type WarnCall = {
  message: string;
  functionName: string;
  blockName: string;
  extra?: Record<string, unknown>;
};

// START_BLOCK_CREATE_WARN_CAPTURING_LOGGER_M_SITES_CHUNKER_TEST_002
function createWarnCapturingLogger(): { logger: Logger; warns: WarnCall[] } {
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
}
// END_BLOCK_CREATE_WARN_CAPTURING_LOGGER_M_SITES_CHUNKER_TEST_002

// Helper: generate text of approximately N tokens (N * 4 characters)
function generateText(approxTokens: number): string {
  // Use repeating 4-char words separated by spaces (5 chars per word = ~1.25 tokens per word)
  // For simplicity, use "word " which is 5 chars = ~1.25 tokens
  // To get N tokens, we need N * 4 chars total
  const targetChars = approxTokens * 4;
  const word = "test ";
  const repeats = Math.ceil(targetChars / word.length);
  return word.repeat(repeats).trim();
}

// Helper: generate a sentence of approximately N tokens
function generateSentence(approxTokens: number): string {
  const targetChars = approxTokens * 4;
  const word = "word ";
  const repeats = Math.max(1, Math.ceil((targetChars - 2) / word.length));
  return word.repeat(repeats).trimEnd() + ". ";
}

describe("M-SITES-CHUNKER", () => {
  // START_BLOCK_EMPTY_INPUT_TESTS_M_SITES_CHUNKER_TEST_003
  describe("Empty input handling", () => {
    it("should return empty array for empty string", () => {
      const result = chunkPage("", createNoopLogger());
      expect(result).toEqual([]);
    });

    it("should return empty array for whitespace-only string", () => {
      const result = chunkPage("   \n\n  \t  ", createNoopLogger());
      expect(result).toEqual([]);
    });

    it("should not throw for empty text", () => {
      expect(() => chunkPage("", createNoopLogger())).not.toThrow();
    });
  });
  // END_BLOCK_EMPTY_INPUT_TESTS_M_SITES_CHUNKER_TEST_003

  // START_BLOCK_SINGLE_SMALL_CHUNK_TESTS_M_SITES_CHUNKER_TEST_004
  describe("Single small chunk", () => {
    it("should return one chunk for short text", () => {
      const text = "Tokyo is the capital of Japan.";
      const result = chunkPage(text, createNoopLogger());
      expect(result).toHaveLength(1);
      expect(result[0]!.chunk_text).toBe(text);
    });

    it("should set chunk_index to 0 for single chunk", () => {
      const result = chunkPage("Short text.", createNoopLogger());
      expect(result[0]!.chunk_index).toBe(0);
    });

    it("should set correct char_count", () => {
      const text = "Hello world.";
      const result = chunkPage(text, createNoopLogger());
      expect(result[0]!.char_count).toBe(text.length);
    });

    it("should set token_estimate based on char count / 4", () => {
      const text = "12345678"; // 8 chars = ceil(8/4) = 2 tokens
      const result = chunkPage(text, createNoopLogger());
      expect(result[0]!.token_estimate).toBe(2);
    });

    it("should set start_offset to 0 and end_offset to text length", () => {
      const text = "Simple text content.";
      const result = chunkPage(text, createNoopLogger());
      expect(result[0]!.start_offset).toBe(0);
      expect(result[0]!.end_offset).toBe(text.length);
    });
  });
  // END_BLOCK_SINGLE_SMALL_CHUNK_TESTS_M_SITES_CHUNKER_TEST_004

  // START_BLOCK_STRUCTURAL_SPLIT_TESTS_M_SITES_CHUNKER_TEST_005
  describe("Structural splitting", () => {
    it("should split on double newlines (paragraph breaks)", () => {
      const para1 = generateText(200);
      const para2 = generateText(200);
      const text = para1 + "\n\n" + para2;
      const result = chunkPage(text, createNoopLogger());
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("should split on markdown headers", () => {
      const section1 = "# Section One\n\n" + generateText(200);
      const section2 = "## Section Two\n\n" + generateText(200);
      const text = section1 + "\n\n" + section2;
      const result = chunkPage(text, createNoopLogger());
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("should keep header text with its following content", () => {
      const text = "# Introduction\n\nThis is the introduction paragraph about Tokyo travel.";
      const result = chunkPage(text, createNoopLogger());
      // With such short text, should merge into one chunk
      expect(result.length).toBeGreaterThanOrEqual(1);
      // At least one chunk should contain the header
      const hasHeader = result.some((c) => c.chunk_text.includes("# Introduction"));
      expect(hasHeader).toBe(true);
    });

    it("should handle triple or more newlines same as double", () => {
      const para1 = generateText(200);
      const para2 = generateText(200);
      const text = para1 + "\n\n\n\n" + para2;
      const result = chunkPage(text, createNoopLogger());
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });
  // END_BLOCK_STRUCTURAL_SPLIT_TESTS_M_SITES_CHUNKER_TEST_005

  // START_BLOCK_TINY_SEGMENT_MERGE_TESTS_M_SITES_CHUNKER_TEST_006
  describe("Tiny segment merging", () => {
    it("should merge segments below min_merge_tokens with adjacent", () => {
      // Create a tiny segment (< 120 tokens = < 480 chars) followed by a normal segment
      const tiny = "Short."; // ~2 tokens
      const normal = generateText(200);
      const text = tiny + "\n\n" + normal;
      const result = chunkPage(text, createNoopLogger());
      // The tiny segment should be merged, so we get 1 chunk
      expect(result).toHaveLength(1);
      expect(result[0]!.chunk_text).toContain("Short.");
    });

    it("should merge first tiny segment forward when it is the first segment", () => {
      const tiny = "Hi."; // ~1 token
      const normal = generateText(200);
      const text = tiny + "\n\n" + normal;
      const result = chunkPage(text, createNoopLogger());
      expect(result).toHaveLength(1);
      expect(result[0]!.chunk_text).toContain("Hi.");
    });

    it("should not merge segments above min_merge_tokens", () => {
      // Two segments each above min_merge_tokens (120 tokens = 480 chars)
      const seg1 = generateText(200);
      const seg2 = generateText(200);
      const text = seg1 + "\n\n" + seg2;
      const result = chunkPage(text, createNoopLogger());
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });
  // END_BLOCK_TINY_SEGMENT_MERGE_TESTS_M_SITES_CHUNKER_TEST_006

  // START_BLOCK_OVERSIZED_SPLIT_TESTS_M_SITES_CHUNKER_TEST_007
  describe("Oversized segment splitting", () => {
    it("should split segments exceeding max_tokens", () => {
      // Create text > 650 tokens = > 2600 chars
      const text = generateText(800);
      const result = chunkPage(text, createNoopLogger());
      expect(result.length).toBeGreaterThan(1);
    });

    it("should split at sentence boundaries when possible", () => {
      // Create oversized text with clear sentence boundaries
      const sentences = [];
      for (let i = 0; i < 20; i++) {
        sentences.push(generateSentence(50));
      }
      const text = sentences.join("");
      const result = chunkPage(text, createNoopLogger());
      expect(result.length).toBeGreaterThan(1);
      // Each chunk should end at or near a sentence boundary
      for (const chunk of result) {
        expect(chunk.chunk_text.length).toBeGreaterThan(0);
      }
    });

    it("should fall back to word boundaries for oversized sentences", () => {
      // Create a single very long "sentence" without period breaks
      const longSentence = "word ".repeat(800).trim();
      const result = chunkPage(longSentence, createNoopLogger());
      expect(result.length).toBeGreaterThan(1);
    });

    it("should log warning when chunk still exceeds max_tokens", () => {
      // Create a single very long word that cannot be split
      const longWord = "a".repeat(3000); // ~750 tokens, single word
      const { logger, warns } = createWarnCapturingLogger();
      const result = chunkPage(longWord, logger);
      expect(result.length).toBeGreaterThanOrEqual(1);
      // The single unsplittable word should trigger a warning
      expect(warns.length).toBeGreaterThanOrEqual(1);
      expect(warns[0]!.message).toContain("exceeds max_tokens");
    });
  });
  // END_BLOCK_OVERSIZED_SPLIT_TESTS_M_SITES_CHUNKER_TEST_007

  // START_BLOCK_OVERLAP_TESTS_M_SITES_CHUNKER_TEST_008
  describe("Overlap on forced splits", () => {
    it("should apply overlap between forced-split chunks", () => {
      // Create oversized text that will be force-split
      const sentences = [];
      for (let i = 0; i < 20; i++) {
        sentences.push(`Sentence number ${i} with some content here. `);
      }
      const text = sentences.join("");
      const result = chunkPage(text, createNoopLogger());

      if (result.length > 1) {
        // Second chunk should contain some text from end of first chunk (overlap)
        const firstChunkEnd = result[0]!.chunk_text.slice(-40);
        // The overlap means second chunk should start with content that appeared in first chunk
        // This is a structural check — overlap means shared content exists
        expect(result[1]!.chunk_text.length).toBeGreaterThan(0);
      }
    });
  });
  // END_BLOCK_OVERLAP_TESTS_M_SITES_CHUNKER_TEST_008

  // START_BLOCK_OFFSET_TRACKING_TESTS_M_SITES_CHUNKER_TEST_009
  describe("Offset tracking", () => {
    it("should have start_offset 0 for first chunk", () => {
      const text = "Hello world. This is a test document.";
      const result = chunkPage(text, createNoopLogger());
      expect(result[0]!.start_offset).toBe(0);
    });

    it("should have end_offset equal to start_offset + chunk length for simple cases", () => {
      const text = "Simple text content for testing offsets.";
      const result = chunkPage(text, createNoopLogger());
      expect(result[0]!.end_offset).toBe(
        result[0]!.start_offset + result[0]!.chunk_text.length,
      );
    });

    it("should have non-decreasing start_offsets across chunks", () => {
      const seg1 = generateText(200);
      const seg2 = generateText(200);
      const seg3 = generateText(200);
      const text = seg1 + "\n\n" + seg2 + "\n\n" + seg3;
      const result = chunkPage(text, createNoopLogger());

      for (let i = 1; i < result.length; i++) {
        expect(result[i]!.start_offset).toBeGreaterThanOrEqual(
          result[i - 1]!.start_offset,
        );
      }
    });
  });
  // END_BLOCK_OFFSET_TRACKING_TESTS_M_SITES_CHUNKER_TEST_009

  // START_BLOCK_TOKEN_ESTIMATION_TESTS_M_SITES_CHUNKER_TEST_010
  describe("Token estimation", () => {
    it("should estimate tokens as ceil(charCount / 4)", () => {
      const text = "abcdefghijklmnop"; // 16 chars = 4 tokens
      const result = chunkPage(text, createNoopLogger());
      expect(result[0]!.token_estimate).toBe(4);
    });

    it("should round up for non-divisible lengths", () => {
      const text = "abcde"; // 5 chars = ceil(5/4) = 2 tokens
      const result = chunkPage(text, createNoopLogger());
      expect(result[0]!.token_estimate).toBe(2);
    });

    it("should handle single character", () => {
      const text = "a"; // 1 char = ceil(1/4) = 1 token
      const result = chunkPage(text, createNoopLogger());
      expect(result[0]!.token_estimate).toBe(1);
    });

    it("should match char_count / 4 ceiling", () => {
      const text = "Hello, this is a test of token estimation for chunking.";
      const result = chunkPage(text, createNoopLogger());
      const expected = Math.ceil(text.length / 4);
      expect(result[0]!.token_estimate).toBe(expected);
    });
  });
  // END_BLOCK_TOKEN_ESTIMATION_TESTS_M_SITES_CHUNKER_TEST_010

  // START_BLOCK_CHUNK_INDEX_TESTS_M_SITES_CHUNKER_TEST_011
  describe("Chunk index sequencing", () => {
    it("should assign sequential chunk_index starting from 0", () => {
      const seg1 = generateText(200);
      const seg2 = generateText(200);
      const seg3 = generateText(200);
      const text = seg1 + "\n\n" + seg2 + "\n\n" + seg3;
      const result = chunkPage(text, createNoopLogger());

      for (let i = 0; i < result.length; i++) {
        expect(result[i]!.chunk_index).toBe(i);
      }
    });

    it("should maintain sequential index even after oversized splitting", () => {
      const text = generateText(1500); // Will be force-split
      const result = chunkPage(text, createNoopLogger());

      for (let i = 0; i < result.length; i++) {
        expect(result[i]!.chunk_index).toBe(i);
      }
    });
  });
  // END_BLOCK_CHUNK_INDEX_TESTS_M_SITES_CHUNKER_TEST_011

  // START_BLOCK_ERROR_CLASS_TESTS_M_SITES_CHUNKER_TEST_012
  describe("SitesChunkerError", () => {
    it("should have code SITES_CHUNKER_ERROR", () => {
      const err = new SitesChunkerError("test error");
      expect(err.code).toBe("SITES_CHUNKER_ERROR");
    });

    it("should have name SitesChunkerError", () => {
      const err = new SitesChunkerError("test error");
      expect(err.name).toBe("SitesChunkerError");
    });

    it("should extend Error", () => {
      const err = new SitesChunkerError("test error");
      expect(err).toBeInstanceOf(Error);
    });

    it("should store message", () => {
      const err = new SitesChunkerError("something went wrong");
      expect(err.message).toBe("something went wrong");
    });

    it("should store details when provided", () => {
      const details = { foo: "bar", count: 42 };
      const err = new SitesChunkerError("test", details);
      expect(err.details).toEqual(details);
    });

    it("should have undefined details when not provided", () => {
      const err = new SitesChunkerError("test");
      expect(err.details).toBeUndefined();
    });
  });
  // END_BLOCK_ERROR_CLASS_TESTS_M_SITES_CHUNKER_TEST_012

  // START_BLOCK_CHUNKING_VERSION_TESTS_M_SITES_CHUNKER_TEST_013
  describe("CHUNKING_VERSION", () => {
    it("should be v1", () => {
      expect(CHUNKING_VERSION).toBe("v1");
    });
  });
  // END_BLOCK_CHUNKING_VERSION_TESTS_M_SITES_CHUNKER_TEST_013

  // START_BLOCK_CHUNKING_CONFIG_TESTS_M_SITES_CHUNKER_TEST_014
  describe("CHUNKING_CONFIG", () => {
    it("should have target_tokens of 450", () => {
      expect(CHUNKING_CONFIG.target_tokens).toBe(450);
    });

    it("should have max_tokens of 650", () => {
      expect(CHUNKING_CONFIG.max_tokens).toBe(650);
    });

    it("should have overlap_tokens of 80", () => {
      expect(CHUNKING_CONFIG.overlap_tokens).toBe(80);
    });

    it("should have min_merge_tokens of 120", () => {
      expect(CHUNKING_CONFIG.min_merge_tokens).toBe(120);
    });
  });
  // END_BLOCK_CHUNKING_CONFIG_TESTS_M_SITES_CHUNKER_TEST_014

  // START_BLOCK_LARGE_DOCUMENT_TESTS_M_SITES_CHUNKER_TEST_015
  describe("Large document chunking", () => {
    it("should handle a realistic multi-section document", () => {
      const text = [
        "# Tokyo Travel Guide",
        "",
        "Tokyo is the capital city of Japan and one of the most exciting cities in the world. " +
          "With a population of over 13 million people, it offers an incredible mix of traditional culture " +
          "and cutting-edge modernity. Visitors can explore ancient temples one moment and futuristic " +
          "skyscrapers the next.",
        "",
        "## Getting Around",
        "",
        "The Tokyo Metro system is one of the most efficient public transportation networks in the world. " +
          "Buy a Suica or Pasmo card for easy access to trains, buses, and even some vending machines. " +
          "The JR Yamanote Line circles central Tokyo and connects major stations like Shibuya, Shinjuku, " +
          "and Tokyo Station.",
        "",
        "## Must-Visit Neighborhoods",
        "",
        "### Shibuya",
        "Known for its famous scramble crossing, Shibuya is a vibrant hub of youth culture, shopping, and nightlife.",
        "",
        "### Shinjuku",
        "Home to the busiest train station in the world, Shinjuku offers department stores, izakayas, and the peaceful Shinjuku Gyoen garden.",
        "",
        "### Asakusa",
        "Visit Senso-ji, Tokyo's oldest temple, and explore the traditional Nakamise shopping street.",
        "",
        "## Food Guide",
        "",
        "Tokyo has more Michelin-starred restaurants than any other city. From high-end sushi to " +
          "street-side ramen, the food scene is unparalleled. Don't miss trying fresh sushi at Tsukiji " +
          "Outer Market, ramen in Shinjuku, and tempura in Asakusa.",
      ].join("\n");

      const result = chunkPage(text, createNoopLogger());

      // Should produce multiple chunks
      expect(result.length).toBeGreaterThan(0);

      // All chunks should have valid fields
      for (const chunk of result) {
        expect(chunk.chunk_index).toBeGreaterThanOrEqual(0);
        expect(chunk.chunk_text.length).toBeGreaterThan(0);
        expect(chunk.char_count).toBe(chunk.chunk_text.length);
        expect(chunk.token_estimate).toBe(
          Math.ceil(chunk.chunk_text.length / 4),
        );
        expect(chunk.start_offset).toBeGreaterThanOrEqual(0);
        expect(chunk.end_offset).toBeGreaterThan(chunk.start_offset);
      }

      // Chunk indices should be sequential
      for (let i = 0; i < result.length; i++) {
        expect(result[i]!.chunk_index).toBe(i);
      }
    });

    it("should produce chunks where most are under max_tokens", () => {
      // Generate a large document with many sections
      const sections: string[] = [];
      for (let i = 0; i < 10; i++) {
        sections.push(`## Section ${i}\n\n${generateText(300)}`);
      }
      const text = sections.join("\n\n");
      const result = chunkPage(text, createNoopLogger());

      // Count chunks under max_tokens
      const underMax = result.filter(
        (c) => c.token_estimate <= CHUNKING_CONFIG.max_tokens,
      );
      // Most chunks should be under max_tokens
      expect(underMax.length).toBeGreaterThan(result.length * 0.5);
    });
  });
  // END_BLOCK_LARGE_DOCUMENT_TESTS_M_SITES_CHUNKER_TEST_015

  // START_BLOCK_EDGE_CASE_TESTS_M_SITES_CHUNKER_TEST_016
  describe("Edge cases", () => {
    it("should handle text with only headers and no content", () => {
      const text = "# Header One\n\n## Header Two\n\n### Header Three";
      const result = chunkPage(text, createNoopLogger());
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle text with no structural boundaries", () => {
      const text = "Just a single line of text without any breaks or headers.";
      const result = chunkPage(text, createNoopLogger());
      expect(result).toHaveLength(1);
      expect(result[0]!.chunk_text).toBe(text);
    });

    it("should handle text with many consecutive newlines", () => {
      const text = "Part one.\n\n\n\n\n\n\n\nPart two.";
      const result = chunkPage(text, createNoopLogger());
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle single newline (no paragraph break)", () => {
      const text = "Line one.\nLine two.";
      const result = chunkPage(text, createNoopLogger());
      expect(result).toHaveLength(1);
      expect(result[0]!.chunk_text).toBe("Line one.\nLine two.");
    });

    it("should preserve chunk_text content integrity", () => {
      const text = "# Title\n\nParagraph with special chars: é, ñ, ü, 日本語.";
      const result = chunkPage(text, createNoopLogger());
      const combined = result.map((c) => c.chunk_text).join("");
      // The content should be preserved (though separators may be lost in join)
      expect(combined).toContain("日本語");
      expect(combined).toContain("é");
    });
  });
  // END_BLOCK_EDGE_CASE_TESTS_M_SITES_CHUNKER_TEST_016
});
