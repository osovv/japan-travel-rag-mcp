// FILE: src/sites/parser/cleanup/adapters/insidekyoto.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Source-specific cleanup adapter (Layer B) for insidekyoto.com content.
//   SCOPE: Remove Kyoto Vacation Checklist footer, Kyoto District Map, About InsideKyoto bio,
//          affiliate disclosure, Top Activities promotional grid, Check Hotel Availability widget,
//          Recommended Kyoto Accommodation block, Hire A Travel Expert callout, and SVG placeholders.
//   DEPENDS: M-CLEANUP-COMMON, M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-ADAPTER-INSIDEKYOTO
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   FOOTER_MARKERS - Array of patterns that mark the start of footer boilerplate (truncate from earliest match).
//   MID_ARTICLE_BLOCK_START_RE - Patterns that begin mid-article promotional blocks to strip.
//   MID_ARTICLE_BLOCK_END_RE - Patterns that end mid-article promotional blocks.
//   findEarliestFooterMarker - Scan lines to find the index of the earliest footer marker.
//   stripFooterFromMarker - Truncate content at the earliest footer marker.
//   stripMidArticleBlocks - Remove mid-article promotional blocks (activities grid, hotel widget, accommodation, travel expert).
//   clean - Main cleanup function removing all insidekyoto-specific noise.
//   insidekyotoAdapter - Exported SourceAdapter constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial insidekyoto adapter for Phase-12 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

import type { SourceAdapter } from "../types";
import { stripSvgPlaceholders, normalizeCleanupWhitespace } from "../common";

// START_BLOCK_DEFINE_FOOTER_MARKERS_M_ADAPTER_INSIDEKYOTO_001

/** Footer markers — the first one found triggers truncation of all remaining content. */
const FOOTER_MARKERS: RegExp[] = [
  /^###\s+Kyoto Vacation Checklist/,
  /^###\s+Kyoto District Map/,
  /^###\s+About InsideKyoto\.com/,
  /^Disclosure:\s+InsideKyoto\.com\s+is\s+a\s+participant/,
];

// END_BLOCK_DEFINE_FOOTER_MARKERS_M_ADAPTER_INSIDEKYOTO_001

// START_BLOCK_DEFINE_MID_ARTICLE_PATTERNS_M_ADAPTER_INSIDEKYOTO_002

/**
 * Patterns that start a mid-article promotional block.
 * Each entry is [startPattern, endCondition]:
 *   - startPattern: regex matching the first line of the block
 *   - endCondition: "next_heading" = block ends at the next markdown heading (##+)
 *                   "blank_then_content" = block ends when a non-empty line follows a blank line
 *                   after a [More Info] link or after the block's characteristic content ends
 */
const MID_ARTICLE_BLOCK_STARTS: RegExp[] = [
  /^Top Activities In Kyoto\s*$/,
  /^#{1,6}\s*Check Hotel Availability\s*$/,
  /^Check Hotel Availability\s*$/,
  /^Recommended Kyoto Accommodation\s*$/,
  /^#{1,6}\s*Hire A Travel Expert/,
];

/** Lines that indicate the end of a mid-article promotional block */
const MID_ARTICLE_BLOCK_ENDS: RegExp[] = [
  /\[More Info\]/,
  /!\[Booking\.com\]/,
  /\[Book Now\]/,
];

// END_BLOCK_DEFINE_MID_ARTICLE_PATTERNS_M_ADAPTER_INSIDEKYOTO_002

// START_CONTRACT: findEarliestFooterMarker
//   PURPOSE: Scan lines to find the index of the earliest footer marker.
//   INPUTS: { lines: string[] - Array of text lines }
//   OUTPUTS: { number - Index of earliest footer marker line, or lines.length if none found }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-INSIDEKYOTO]
// END_CONTRACT: findEarliestFooterMarker
function findEarliestFooterMarker(lines: string[]): number {
  // START_BLOCK_FIND_EARLIEST_FOOTER_MARKER_M_ADAPTER_INSIDEKYOTO_003
  let earliest = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FOOTER_MARKERS.some((re) => re.test(line))) {
      earliest = i;
      break; // First match is the earliest since we scan top-to-bottom
    }
  }
  return earliest;
  // END_BLOCK_FIND_EARLIEST_FOOTER_MARKER_M_ADAPTER_INSIDEKYOTO_003
}

