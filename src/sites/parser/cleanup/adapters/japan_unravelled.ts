// FILE: src/sites/parser/cleanup/adapters/japan_unravelled.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Source-specific cleanup adapter (Layer B) for japanunravelled.substack.com content.
//   SCOPE: Remove Substack publication header, author avatar block, mid-article subscription CTAs,
//          share links, Trip Essentials affiliate block, ebook promotion blocks, comment/discussion
//          section, "Ready for more?" footer, sign-off, and PreviousNext navigation.
//   DEPENDS: M-CLEANUP-COMMON, M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-ADAPTER-JAPAN_UNRAVELLED
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   FOOTER_MARKERS - Array of patterns that mark the start of footer boilerplate (truncate from earliest match).
//   findEarliestFooterMarker - Scan lines to find the index of the earliest footer marker.
//   stripFooterFromMarker - Truncate content at the earliest footer marker.
//   stripSubstackHeader - Remove the Substack publication header block at the top.
//   stripLineNoise - Remove scattered line-level noise (subscribe CTAs, share links, PreviousNext, etc).
//   clean - Main cleanup function removing all japan_unravelled-specific noise.
//   japanUnravelledAdapter - Exported SourceAdapter constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial japan_unravelled adapter for Phase-12 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

import type { SourceAdapter } from "../types";
import { stripSvgPlaceholders, normalizeCleanupWhitespace } from "../common";

// START_BLOCK_DEFINE_FOOTER_MARKERS_M_ADAPTER_JAPAN_UNRAVELLED_001

/** Footer markers — the first one found triggers truncation of all remaining content. */
const FOOTER_MARKERS: RegExp[] = [
  /^###\s+Trip Essentials/,
  /^###\s+Summer Sale!/,
  /^####\s+Discussion about this post/,
  /^###\s+Ready for more\?/,
  /^####\s+That's all for this month/,
];

// END_BLOCK_DEFINE_FOOTER_MARKERS_M_ADAPTER_JAPAN_UNRAVELLED_001

// START_BLOCK_DEFINE_LINE_NOISE_PATTERNS_M_ADAPTER_JAPAN_UNRAVELLED_002

