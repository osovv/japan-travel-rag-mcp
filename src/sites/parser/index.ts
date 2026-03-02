// FILE: src/sites/parser/index.ts
// VERSION: 2.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Parse Spider crawl payload into canonical page records with layered content cleanup (global → source adapter → quality gate) and discriminated union output (accepted vs skipped).
//   SCOPE: URL normalization, title extraction, layered cleanup pipeline, SHA-256 hashing, and discriminated union output.
//   DEPENDS: M-SPIDER-CLOUD-CLIENT, M-LOGGER, M-SITES-PARSER-CLEANUP
//   LINKS: M-SITES-PARSER, M-SPIDER-CLOUD-CLIENT, M-LOGGER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ParsedPage - Canonical page record produced from a Spider crawl item.
//   SitesParserError - Typed error for parser failures with SITES_PARSER_ERROR code.
//   parseCrawlItem - Parse and normalize a single SpiderCrawlItem into a ParserResult (discriminated union).
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v2.0.0 - Integrate layered cleanup pipeline, change return type to ParserResult discriminated union, convert empty-content throw to structured skip.
// END_CHANGE_SUMMARY

import type { SpiderCrawlItem } from "../../integrations/spider-cloud-client";
import type { Logger } from "../../logger/index";
import { runCleanupPipeline } from "./cleanup/index";
import type { ParserResult } from "./cleanup/types";

// Re-export cleanup types for consumers
export type { ParserResult } from "./cleanup/types";
export type { CleanupMetrics, SkipReason } from "./cleanup/types";

// START_BLOCK_DEFINE_PARSED_PAGE_TYPE_M_SITES_PARSER_001
export type ParsedPage = {
  source_id: string;
  url: string;
  canonical_url: string;
  title: string;
  clean_text: string;
  text_hash: string;
  http_status: number;
  fetched_at: Date;
};
// END_BLOCK_DEFINE_PARSED_PAGE_TYPE_M_SITES_PARSER_001

// START_BLOCK_DEFINE_SITES_PARSER_ERROR_M_SITES_PARSER_002
export class SitesParserError extends Error {
  public readonly code: "SITES_PARSER_ERROR" = "SITES_PARSER_ERROR";
  public readonly details?: Record<string, unknown>;

  public constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SitesParserError";
    this.details = details;
  }
}
// END_BLOCK_DEFINE_SITES_PARSER_ERROR_M_SITES_PARSER_002

// START_CONTRACT: normalizeUrl
//   PURPOSE: Strip fragments, normalize trailing slashes, and lowercase hostname.
//   INPUTS: { raw: string - Raw URL from crawl item }
//   OUTPUTS: { string - Normalized URL }
//   SIDE_EFFECTS: [Throws SitesParserError on invalid URL]
//   LINKS: [M-SITES-PARSER]
// END_CONTRACT: normalizeUrl
function normalizeUrl(raw: string): string {
  // START_BLOCK_NORMALIZE_URL_M_SITES_PARSER_003
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SitesParserError("Invalid URL in crawl item.", { url: raw });
  }

  url.hash = "";

  // Lowercase hostname (URL constructor already lowercases, but be explicit)
  url.hostname = url.hostname.toLowerCase();

  // Normalize trailing slash: remove trailing slash from path unless it's the root "/"
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
  // END_BLOCK_NORMALIZE_URL_M_SITES_PARSER_003
}