// START_CONTRACT: stripFooterFromMarker
//   PURPOSE: Truncate content at the earliest footer marker.
//   INPUTS: { text: string - Full markdown text }
//   OUTPUTS: { string - Text with footer boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-INSIDEKYOTO]
// END_CONTRACT: stripFooterFromMarker
function stripFooterFromMarker(text: string): string {
  // START_BLOCK_STRIP_FOOTER_FROM_MARKER_M_ADAPTER_INSIDEKYOTO_004
  const lines = text.split("\n");
  const cutIndex = findEarliestFooterMarker(lines);
  if (cutIndex < lines.length) {
    return lines.slice(0, cutIndex).join("\n");
  }
  return text;
  // END_BLOCK_STRIP_FOOTER_FROM_MARKER_M_ADAPTER_INSIDEKYOTO_004
}

// START_CONTRACT: stripMidArticleBlocks
//   PURPOSE: Remove mid-article promotional blocks (activities grid, hotel availability widget,
//            recommended accommodation, hire travel expert).
//   INPUTS: { text: string - Markdown text }
//   OUTPUTS: { string - Text with mid-article promotional blocks removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-INSIDEKYOTO]
// END_CONTRACT: stripMidArticleBlocks
function stripMidArticleBlocks(text: string): string {
  // START_BLOCK_STRIP_MID_ARTICLE_BLOCKS_M_ADAPTER_INSIDEKYOTO_005
  const lines = text.split("\n");
  const result: string[] = [];
  let inBlock = false;
  let blockEndCountdown = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (!inBlock) {
      // Check if this line starts a promotional block
      if (MID_ARTICLE_BLOCK_STARTS.some((re) => re.test(line))) {
        inBlock = true;
        blockEndCountdown = 0;
        continue;
      }
      result.push(line);
    } else {
      // Inside a promotional block — look for end conditions
      // End condition: we hit a markdown heading that is NOT part of the block's
      // internal structure (e.g., ### Destination, #### Check-in date are internal)
      // We end on a heading that doesn't match known internal patterns
      const isInternalHeading =
        /^#{1,6}\s*(?:Destination|Check-in date|Check-out date)\s*$/.test(line);

      if (!isInternalHeading && /^#{1,3}\s+\S/.test(line)) {
        // This heading is article content — end the block, keep this line
        inBlock = false;
        result.push(line);
        continue;
      }

      // Also end if we see a time-stamped itinerary entry (e.g., "**8:30am:**")
      if (/^\*\*\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?(?::?\*\*)/.test(line)) {
        inBlock = false;
        result.push(line);
        continue;
      }

      // Also end on a line that starts with bold text indicating article body
      // but only after seeing at least one [More Info] / [Book Now] line
      if (MID_ARTICLE_BLOCK_ENDS.some((re) => re.test(line))) {
        blockEndCountdown = 2; // Allow up to 2 more lines after the last end marker
      }

      if (blockEndCountdown > 0) {
        blockEndCountdown--;
        if (blockEndCountdown === 0) {
          // Check if the next non-empty line is article content
          inBlock = false;
        }
      }
      // Skip this line (it's part of the block)
    }
  }

  return result.join("\n");
  // END_BLOCK_STRIP_MID_ARTICLE_BLOCKS_M_ADAPTER_INSIDEKYOTO_005
}

// START_CONTRACT: clean
//   PURPOSE: Remove all insidekyoto-specific boilerplate noise from crawled markdown content.
//   INPUTS: { text: string - Raw markdown text from insidekyoto.com crawl }
//   OUTPUTS: { string - Cleaned text with boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-INSIDEKYOTO]
// END_CONTRACT: clean
function clean(text: string): string {
  // START_BLOCK_CLEAN_M_ADAPTER_INSIDEKYOTO_006

  // Phase 1: Strip SVG placeholder images (uses shared primitive)
  let result = stripSvgPlaceholders(text);

  // Phase 2: Truncate at earliest footer marker (Vacation Checklist, District Map, About, Disclosure)
  result = stripFooterFromMarker(result);

  // Phase 3: Remove mid-article promotional blocks (activities grid, hotel widget, accommodation, travel expert)
  result = stripMidArticleBlocks(result);

  // Phase 4: Normalize whitespace (collapse 3+ blank lines to 2, trim)
  result = normalizeCleanupWhitespace(result);

  return result;
  // END_BLOCK_CLEAN_M_ADAPTER_INSIDEKYOTO_006
}

// START_BLOCK_DEFINE_ADAPTER_M_ADAPTER_INSIDEKYOTO_007
export const insidekyotoAdapter: SourceAdapter = {
  sourceId: "insidekyoto",
  clean,
};
// END_BLOCK_DEFINE_ADAPTER_M_ADAPTER_INSIDEKYOTO_007
