// FILE: src/sites/parser/cleanup/adapters/invisible_tourist.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Source-specific cleanup adapter (Layer B) for theinvisibletourist.com content.
//   SCOPE: Remove author byline noise, affiliate disclaimers, READ MORE cross-promotion blocks,
//          Pinterest pin prompts, newsletter signup, social share links, author bio block,
//          book promotion, comment section, cookie banner, and subscription box promotions.
//   DEPENDS: M-CLEANUP-COMMON, M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-ADAPTER-INVISIBLE_TOURIST
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   FOOTER_MARKERS - Array of patterns that mark the start of footer boilerplate (truncate from earliest match).
//   findEarliestFooterMarker - Scan lines to find the index of the earliest footer marker.
//   stripFooterFromMarker - Truncate content at the earliest footer marker.
//   stripLineNoise - Remove scattered line-level noise (byline, affiliate, pin, newsletter, etc).
//   stripReadMoreBlocks - Remove READ MORE cross-promotion blocks (header + link lines).
//   clean - Main cleanup function removing all invisible_tourist-specific noise.
//   invisibleTouristAdapter - Exported SourceAdapter constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial invisible_tourist adapter for Phase-12 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

import type { SourceAdapter } from "../types";
import {
  stripSvgPlaceholders,
  stripSocialShareRows,
  stripLegalFooterRows,
  normalizeCleanupWhitespace,
} from "../common";

// START_BLOCK_DEFINE_FOOTER_MARKERS_M_ADAPTER_INVISIBLE_TOURIST_001

/** Footer markers — the first one found triggers truncation of all remaining content. */
const FOOTER_MARKERS: RegExp[] = [
  /^###\s+Like what you see\?/,
  /^##\s+\d+\s+Comments?\s*$/,
  /^###\s+Leave a Reply\s+\[Cancel reply\]/,
];

// END_BLOCK_DEFINE_FOOTER_MARKERS_M_ADAPTER_INVISIBLE_TOURIST_001

// START_BLOCK_DEFINE_LINE_NOISE_PATTERNS_M_ADAPTER_INVISIBLE_TOURIST_002

/** Author byline: `ByAlyse` */
const BYLINE_RE = /^\s*ByAlyse\s*$/;

/** Doubled date pattern: `Month Day, YearMonth Day, Year` */
const DOUBLED_DATE_RE =
  /^\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}\s*$/;

/** Affiliate disclaimer lines (top and bottom) — may or may not be wrapped in `*...*` italics */
const AFFILIATE_DISCLAIMER_RE =
  /^\s*\*?This\s+.{0,80}contains\s+(?:some\s+)?affiliate\s+links/i;

/** Pinterest pin prompt: `Like it? Pin it! 📌` */
const PIN_PROMPT_RE = /^\s*Like it\?\s*Pin it!\s*📌?\s*$/;

/** Inline pin prompt: `*Pin me to Pinterest for reference later!*` or `*Pin me to Pinterest for later reference!*` */
const INLINE_PIN_RE =
  /^\s*\*Pin me to Pinterest for (?:reference later|later reference)!\*\s*$/;

/** Newsletter signup heading */
const NEWSLETTER_HEADING_RE = /^###\s+Like what you see\?\s*✅?\s*Sign up/;

/** Newsletter email input */
const NEWSLETTER_EMAIL_RE = /^\s*Enter your email here\s*$/;

/** Author bio block start: `**[Alyse](https://www.theinvisibletourist.com/author/alyse/)**` */
const AUTHOR_BIO_RE =
  /^\s*\*\*\[Alyse\]\(https:\/\/www\.theinvisibletourist\.com\/author\/alyse\/\)\*\*/;

