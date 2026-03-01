// FILE: src/sites/parser/cleanup/adapters/kansai_odyssey.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Source-specific cleanup adapter (Layer B) for kansai-odyssey.com content.
//   SCOPE: Remove site header, metadata/tags lines, "You May Also Like" section, comment form,
//          scroll-to-top anchor, prev/next post links, and SVG placeholders.
//   DEPENDS: M-CLEANUP-COMMON, M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-ADAPTER-KANSAI_ODYSSEY
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   FOOTER_MARKERS - Array of patterns that mark the start of footer boilerplate (truncate from earliest match).
//   SITE_HEADER_RE - Pattern matching the site header line.
//   SITE_TAGLINE_RE - Pattern matching the site tagline line.
//   METADATA_LINE_RE - Pattern matching category/author/tag metadata lines.
//   SCROLL_TO_TOP_RE - Pattern matching scroll-to-top anchor.
//   TITLE_LINE_RE - Pattern matching the page title line with site suffix.
//   PREV_NEXT_LINK_RE - Pattern matching bullet items with only internal kansai-odyssey.com links.
//   findEarliestFooterMarker - Scan lines to find the index of the earliest footer marker.
//   stripFooterFromMarker - Truncate content at the earliest footer marker.
//   stripLineNoise - Remove scattered line-level noise (header, metadata, scroll-to-top, trailing links).
//   clean - Main cleanup function removing all kansai_odyssey-specific noise.
//   kansaiOdysseyAdapter - Exported SourceAdapter constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial kansai_odyssey adapter for Phase-12 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

import type { SourceAdapter } from "../types";
import { stripSvgPlaceholders, normalizeCleanupWhitespace } from "../common";

// START_BLOCK_DEFINE_FOOTER_MARKERS_M_ADAPTER_KANSAI_ODYSSEY_001

/** Footer markers — the first one found triggers truncation of all remaining content. */
const FOOTER_MARKERS: RegExp[] = [
  /^###\s+You May Also Like/,
  /^###\s+Leave a Reply\s+\[Cancel reply\]/,
];

// END_BLOCK_DEFINE_FOOTER_MARKERS_M_ADAPTER_KANSAI_ODYSSEY_001

// START_BLOCK_DEFINE_LINE_NOISE_PATTERNS_M_ADAPTER_KANSAI_ODYSSEY_002

/** Site header: `### [Kansai Odyssey](https://kansai-odyssey.com/)` */
const SITE_HEADER_RE =
  /^###\s+\[Kansai Odyssey\]\(https:\/\/kansai-odyssey\.com\/?\)/;

/** Site tagline: `Adventures in Kansai and Beyond` */
const SITE_TAGLINE_RE = /^\s*Adventures in Kansai and Beyond\s*$/;

/** Title line ending with `| Kansai Odyssey` */
const TITLE_LINE_RE = /\|\s*Kansai Odyssey\s*$/;

/** Metadata/tags: lines with category, author, or tag links */
const METADATA_LINE_RE =
  /^\s*\[.*\]\(https:\/\/kansai-odyssey\.com\/(?:category|author|tag)\//;

/** Standalone metadata date links: `[ April 6, 2019](https://kansai-odyssey.com/...)` */
const METADATA_DATE_RE =
  /^\s*\[\s*\w+\s+\d{1,2},\s*\d{4}\s*\]\(https:\/\/kansai-odyssey\.com\//;

/** Scroll-to-top anchor: `[**](#cm-masthead)` */
const SCROLL_TO_TOP_RE = /^\s*\[\*\*\]\(#cm-masthead\)\s*$/;

/** Bullet items that contain only an internal kansai-odyssey.com link (prev/next navigation) */
const PREV_NEXT_LINK_RE =
  /^\s*\*\s+\[.*\]\(https:\/\/kansai-odyssey\.com\/[^)]+\)\s*$/;

// END_BLOCK_DEFINE_LINE_NOISE_PATTERNS_M_ADAPTER_KANSAI_ODYSSEY_002

// START_CONTRACT: findEarliestFooterMarker
//   PURPOSE: Scan lines to find the index of the earliest footer marker.
//   INPUTS: { lines: string[] - Array of text lines }
//   OUTPUTS: { number - Index of earliest footer marker line, or lines.length if none found }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-KANSAI_ODYSSEY]
// END_CONTRACT: findEarliestFooterMarker
function findEarliestFooterMarker(lines: string[]): number {
  // START_BLOCK_FIND_EARLIEST_FOOTER_MARKER_M_ADAPTER_KANSAI_ODYSSEY_003
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FOOTER_MARKERS.some((re) => re.test(line))) {
      return i;
    }
  }
  return lines.length;
  // END_BLOCK_FIND_EARLIEST_FOOTER_MARKER_M_ADAPTER_KANSAI_ODYSSEY_003
}