/** Substack header image: `![Japan Unravelled: Insider](...substackcdn...)` */
const SUBSTACK_HEADER_IMAGE_RE =
  /^(?:\[[\s\n]*)?!\[Japan Unravelled(?:: Insider)?\]\(https:\/\/substackcdn\.com\//;

/** Substack publication title: `# [Japan Unravelled: Insider](...)` */
const SUBSTACK_TITLE_RE =
  /^#\s+\[Japan Unravelled(?:: Insider)?\]\(https:\/\/japanunravelled\.substack\.com/;

/** SubscribeSign in line */
const SUBSCRIBE_SIGN_IN_RE = /^\s*SubscribeSign in\s*$/;

/** Substack nav links: Home, Notes, Archive, About */
const SUBSTACK_NAV_RE =
  /^\s*\[(?:Home|Notes|Archive|About)\]\(https:\/\/japanunravelled\.substack\.com\//;

/** Page not found line */
const PAGE_NOT_FOUND_RE = /^\s*##\s+Page not found\s*$/;

/** Author avatar image: `![Andrew's avatar](...)` */
const AUTHOR_AVATAR_RE = /^(?:\[[\s\n]*)?!\[Andrew's avatar\]/;

/** Author name link: `[Andrew](https://substack.com/@japanunravelled)` on its own line */
const AUTHOR_NAME_RE =
  /^\s*\[Andrew\]\(https:\/\/substack\.com\/@japanunravelled\)\s*$/;

/** Standalone date line like `May 31, 2025` */
const STANDALONE_DATE_RE =
  /^\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s*\d{4}\s*$/;

/** Stats line: standalone number (like "327" for likes, "15" for comments) */
const STANDALONE_NUMBER_RE = /^\s*\d{1,4}\s*$/;

/** Standalone "Share" line */
const SHARE_LINE_RE = /^\s*Share\s*$/;

/** Standalone "Subscribe" CTA */
const SUBSCRIBE_CTA_RE = /^\s*Subscribe\s*$/;

/** Reader-supported publication CTA */
const READER_SUPPORTED_RE =
  /Japan Unravelled(?:: Insider)? is a reader-supported publication/;

/** Share link: `[Share Japan Unravelled: Insider](...)` */
const SHARE_LINK_RE =
  /^\s*\[Share(?:\s+Japan Unravelled(?:: Insider)?)?\]\(https:\/\/japanunravelled\.substack\.com\//;

/** Share action link: `[Share](...action=share)` */
const SHARE_ACTION_RE = /^\s*\[Share\]\(.*action=share/;

/** Leave a comment link */
const LEAVE_COMMENT_RE =
  /^\s*\[Leave a comment\]\(https:\/\/japanunravelled\.substack\.com\//;

/** PreviousNext navigation */
const PREV_NEXT_RE = /^\s*PreviousNext\s*$/;

/** Title line with Substack suffix */
const TITLE_SUFFIX_RE = /\|\s*(?:Andrew\s*\|?\s*)?Substack\s*$/;

/** Closing bracket line from wrapped image links: `](https://japanunravelled.substack.com/)` */
const CLOSING_BRACKET_LINK_RE =
  /^\s*\]\(https:\/\/(?:japanunravelled\.substack\.com|substack\.com\/@japanunravelled)\/?(?:\?[^)]+)?\)\s*$/;

// END_BLOCK_DEFINE_LINE_NOISE_PATTERNS_M_ADAPTER_JAPAN_UNRAVELLED_002

// START_CONTRACT: findEarliestFooterMarker
//   PURPOSE: Scan lines to find the index of the earliest footer marker.
//   INPUTS: { lines: string[] - Array of text lines }
//   OUTPUTS: { number - Index of earliest footer marker line, or lines.length if none found }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-JAPAN_UNRAVELLED]
// END_CONTRACT: findEarliestFooterMarker
function findEarliestFooterMarker(lines: string[]): number {
  // START_BLOCK_FIND_EARLIEST_FOOTER_MARKER_M_ADAPTER_JAPAN_UNRAVELLED_003
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FOOTER_MARKERS.some((re) => re.test(line))) {
      return i;
    }
  }
  return lines.length;
  // END_BLOCK_FIND_EARLIEST_FOOTER_MARKER_M_ADAPTER_JAPAN_UNRAVELLED_003
}

// START_CONTRACT: stripFooterFromMarker
//   PURPOSE: Truncate content at the earliest footer marker.
//   INPUTS: { text: string - Full markdown text }
//   OUTPUTS: { string - Text with footer boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-JAPAN_UNRAVELLED]
// END_CONTRACT: stripFooterFromMarker
function stripFooterFromMarker(text: string): string {
  // START_BLOCK_STRIP_FOOTER_FROM_MARKER_M_ADAPTER_JAPAN_UNRAVELLED_004
  const lines = text.split("\n");
  const cutIndex = findEarliestFooterMarker(lines);
  if (cutIndex < lines.length) {
    return lines.slice(0, cutIndex).join("\n");
  }
  return text;
  // END_BLOCK_STRIP_FOOTER_FROM_MARKER_M_ADAPTER_JAPAN_UNRAVELLED_004
}

// START_CONTRACT: stripSubstackHeader
//   PURPOSE: Remove the Substack publication header block from the top of the content.
//            This includes the publication image, title, SubscribeSign in, and nav links.
//   INPUTS: { text: string - Markdown text }
//   OUTPUTS: { string - Text with Substack header removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-JAPAN_UNRAVELLED]
// END_CONTRACT: stripSubstackHeader
function stripSubstackHeader(text: string): string {
  // START_BLOCK_STRIP_SUBSTACK_HEADER_M_ADAPTER_JAPAN_UNRAVELLED_005
  const lines = text.split("\n");

  // Strategy: find `SubscribeSign in` in the first ~15 lines — that's the last
  // line of the Substack header block. Cut everything up to and including it.
  // The article title may appear before the header image, so we can't just scan
  // sequentially from line 0 looking for non-header lines.
  let subscribeIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    if (SUBSCRIBE_SIGN_IN_RE.test(lines[i] ?? "")) {
      subscribeIndex = i;
      break;
    }
  }

  if (subscribeIndex >= 0) {
    // Also skip any nav links immediately after SubscribeSign in
    let cutAfter = subscribeIndex;
    for (
      let i = subscribeIndex + 1;
      i < Math.min(lines.length, subscribeIndex + 10);
      i++
    ) {
      const line = lines[i] ?? "";
      if (
        SUBSTACK_NAV_RE.test(line) ||
        PAGE_NOT_FOUND_RE.test(line) ||
        line.trim() === ""
      ) {
        cutAfter = i;
      } else {
        break;
      }
    }
    return lines.slice(cutAfter + 1).join("\n");
  }

  return text;
  // END_BLOCK_STRIP_SUBSTACK_HEADER_M_ADAPTER_JAPAN_UNRAVELLED_005
}

// START_CONTRACT: stripLineNoise
//   PURPOSE: Remove scattered line-level noise: author avatar, standalone subscribe CTAs,
//            share links, PreviousNext navigation, and reader-supported publication CTAs.
//   INPUTS: { text: string - Markdown text }
//   OUTPUTS: { string - Text with line-level noise removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-JAPAN_UNRAVELLED]
// END_CONTRACT: stripLineNoise
function stripLineNoise(text: string): string {
  // START_BLOCK_STRIP_LINE_NOISE_M_ADAPTER_JAPAN_UNRAVELLED_006
  const lines = text.split("\n");
  const result: string[] = [];
  let inAuthorBlock = false;
  let authorBlockLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Author avatar block: avatar image -> author link -> date -> numbers -> Share
    // Spans about 5-7 lines after the article subtitle
    if (inAuthorBlock) {
      authorBlockLines++;
      if (authorBlockLines > 8) {
        inAuthorBlock = false;
        // Fall through to normal processing
      } else if (
        AUTHOR_NAME_RE.test(line) ||
        STANDALONE_DATE_RE.test(line) ||
        STANDALONE_NUMBER_RE.test(line) ||
        SHARE_LINE_RE.test(line) ||
        CLOSING_BRACKET_LINK_RE.test(line) ||
        line.trim() === "" ||
        line.trim() === "["
      ) {
        continue;
      } else {
        // Non-author-block line — end the block, keep this line
        inAuthorBlock = false;
        result.push(line);
        continue;
      }
    }

    if (AUTHOR_AVATAR_RE.test(line)) {
      inAuthorBlock = true;
      authorBlockLines = 0;
      continue;
    }

    if (SUBSCRIBE_CTA_RE.test(line)) continue;
    if (READER_SUPPORTED_RE.test(line)) continue;
    if (SHARE_LINK_RE.test(line)) continue;
    if (SHARE_ACTION_RE.test(line)) continue;
    if (LEAVE_COMMENT_RE.test(line)) continue;
    if (PREV_NEXT_RE.test(line)) continue;
    if (SHARE_LINE_RE.test(line)) continue;

    result.push(line);
  }

  return result.join("\n");
  // END_BLOCK_STRIP_LINE_NOISE_M_ADAPTER_JAPAN_UNRAVELLED_006
}

// START_CONTRACT: clean
//   PURPOSE: Remove all japan_unravelled-specific boilerplate noise from crawled markdown content.
//   INPUTS: { text: string - Raw markdown text from japanunravelled.substack.com crawl }
//   OUTPUTS: { string - Cleaned text with boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-JAPAN_UNRAVELLED]
// END_CONTRACT: clean
function clean(text: string): string {
  // START_BLOCK_CLEAN_M_ADAPTER_JAPAN_UNRAVELLED_007

  // Phase 1: Strip SVG placeholder images
  let result = stripSvgPlaceholders(text);

  // Phase 2: Remove Substack publication header
  result = stripSubstackHeader(result);

  // Phase 3: Truncate at earliest footer marker (Trip Essentials, Summer Sale, Discussion, Ready for more, Sign-off)
  result = stripFooterFromMarker(result);

  // Phase 4: Remove scattered line-level noise (avatar, subscribe, share, PreviousNext)
  result = stripLineNoise(result);

  // Phase 5: Normalize whitespace
  result = normalizeCleanupWhitespace(result);

  return result;
  // END_BLOCK_CLEAN_M_ADAPTER_JAPAN_UNRAVELLED_007
}

// START_BLOCK_DEFINE_ADAPTER_M_ADAPTER_JAPAN_UNRAVELLED_008
export const japanUnravelledAdapter: SourceAdapter = {
  sourceId: "japan_unravelled",
  clean,
};
// END_BLOCK_DEFINE_ADAPTER_M_ADAPTER_JAPAN_UNRAVELLED_008