/** Book promotion: image link to theinvisibletourist.com/shop */
const BOOK_PROMO_RE =
  /\]\(https:\/\/www\.theinvisibletourist\.com\/shop/;

/** Subscription box: `Do you love Japanese sweets, snacks and candies?` */
const SUBSCRIPTION_BOX_RE =
  /^\s*Do you love Japanese sweets,?\s*snacks and candies\?\s*$/;

/** Cookie banner: `We use cookies on this site...OK` or similar */
const COOKIE_BANNER_RE =
  /^\s*We use cookies\s+(?:on this site|to ensure)/i;

/** Cookie banner OK button */
const COOKIE_OK_RE = /^\s*OK\s*$/;

/** Standalone `*` line (separator before share links) */
const LONE_ASTERISK_RE = /^\s*\*\s*$/;

/** Featured image credit line */
const FEATURED_IMAGE_CREDIT_RE =
  /^\s*\*Featured image (?:and first pin )?credit:/;

/** Wrapper anchor at very end */
const WRAPPER_ANCHOR_RE = /^\s*\[(?:\s*)?\]\(#wrapper\)\s*$/;

// END_BLOCK_DEFINE_LINE_NOISE_PATTERNS_M_ADAPTER_INVISIBLE_TOURIST_002

// START_CONTRACT: findEarliestFooterMarker
//   PURPOSE: Scan lines to find the index of the earliest footer marker.
//   INPUTS: { lines: string[] - Array of text lines }
//   OUTPUTS: { number - Index of earliest footer marker line, or lines.length if none found }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-INVISIBLE_TOURIST]
// END_CONTRACT: findEarliestFooterMarker
function findEarliestFooterMarker(lines: string[]): number {
  // START_BLOCK_FIND_EARLIEST_FOOTER_MARKER_M_ADAPTER_INVISIBLE_TOURIST_003
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FOOTER_MARKERS.some((re) => re.test(line))) {
      return i;
    }
  }
  return lines.length;
  // END_BLOCK_FIND_EARLIEST_FOOTER_MARKER_M_ADAPTER_INVISIBLE_TOURIST_003
}

// START_CONTRACT: stripFooterFromMarker
//   PURPOSE: Truncate content at the earliest footer marker.
//   INPUTS: { text: string - Full markdown text }
//   OUTPUTS: { string - Text with footer boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-INVISIBLE_TOURIST]
// END_CONTRACT: stripFooterFromMarker
function stripFooterFromMarker(text: string): string {
  // START_BLOCK_STRIP_FOOTER_FROM_MARKER_M_ADAPTER_INVISIBLE_TOURIST_004
  const lines = text.split("\n");
  const cutIndex = findEarliestFooterMarker(lines);
  if (cutIndex < lines.length) {
    return lines.slice(0, cutIndex).join("\n");
  }
  return text;
  // END_BLOCK_STRIP_FOOTER_FROM_MARKER_M_ADAPTER_INVISIBLE_TOURIST_004
}