// START_CONTRACT: extractTitle
//   PURPOSE: Extract page title from metadata, content headings, or URL path.
//   INPUTS: { metadata: SpiderCrawlItem["metadata"], content: string - Post-cleanup text, url: string - Raw URL for fallback }
//   OUTPUTS: { string - Extracted or derived title }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER]
// END_CONTRACT: extractTitle
function extractTitle(metadata: SpiderCrawlItem["metadata"], content: string, url: string): string {
  // START_BLOCK_EXTRACT_TITLE_M_SITES_PARSER_004

  // 1. Try metadata.title
  if (metadata?.title) {
    const metaTitle = String(metadata.title).trim();
    if (metaTitle.length > 0) {
      return metaTitle;
    }
  }

  // 2. Try first heading in content (markdown: # Heading)
  const headingMatch = content.match(/^#{1,6}\s+(.+)$/m);
  if (headingMatch?.[1]) {
    const headingText = headingMatch[1].trim();
    if (headingText.length > 0) {
      return headingText;
    }
  }

  // 3. Derive from URL path
  try {
    const parsedUrl = new URL(url);
    const pathSegments = parsedUrl.pathname
      .split("/")
      .filter((s) => s.length > 0);
    const lastSegment = pathSegments[pathSegments.length - 1];
    if (lastSegment) {
      // Remove file extension and replace hyphens/underscores with spaces
      return lastSegment
        .replace(/\.[^.]+$/, "")
        .replace(/[-_]/g, " ");
    }
    return parsedUrl.hostname;
  } catch {
    return "Untitled";
  }

  // END_BLOCK_EXTRACT_TITLE_M_SITES_PARSER_004
}

// Patterns that match common navigation/footer boilerplate lines
const BOILERPLATE_PATTERNS = [
  // Lines that are just navigation links like "Home | About | Contact"
  /^\s*(?:[A-Za-z]+\s*\|\s*){2,}[A-Za-z]+\s*$/,
  // Lines that are just "Skip to content" or similar
  /^\s*skip to (?:content|main|navigation)\s*$/i,
  // Lines that are just "Back to top"
  /^\s*back to top\s*$/i,
  // Lines like "Copyright (c) 2024" or "All rights reserved"
  /^\s*(?:copyright|©|\(c\))\s*\d{4}/i,
  /^\s*all rights reserved\.?\s*$/i,
];

// START_CONTRACT: cleanText
//   PURPOSE: Clean markdown content by removing residual HTML, normalizing whitespace, and stripping boilerplate.
//   INPUTS: { raw: string - Raw markdown content from Spider }
//   OUTPUTS: { string - Cleaned text ready for chunking }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER]
// END_CONTRACT: cleanText
function cleanText(raw: string): string {
  // START_BLOCK_CLEAN_TEXT_M_SITES_PARSER_005
  let text = raw;

  // Remove HTML tags if any remain
  text = text.replace(/<[^>]*>/g, "");

  // Filter out boilerplate lines
  const lines = text.split("\n");
  const filteredLines = lines.filter((line) => {
    return !BOILERPLATE_PATTERNS.some((pattern) => pattern.test(line));
  });
  text = filteredLines.join("\n");

  // Normalize excessive whitespace: 3+ newlines -> 2 newlines
  text = text.replace(/\n{3,}/g, "\n\n");

  // Trim leading/trailing whitespace
  text = text.trim();

  return text;
  // END_BLOCK_CLEAN_TEXT_M_SITES_PARSER_005
}

// START_CONTRACT: computeTextHash
//   PURPOSE: Compute SHA-256 hex digest of cleaned text using Bun's built-in crypto.
//   INPUTS: { text: string - Cleaned text content }
//   OUTPUTS: { string - Hex-encoded SHA-256 hash }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER]
// END_CONTRACT: computeTextHash
function computeTextHash(text: string): string {
  // START_BLOCK_COMPUTE_TEXT_HASH_M_SITES_PARSER_006
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
  // END_BLOCK_COMPUTE_TEXT_HASH_M_SITES_PARSER_006
}

// START_CONTRACT: parseCrawlItem
//   PURPOSE: Parse and normalize a Spider crawl item into a ParserResult discriminated union (accepted page or structured skip).
//   INPUTS: { item: SpiderCrawlItem - Raw crawl result, sourceId: string - Source identifier, logger: Logger - Module logger }
//   OUTPUTS: { ParserResult - Discriminated union: { status: "accepted", page } or { status: "skipped", reason, ... } }
//   SIDE_EFFECTS: [Logs warnings for explicit non-200 status codes, throws SitesParserError only on invalid URL]
//   LINKS: [M-SITES-PARSER, M-SPIDER-CLOUD-CLIENT, M-LOGGER]
// END_CONTRACT: parseCrawlItem
export function parseCrawlItem(
  item: SpiderCrawlItem,
  sourceId: string,
  logger: Logger,
): ParserResult {
  // START_BLOCK_VALIDATE_CRAWL_ITEM_INPUTS_M_SITES_PARSER_007
  const functionName = "parseCrawlItem";

  const rawUrl = (item.url ?? "").trim();
  if (!rawUrl) {
    throw new SitesParserError("Crawl item URL is empty.", {
      sourceId,
      url: item.url,
    });
  }

  const contentCandidates = [
    item.content,
    item.markdown,
    item.text,
    item.html,
  ];

  const rawContent = contentCandidates
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .find((value) => value.length > 0) ?? "";

  if (!rawContent) {
    const normalizedUrl = normalizeUrl(rawUrl);
    return {
      status: "skipped",
      reason: "EMPTY_CONTENT",
      source_id: sourceId,
      url: normalizedUrl,
    };
  }
  // END_BLOCK_VALIDATE_CRAWL_ITEM_INPUTS_M_SITES_PARSER_007

  // START_BLOCK_WARN_ON_NON_200_STATUS_M_SITES_PARSER_008
  if (typeof item.status_code === "number" && item.status_code !== 200) {
    logger.warn(
      `Crawl item has non-200 status code: ${item.status_code}.`,
      functionName,
      "WARN_ON_NON_200_STATUS",
      { url: rawUrl, statusCode: item.status_code, sourceId },
    );
  }
  // END_BLOCK_WARN_ON_NON_200_STATUS_M_SITES_PARSER_008

  // START_BLOCK_RUN_CLEANUP_PIPELINE_M_SITES_PARSER_010
  const normalizedUrl = normalizeUrl(rawUrl);

  const cleanupResult = runCleanupPipeline(rawContent, sourceId);

  if (cleanupResult.accepted === false) {
    return {
      status: "skipped",
      reason: cleanupResult.reason,
      source_id: sourceId,
      url: normalizedUrl,
      metrics: cleanupResult.metrics,
    };
  }
  // END_BLOCK_RUN_CLEANUP_PIPELINE_M_SITES_PARSER_010

  // START_BLOCK_BUILD_PARSED_PAGE_M_SITES_PARSER_009
  // Run legacy cleanText on the pipeline-accepted text for HTML tag removal and text-based boilerplate
  const cleanedText = cleanText(cleanupResult.text);
  const title = extractTitle(item.metadata, cleanedText, rawUrl);
  const textHash = computeTextHash(cleanedText);

  return {
    status: "accepted",
    page: {
      source_id: sourceId,
      url: normalizedUrl,
      canonical_url: normalizedUrl,
      title,
      clean_text: cleanedText,
      text_hash: textHash,
      http_status: item.status_code ?? 200,
      fetched_at: new Date(),
    },
  };
  // END_BLOCK_BUILD_PARSED_PAGE_M_SITES_PARSER_009
}