// START_CONTRACT: stripFooterFromMarker
//   PURPOSE: Truncate content at the earliest footer marker.
//   INPUTS: { text: string - Full markdown text }
//   OUTPUTS: { string - Text with footer boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-KANSAI_ODYSSEY]
// END_CONTRACT: stripFooterFromMarker
function stripFooterFromMarker(text: string): string {
  // START_BLOCK_STRIP_FOOTER_FROM_MARKER_M_ADAPTER_KANSAI_ODYSSEY_004
  const lines = text.split("\n");
  const cutIndex = findEarliestFooterMarker(lines);
  if (cutIndex < lines.length) {
    return lines.slice(0, cutIndex).join("\n");
  }
  return text;
  // END_BLOCK_STRIP_FOOTER_FROM_MARKER_M_ADAPTER_KANSAI_ODYSSEY_004
}

// START_CONTRACT: stripLineNoise
//   PURPOSE: Remove scattered line-level noise: site header, tagline, title suffix, metadata,
//            scroll-to-top anchor, and trailing prev/next links.
//   INPUTS: { text: string - Markdown text }
//   OUTPUTS: { string - Text with line-level noise removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-KANSAI_ODYSSEY]
// END_CONTRACT: stripLineNoise
function stripLineNoise(text: string): string {
  // START_BLOCK_STRIP_LINE_NOISE_M_ADAPTER_KANSAI_ODYSSEY_005
  const lines = text.split("\n");
  const filtered = lines.filter((line) => {
    if (SITE_HEADER_RE.test(line)) return false;
    if (SITE_TAGLINE_RE.test(line)) return false;
    if (TITLE_LINE_RE.test(line)) return false;
    if (SCROLL_TO_TOP_RE.test(line)) return false;

    // Metadata lines: category, author, tag links on their own line
    // These lines consist entirely of bracketed links to kansai-odyssey.com/category|author|tag
    if (METADATA_LINE_RE.test(line)) return false;

    // Standalone date link lines pointing to kansai-odyssey.com
    if (METADATA_DATE_RE.test(line)) return false;

    // Prev/next post bullet links at the end (only internal links)
    if (PREV_NEXT_LINK_RE.test(line)) return false;

    return true;
  });
  return filtered.join("\n");
  // END_BLOCK_STRIP_LINE_NOISE_M_ADAPTER_KANSAI_ODYSSEY_005
}

// START_CONTRACT: clean
//   PURPOSE: Remove all kansai_odyssey-specific boilerplate noise from crawled markdown content.
//   INPUTS: { text: string - Raw markdown text from kansai-odyssey.com crawl }
//   OUTPUTS: { string - Cleaned text with boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-KANSAI_ODYSSEY]
// END_CONTRACT: clean
function clean(text: string): string {
  // START_BLOCK_CLEAN_M_ADAPTER_KANSAI_ODYSSEY_006

  // Phase 1: Strip SVG placeholder images
  let result = stripSvgPlaceholders(text);

  // Phase 2: Truncate at earliest footer marker (You May Also Like, Leave a Reply)
  result = stripFooterFromMarker(result);

  // Phase 3: Remove scattered line-level noise (header, metadata, scroll-to-top, prev/next links)
  result = stripLineNoise(result);

  // Phase 4: Normalize whitespace
  result = normalizeCleanupWhitespace(result);

  return result;
  // END_BLOCK_CLEAN_M_ADAPTER_KANSAI_ODYSSEY_006
}

// START_BLOCK_DEFINE_ADAPTER_M_ADAPTER_KANSAI_ODYSSEY_007
export const kansaiOdysseyAdapter: SourceAdapter = {
  sourceId: "kansai_odyssey",
  clean,
};
// END_BLOCK_DEFINE_ADAPTER_M_ADAPTER_KANSAI_ODYSSEY_007