// START_CONTRACT: stripReadMoreBlocks
//   PURPOSE: Remove READ MORE cross-promotion blocks (header line + subsequent link lines).
//   INPUTS: { text: string - Markdown text }
//   OUTPUTS: { string - Text with READ MORE blocks removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-INVISIBLE_TOURIST]
// END_CONTRACT: stripReadMoreBlocks
function stripReadMoreBlocks(text: string): string {
  // START_BLOCK_STRIP_READ_MORE_BLOCKS_M_ADAPTER_INVISIBLE_TOURIST_005
  const lines = text.split("\n");
  const result: string[] = [];
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (!inBlock) {
      // Check if this line starts a READ MORE block
      if (/^\s*READ MORE:\s*$/i.test(line)) {
        inBlock = true;
        continue;
      }
      result.push(line);
    } else {
      // Inside a READ MORE block — skip markdown link lines and blank lines
      const trimmed = line.trim();
      if (trimmed === "") {
        // Blank line may end the block — peek ahead
        const next = lines[i + 1]?.trim() ?? "";
        if (next === "" || !/^\[/.test(next)) {
          // End of block
          inBlock = false;
          result.push(line);
        }
        // else continue skipping
        continue;
      }
      if (/^\[.*\]\(https?:\/\//.test(trimmed)) {
        // This is a cross-promotion link line — skip it
        continue;
      }
      // Non-link, non-blank line — end of block, keep this line
      inBlock = false;
      result.push(line);
    }
  }

  return result.join("\n");
  // END_BLOCK_STRIP_READ_MORE_BLOCKS_M_ADAPTER_INVISIBLE_TOURIST_005
}

// START_CONTRACT: stripLineNoise
//   PURPOSE: Remove scattered line-level noise: byline, affiliate disclaimer, pin prompts,
//            newsletter, author bio, book promo, subscription box, cookie banner.
//   INPUTS: { text: string - Markdown text }
//   OUTPUTS: { string - Text with line-level noise removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-INVISIBLE_TOURIST]
// END_CONTRACT: stripLineNoise
function stripLineNoise(text: string): string {
  // START_BLOCK_STRIP_LINE_NOISE_M_ADAPTER_INVISIBLE_TOURIST_006
  const lines = text.split("\n");
  const result: string[] = [];
  let skipAuthorBio = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Skip author bio text (1-2 lines after the author link line)
    if (skipAuthorBio) {
      // Bio text continues until a blank line or a new structural element
      if (line.trim() === "" || /^#{1,6}\s/.test(line)) {
        skipAuthorBio = false;
        result.push(line);
      }
      // else skip the bio line
      continue;
    }

    if (BYLINE_RE.test(line)) continue;
    if (DOUBLED_DATE_RE.test(line)) continue;
    if (AFFILIATE_DISCLAIMER_RE.test(line)) continue;
    if (PIN_PROMPT_RE.test(line)) continue;
    if (INLINE_PIN_RE.test(line)) continue;
    if (NEWSLETTER_HEADING_RE.test(line)) continue;
    if (NEWSLETTER_EMAIL_RE.test(line)) continue;
    if (SUBSCRIPTION_BOX_RE.test(line)) continue;
    if (COOKIE_BANNER_RE.test(line)) continue;
    if (COOKIE_OK_RE.test(line)) continue;
    if (LONE_ASTERISK_RE.test(line)) continue;
    if (FEATURED_IMAGE_CREDIT_RE.test(line)) continue;
    if (WRAPPER_ANCHOR_RE.test(line)) continue;

    // Book promotion: image link to /shop
    if (BOOK_PROMO_RE.test(line)) continue;

    // Author bio block
    if (AUTHOR_BIO_RE.test(line)) {
      skipAuthorBio = true;
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
  // END_BLOCK_STRIP_LINE_NOISE_M_ADAPTER_INVISIBLE_TOURIST_006
}

// START_CONTRACT: clean
//   PURPOSE: Remove all invisible_tourist-specific boilerplate noise from crawled markdown content.
//   INPUTS: { text: string - Raw markdown text from theinvisibletourist.com crawl }
//   OUTPUTS: { string - Cleaned text with boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-INVISIBLE_TOURIST]
// END_CONTRACT: clean
function clean(text: string): string {
  // START_BLOCK_CLEAN_M_ADAPTER_INVISIBLE_TOURIST_007

  // Phase 1: Strip SVG placeholder images
  let result = stripSvgPlaceholders(text);

  // Phase 2: Truncate at earliest footer marker (Like what you see, Comments, Leave a Reply)
  result = stripFooterFromMarker(result);

  // Phase 3: Remove READ MORE cross-promotion blocks
  result = stripReadMoreBlocks(result);

  // Phase 4: Remove scattered line-level noise
  result = stripLineNoise(result);

  // Phase 5: Remove social share rows (uses shared primitive)
  result = stripSocialShareRows(result);

  // Phase 6: Remove legal footer rows (uses shared primitive)
  result = stripLegalFooterRows(result);

  // Phase 7: Normalize whitespace
  result = normalizeCleanupWhitespace(result);

  return result;
  // END_BLOCK_CLEAN_M_ADAPTER_INVISIBLE_TOURIST_007
}

// START_BLOCK_DEFINE_ADAPTER_M_ADAPTER_INVISIBLE_TOURIST_008
export const invisibleTouristAdapter: SourceAdapter = {
  sourceId: "invisible_tourist",
  clean,
};
// END_BLOCK_DEFINE_ADAPTER_M_ADAPTER_INVISIBLE_TOURIST_008
