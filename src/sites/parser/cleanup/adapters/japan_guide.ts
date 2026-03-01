// FILE: src/sites/parser/cleanup/adapters/japan_guide.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Source-specific cleanup adapter (Layer B) for japan-guide.com content.
//   SCOPE: Remove duplicated booking widgets, sponsored/ad link blocks, site navigation tree,
//          rating/ranking metadata, empty images, banner ads, feedback form, external booking
//          links, garbled Shift-JIS characters, forum links, timestamps, and survey/poll content.
//   DEPENDS: M-CLEANUP-COMMON, M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-ADAPTER-JAPAN_GUIDE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   BOOKING_WIDGET_RE - Regex matching the booking widget block (City: ... Search stays).
//   SPONSORED_BLOCK_RE - Regex matching sponsored/travel news link blocks.
//   FEEDBACK_FORM_RE - Regex matching the feedback form block.
//   GARBLED_SJIS_RE - Regex matching garbled Shift-JIS character sequences.
//   SURVEY_OPTIONS_RE - Regex matching survey/poll option lines.
//   FORUM_DISCUSSION_BLOCK_RE - Regex matching forum discussion link blocks.
//   stripTextBlocks - Remove text-level block patterns via global regex replacements.
//   stripLineNoise - Filter lines matching noise patterns (empty images, banner ads, nav tree, etc).
//   clean - Main cleanup function removing all japan-guide-specific noise.
//   japanGuideAdapter - Exported SourceAdapter constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial japan_guide adapter for Phase-12 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

import type { SourceAdapter } from "../types";
import { stripSvgPlaceholders, normalizeCleanupWhitespace } from "../common";

// START_BLOCK_DEFINE_TEXT_PATTERNS_M_ADAPTER_JAPAN_GUIDE_001

/**
 * Booking widget block: starts with "City:\n" followed by "Choose a destination" and
 * concatenated city names, ends at "Search stays". Appears 2x per page.
 */
const BOOKING_WIDGET_RE =
  /City:\nChoose a destination[\s\S]*?Search stays/g;

/**
 * Sponsored / Travel News / Featured Story link blocks.
 * Pattern: `[\n## Title\nType\n![]()\n](url)` or `[\n## Title\nType\n](url)`
 * (the `![]()` line may already be stripped by SVG placeholder removal)
 * where Type is Travel News, Sponsored Story, Featured Story, Advertiser content,
 * Travel Report, Autumn Colors, Cherry Blossoms, etc.
 */
const SPONSORED_BLOCK_RE =
  /\[\n## [^\n]+\n(?:Travel (?:News|Report)|Sponsored Story|Featured Story|Advertiser content|Autumn Colors|Cherry Blossoms)[^\n]*\n(?:!\[\]\(\)\n)?\]\([^\n]+\)/g;

/**
 * Feedback form block: starts with "Anything we can improve?" and ends at
 * "Thank you for your feedback."
 */
const FEEDBACK_FORM_RE =
  /Anything we can improve\?\nLet us know[\s\S]*?\*\*Thank you for your feedback\.\*\*/g;

/**
 * Garbled Shift-JIS characters: sequences of 3+ characters from the garbled charset.
 * These appear where Japanese characters were mis-decoded from Shift-JIS.
 * Example: •šŒ©ˆî‰×'åŽÐ (should be 伏見稲荷大社)
 *
 * The charset covers: Latin-1 Supplement (U+0080-00FF), Latin Extended-A/B (Œ,š,Ž etc),
 * Modifier Letters (ˆ,˜), Cyrillic (U+0400-04FF, garbled kanji often renders as Cyrillic),
 * common typographic symbols (bullets, dashes, quotes, daggers, per-mille, euro, TM),
 * and math symbols (√) that appear in garbled output.
 *
 * Conservative: require 3+ consecutive chars, and allow ASCII apostrophe (') in the middle
 * of a garbled run since Shift-JIS multi-byte sequences often produce ' between garbled chars.
 */
const GARBLED_SJIS_RE =
  /(?:[\u0080-\u00ff\u0152\u0153\u0160\u0161\u017D\u017E\u0178\u02c6\u02dc\u0400-\u04ff\u0686\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u2122\u221a]['']?){3,}/g;

/**
 * Survey / poll option lines — the "How did you find us?" survey that appears as
 * a series of standalone option lines.
 */
const SURVEY_OPTIONS: string[] = [
  "Japan Guide website",
  "Japan Guide YouTube channel",
  "Japan Guide social media",
  "Other travel websites",
  "Other YouTube channels",
  "Other social media",
  "Recommendation from friends/family",
  "AI chatbots",
  "Search engines",
  "Travel guide books",
  "TV, magazines, newspapers",
  "Travel agencies",
  "Previous personal experiences",
];

/**
 * Forum discussion link blocks: `[\n## Thread Title\nDate\nNreplies\n](forum-url)`
 */
const FORUM_DISCUSSION_BLOCK_RE =
  /\[\n## [^\n]+\n(?:[^\n]*(?:Yesterday|days? ago|hours? ago|[A-Z][a-z]+ \d{4}))[^\n]*\n\d+repl(?:y|ies)\n\]\(https?:\/\/www\.japan-guide\.com\/forum\/[^\n]+\)/g;

/**
 * [More Stories] link — separator before forum discussions.
 */
const MORE_STORIES_RE = /\[More Stories\]\(https?:\/\/www\.japan-guide\.com\/news\/[^\)]+\)/g;

// END_BLOCK_DEFINE_TEXT_PATTERNS_M_ADAPTER_JAPAN_GUIDE_001

// START_BLOCK_DEFINE_LINE_PATTERNS_M_ADAPTER_JAPAN_GUIDE_002

/** Banner ad image links: `[![]()](https://www.japan-guide.com/link.html?...)` */
const BANNER_AD_RE =
  /^\s*\[!\[\]\(\)\]\(https?:\/\/www\.japan-guide\.com\/link\.html\?[^\)]*\)\s*$/;

/** Banner ad image links with image URLs */
const BANNER_AD_IMG_RE =
  /^\s*\[!\[[^\]]*\]\([^\)]*\)\]\(https?:\/\/www\.japan-guide\.com\/link\.html\?[^\)]*\)\s*$/;

/** Banner ad links to external affiliate sites */
const BANNER_AD_EXTERNAL_RE =
  /^\s*\[!\[\]\(\)\]\(https?:\/\/(?:omakaseje\.com|affiliate\.)[^\)]*\)\s*$/;

/** Page timestamp: `Page last updated: Month Day, Year` */
const PAGE_TIMESTAMP_RE = /^\s*Page last updated:\s+\w+ \d{1,2},\s+\d{4}\s*$/;

/** Forum question link: `**Questions?** Ask in our [forum](...)` */
const FORUM_LINK_RE = /^\s*\*\*Questions\?\*\*\s+Ask in our \[forum\]/;

/** Rating metadata: lines that are part of the rating block */
const RATING_DOTS_RE = /^•••Best of Japan\s*$/;
const STAR_RATING_RE = /^★+\s*$/;
const RATING_COUNT_RE = /^\(\d[\d,]*\)\s*$/;
const RATING_RANK_RE = /^#\d+\s*$/;
const RATING_OF_VISITED_RE = /^of \d+ most visited in /;
const ADD_TO_LIST_RE = /^Add to listWant to goBeen there\s*$/;

/** "poweredby" booking.com/omakase widget header */
const POWERED_BY_RE = /^\[?poweredby/;

/** Budget filter line in booking widget */
const BUDGET_FILTER_RE = /^Budget:\s*$/;
const BUDGET_OPTIONS_RE = /^AllLow \$Mid \$\$High \$\$\$\s*$/;

/** "Read our ... Hotel Guide" link line */
const HOTEL_GUIDE_LINK_RE = /^\[Read our .+ Hotel Guide\]/;

/** "View on Booking.com" link */
const VIEW_ON_BOOKING_RE = /^\[View on Booking\.com\]/;

/** Booking.com rating line (e.g. "10.0Booking.com" or "9.2Booking.com") */
const BOOKING_RATING_RE = /^\d+\.\d+Booking\.com\s*$/;

/** Now: cherry blossom status lines */
const CHERRY_STATUS_RE = /^(?:Now:|Est\. Best Viewing:)\s*/;

/** Empty markdown link: `[](url)` on a line by itself */
const EMPTY_LINK_RE = /^\s*\[\]\(https?:\/\/[^\)]+\)\s*$/;

/** Sponsored hotel ad links via japan-guide.com/link.html redirect */
const SPONSORED_LINK_RE =
  /^\s*(?:\[[\w\s,!.'"-]*\])?\(https?:\/\/www\.japan-guide\.com\/link\.html\?[^\)]*\)\s*$/;

/** Lines containing link.html? sponsored redirect URLs (as part of markdown links) */
const LINK_HTML_REDIRECT_RE =
  /\(https?:\/\/www\.japan-guide\.com\/link\.html\?[^\)]*\)/;

/** Standalone "Sponsored" label line */
const SPONSORED_LABEL_RE = /^\s*Sponsored\s*$/;

/** "View site" link line */
const VIEW_SITE_RE = /^\[View site\]\(/;

/** "Guide" standalone label that precedes hotel guide section */
const GUIDE_LABEL_RE = /^\s*Guide\s*$/;

// END_BLOCK_DEFINE_LINE_PATTERNS_M_ADAPTER_JAPAN_GUIDE_002

// START_CONTRACT: stripTextBlocks
//   PURPOSE: Remove text-level block patterns via global regex replacements.
//   INPUTS: { text: string - Markdown text }
//   OUTPUTS: { string - Text with block patterns removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-JAPAN_GUIDE]
// END_CONTRACT: stripTextBlocks
function stripTextBlocks(text: string): string {
  // START_BLOCK_STRIP_TEXT_BLOCKS_M_ADAPTER_JAPAN_GUIDE_003
  let result = text;

  // Remove booking widget blocks (appears 2x per page)
  result = result.replace(BOOKING_WIDGET_RE, "");

  // Remove sponsored / travel news / featured story link blocks
  result = result.replace(SPONSORED_BLOCK_RE, "");

  // Remove forum discussion link blocks
  result = result.replace(FORUM_DISCUSSION_BLOCK_RE, "");

  // Remove [More Stories] links
  result = result.replace(MORE_STORIES_RE, "");

  // Remove feedback form block
  result = result.replace(FEEDBACK_FORM_RE, "");

  // Remove garbled Shift-JIS character sequences
  result = result.replace(GARBLED_SJIS_RE, "");

  return result;
  // END_BLOCK_STRIP_TEXT_BLOCKS_M_ADAPTER_JAPAN_GUIDE_003
}

// START_CONTRACT: stripLineNoise
//   PURPOSE: Filter lines matching noise patterns (empty images, banner ads, nav tree,
//            rating metadata, timestamp, forum link, survey options, booking widgets).
//   INPUTS: { text: string - Markdown text }
//   OUTPUTS: { string - Text with noisy lines removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-JAPAN_GUIDE]
// END_CONTRACT: stripLineNoise
function stripLineNoise(text: string): string {
  // START_BLOCK_STRIP_LINE_NOISE_M_ADAPTER_JAPAN_GUIDE_004
  const lines = text.split("\n");
  const result: string[] = [];

  let inNavTree = false;
  let inExternalLinks = false;
  let inBookingWidget = false;
  let bookingWidgetBlankCount = 0;
  let inSponsoredHotelSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // --- State: Navigation tree ---
    // Starts with "Explore[CityName]" and continues through `* [Link](url)` lines
    if (trimmed.startsWith("Explore[")) {
      inNavTree = true;
      continue;
    }
    if (inNavTree) {
      // Nav tree continues through `* [Link](url)` list items and section headings
      if (
        trimmed.startsWith("* [") ||
        trimmed.startsWith("* ") ||
        trimmed === "" ||
        /^[A-Z][a-zA-Z ]+$/.test(trimmed) // Section headings like "Central Kyoto"
      ) {
        continue;
      }
      // "Plan Your Trip" is concatenated to end of a nav item — skip it
      if (trimmed.includes("Plan Your Trip")) {
        continue;
      }
      if (trimmed.includes("Access")) {
        continue;
      }
      // Nav tree ended
      inNavTree = false;
    }

    // --- State: External links section ---
    // Starts with "### English" or "### Japanese" followed by `* [####\nSiteName\nDescription\n](url)`
    if (/^###\s+(?:English|Japanese)\s*$/.test(trimmed)) {
      inExternalLinks = true;
      continue;
    }
    if (inExternalLinks) {
      // External links block: `* [####\nName\nDesc\n](url)` lines, or just list items
      if (
        trimmed.startsWith("* [") ||
        trimmed.startsWith("####") ||
        trimmed === "*" ||
        trimmed === "" ||
        trimmed.startsWith("](") ||
        /^[A-Za-z]/.test(trimmed) && !trimmed.startsWith("#") && !trimmed.startsWith("[")
      ) {
        // Check if we've hit a line that looks like article content
        // End if we hit a heading that isn't ####
        if (/^#{1,3}\s+/.test(trimmed) && !trimmed.startsWith("####")) {
          inExternalLinks = false;
          // Don't skip this line — fall through to normal processing
        } else if (trimmed.startsWith("[Read our ") || trimmed.startsWith("Top rated ") || trimmed.startsWith("Recommended in ")) {
          // Transition to booking widget — end external links
          inExternalLinks = false;
          // Fall through, these will be caught by other filters
        } else {
          continue;
        }
      } else {
        inExternalLinks = false;
        // Fall through to normal processing
      }
    }

    // --- State: Booking widget section ---
    // "Top rated in CityName" or "Recommended in CityName" followed by booking.com/omakase listings
    if (/^(?:Top rated|Recommended) in /.test(trimmed)) {
      inBookingWidget = true;
      bookingWidgetBlankCount = 0;
      continue;
    }
    if (inBookingWidget) {
      if (trimmed === "") {
        bookingWidgetBlankCount++;
        // Allow blank lines within the widget
        if (bookingWidgetBlankCount > 5) {
          inBookingWidget = false;
        } else {
          continue;
        }
      } else {
        bookingWidgetBlankCount = 0;
        // These lines are all part of the booking widget
        if (
          POWERED_BY_RE.test(trimmed) ||
          BUDGET_FILTER_RE.test(trimmed) ||
          BUDGET_OPTIONS_RE.test(trimmed) ||
          VIEW_ON_BOOKING_RE.test(trimmed) ||
          BOOKING_RATING_RE.test(trimmed) ||
          BANNER_AD_EXTERNAL_RE.test(line) ||
          trimmed === "*" ||
          trimmed.startsWith("* [") ||
          trimmed.startsWith("[![]()](") ||
          trimmed.startsWith("[") ||
          /^\d+\.\d+Booking/.test(trimmed) ||
          // Hotel description lines within the widget — plain text
          !trimmed.startsWith("#")
        ) {
          // Check if we've hit a real heading — that means the widget ended
          if (/^#{1,3}\s+\S/.test(trimmed) && !POWERED_BY_RE.test(trimmed)) {
            inBookingWidget = false;
            // Fall through to normal processing
          } else {
            continue;
          }
        } else {
          inBookingWidget = false;
          // Fall through
        }
      }
    }

    // --- State: Sponsored hotel section ---
    // Starts with "### ... Hotel Guide" and contains hotel listings with plain text descriptions
    if (/^#{1,3}\s+.*Hotel Guide\s*$/.test(trimmed)) {
      inSponsoredHotelSection = true;
      continue;
    }
    if (inSponsoredHotelSection) {
      // End on a heading that is NOT a hotel guide heading
      if (/^#{1,2}\s+\S/.test(trimmed) && !/Hotel Guide/.test(trimmed)) {
        inSponsoredHotelSection = false;
        // Fall through to normal processing
      } else {
        continue;
      }
    }

    // --- Single-line filters ---

    // Banner ad image links
    if (BANNER_AD_RE.test(line)) continue;
    if (BANNER_AD_IMG_RE.test(line)) continue;
    if (BANNER_AD_EXTERNAL_RE.test(line)) continue;

    // Page timestamp
    if (PAGE_TIMESTAMP_RE.test(line)) continue;

    // Forum question link
    if (FORUM_LINK_RE.test(line)) continue;

    // Rating metadata block lines
    if (RATING_DOTS_RE.test(trimmed)) continue;
    if (STAR_RATING_RE.test(trimmed)) continue;
    if (RATING_COUNT_RE.test(trimmed)) continue;
    if (RATING_RANK_RE.test(trimmed)) continue;
    if (RATING_OF_VISITED_RE.test(trimmed)) continue;
    if (ADD_TO_LIST_RE.test(trimmed)) continue;

    // Cherry blossom status lines
    if (CHERRY_STATUS_RE.test(trimmed)) continue;

    // Hotel guide link
    if (HOTEL_GUIDE_LINK_RE.test(trimmed)) continue;

    // Powered by booking line
    if (POWERED_BY_RE.test(trimmed)) continue;

    // Budget filter lines
    if (BUDGET_FILTER_RE.test(trimmed)) continue;
    if (BUDGET_OPTIONS_RE.test(trimmed)) continue;

    // View on Booking.com
    if (VIEW_ON_BOOKING_RE.test(trimmed)) continue;

    // Booking.com rating
    if (BOOKING_RATING_RE.test(trimmed)) continue;

    // Survey/poll option lines
    if (SURVEY_OPTIONS.includes(trimmed)) continue;

    // Empty links `[](url)` on their own line
    if (EMPTY_LINK_RE.test(line)) continue;

    // Sponsored label lines
    if (SPONSORED_LABEL_RE.test(line)) continue;

    // View site links
    if (VIEW_SITE_RE.test(trimmed)) continue;

    // Guide label line (precedes hotel guide section)
    if (GUIDE_LABEL_RE.test(line)) continue;

    // Lines containing japan-guide.com/link.html redirect URLs (sponsored ads)
    if (LINK_HTML_REDIRECT_RE.test(trimmed)) continue;

    // Lines starting with `* [![` (image links in widget listings)
    if (/^\s*\*\s*\[!\[/.test(line)) continue;

    result.push(line);
  }

  return result.join("\n");
  // END_BLOCK_STRIP_LINE_NOISE_M_ADAPTER_JAPAN_GUIDE_004
}

// START_CONTRACT: clean
//   PURPOSE: Remove all japan-guide-specific boilerplate noise from crawled markdown content.
//   INPUTS: { text: string - Raw markdown text from japan-guide.com crawl }
//   OUTPUTS: { string - Cleaned text with boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-JAPAN_GUIDE]
// END_CONTRACT: clean
function clean(text: string): string {
  // START_BLOCK_CLEAN_M_ADAPTER_JAPAN_GUIDE_005

  // Phase 1: Strip SVG placeholder images (uses shared primitive)
  let result = stripSvgPlaceholders(text);

  // Phase 2: Remove text-level block patterns (booking widgets, sponsored blocks,
  //          feedback form, garbled characters, forum discussions)
  result = stripTextBlocks(result);

  // Phase 3: Filter noisy lines (banner ads, nav tree, ratings, timestamps,
  //          survey options, external links, booking widgets)
  result = stripLineNoise(result);

  // Phase 4: Normalize whitespace (collapse 3+ blank lines to 2, trim)
  result = normalizeCleanupWhitespace(result);

  return result;
  // END_BLOCK_CLEAN_M_ADAPTER_JAPAN_GUIDE_005
}

// START_BLOCK_DEFINE_ADAPTER_M_ADAPTER_JAPAN_GUIDE_006
export const japanGuideAdapter: SourceAdapter = {
  sourceId: "japan_guide",
  clean,
};
// END_BLOCK_DEFINE_ADAPTER_M_ADAPTER_JAPAN_GUIDE_006
