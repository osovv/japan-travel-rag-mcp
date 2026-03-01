// FILE: src/sites/parser/cleanup/adapters/wrenjapan.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Source-specific cleanup adapter (Layer B) for wrenjapan.com content.
//   SCOPE: Remove wrenjapan navigation menus, newsletter promos, base64 image placeholders,
//          site name headers, footer blocks, related article sections, social share buttons,
//          and empty bold markers from crawled markdown.
//   DEPENDS: M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-SITES-PARSER-CLEANUP-ADAPTERS-WRENJAPAN
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   NAV_MENU_RE - Pattern matching wrenjapan.com category navigation links.
//   NEWSLETTER_RE - Pattern matching newsletter signup promo text.
//   BASE64_PLACEHOLDER_RE - Pattern matching 1x1 transparent GIF base64 image placeholders.
//   SITE_NAME_HEADER_RE - Pattern matching the site name header link.
//   FOOTER_COPYRIGHT_RE - Pattern matching copyright lines in footer.
//   RELATED_ARTICLES_RE - Pattern matching "read also" / related articles section headers.
//   SOCIAL_SHARE_RE - Pattern matching social share button link lines.
//   EMPTY_BOLD_RE - Pattern matching standalone empty bold markers.
//   SVG_PLACEHOLDER_RE - Pattern matching inline SVG placeholder images.
//   isNavMenuLine - Test whether a line is a wrenjapan navigation menu item.
//   isFooterBlock - Test whether a trailing block is footer boilerplate.
//   clean - Main cleanup function removing all wrenjapan-specific noise.
//   wrenjapanAdapter - Exported SourceAdapter constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial wrenjapan adapter for Phase-11 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

import type { SourceAdapter } from "../types";

// START_BLOCK_DEFINE_PATTERNS_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_001

/** Matches wrenjapan category navigation links: `* [Label](https://wrenjapan.com/category/...)` */
const NAV_MENU_RE =
  /^\s*\*\s*\[.*?\]\(https?:\/\/wrenjapan\.com\/category\/[^)]*\)\s*$/;

/** Matches newsletter signup promo text */
const NEWSLETTER_RE =
  /sign up with your email address to be the first to know about new products/i;

/** Matches base64-encoded 1x1 transparent GIF image placeholders */
const BASE64_PLACEHOLDER_RE =
  /!\[.*?\]\(data:image\/gif;base64,R0lGODlhAQABAIAAAAAAAP\/\/\/yH5BAEAAAAALAAAAAABAAEAAAIBRAA7\)/;

/** Matches the site name header link: `[site name](https://wrenjapan.com/)` alone on a line */
const SITE_NAME_HEADER_RE =
  /^\s*\[.*?\]\(https?:\/\/wrenjapan\.com\/?\)\s*$/;

/** Matches copyright / footer lines */
const FOOTER_COPYRIGHT_RE = /^\s*(?:copyright|©|\(c\))\s*\d{4}/i;

/** Matches "read also" / related articles headers in Russian */
const RELATED_ARTICLES_RE =
  /^\s*(?:Читайте\s+также|Вас\s+может\s+заинтересовать)\s*:/;

/** Matches social share button lines (empty link pairs to facebook, twitter, vk, mailto) */
const SOCIAL_SHARE_RE =
  /^\s*\[.*?\]\((?:http:\/\/(?:www\.facebook\.com\/sharer|twitter\.com\/share|vk\.com\/share)|mailto:)\?/;

/** Matches standalone empty bold markers `**` on a line by itself */
const EMPTY_BOLD_RE = /^\s*\*\*\s*$/;

/** Matches inline SVG placeholder images used in prev/next navigation */
const SVG_PLACEHOLDER_RE =
  /!\[.*?\]\(data:image\/svg\+xml,%3Csvg/;

// END_BLOCK_DEFINE_PATTERNS_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_001

// START_CONTRACT: isNavMenuLine
//   PURPOSE: Test whether a line is a wrenjapan navigation menu item.
//   INPUTS: { line: string - Single line of markdown text }
//   OUTPUTS: { boolean - True if line is a nav menu link }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER-CLEANUP-ADAPTERS-WRENJAPAN]
// END_CONTRACT: isNavMenuLine
function isNavMenuLine(line: string): boolean {
  // START_BLOCK_IS_NAV_MENU_LINE_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_002
  return NAV_MENU_RE.test(line);
  // END_BLOCK_IS_NAV_MENU_LINE_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_002
}

// START_CONTRACT: isNoiseLine
//   PURPOSE: Test whether a single line matches any wrenjapan boilerplate noise pattern.
//   INPUTS: { line: string - Single line of markdown text }
//   OUTPUTS: { boolean - True if line is noise that should be removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER-CLEANUP-ADAPTERS-WRENJAPAN]
// END_CONTRACT: isNoiseLine
function isNoiseLine(line: string): boolean {
  // START_BLOCK_IS_NOISE_LINE_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_003
  if (isNavMenuLine(line)) return true;
  if (NEWSLETTER_RE.test(line)) return true;
  if (SITE_NAME_HEADER_RE.test(line)) return true;
  if (FOOTER_COPYRIGHT_RE.test(line)) return true;
  if (RELATED_ARTICLES_RE.test(line)) return true;
  if (SOCIAL_SHARE_RE.test(line)) return true;
  if (EMPTY_BOLD_RE.test(line)) return true;
  if (SVG_PLACEHOLDER_RE.test(line)) return true;
  return false;
  // END_BLOCK_IS_NOISE_LINE_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_003
}

// START_CONTRACT: stripBase64Placeholders
//   PURPOSE: Remove base64 1x1 GIF image placeholders from text, handling both standalone and inline occurrences.
//   INPUTS: { text: string - Full markdown text }
//   OUTPUTS: { string - Text with base64 placeholders removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER-CLEANUP-ADAPTERS-WRENJAPAN]
// END_CONTRACT: stripBase64Placeholders
function stripBase64Placeholders(text: string): string {
  // START_BLOCK_STRIP_BASE64_PLACEHOLDERS_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_004
  // Remove base64 placeholder images (may appear inline alongside other content)
  return text.replace(
    /!\[[^\]]*\]\(data:image\/gif;base64,R0lGODlhAQABAIAAAAAAAP\/\/\/yH5BAEAAAAALAAAAAABAAEAAAIBRAA7\)/g,
    "",
  );
  // END_BLOCK_STRIP_BASE64_PLACEHOLDERS_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_004
}

// START_CONTRACT: stripFooterBlock
//   PURPOSE: Remove trailing footer blocks containing prev/next navigation, social links, and category lists.
//   INPUTS: { text: string - Full markdown text }
//   OUTPUTS: { string - Text with trailing footer removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER-CLEANUP-ADAPTERS-WRENJAPAN]
// END_CONTRACT: stripFooterBlock
function stripFooterBlock(text: string): string {
  // START_BLOCK_STRIP_FOOTER_BLOCK_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_005
  // Footer blocks typically start with prev/next navigation links containing
  // "ранее" (earlier) or "позднее" (later) text markers
  const footerMarkers = [/^\s*\[?\s*ранее\s*\]?/i, /^\s*\[?\s*позднее\s*\]?/i];

  const lines = text.split("\n");
  let cutIndex = lines.length;

  // Scan from the end backwards to find where footer begins
  // Footer typically appears in the last ~30 lines
  const searchStart = Math.max(0, lines.length - 30);
  for (let i = searchStart; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (footerMarkers.some((re) => re.test(line))) {
      cutIndex = i;
      break;
    }
  }

  if (cutIndex < lines.length) {
    return lines.slice(0, cutIndex).join("\n");
  }
  return text;
  // END_BLOCK_STRIP_FOOTER_BLOCK_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_005
}

// START_CONTRACT: clean
//   PURPOSE: Remove all wrenjapan-specific boilerplate noise from crawled markdown content.
//   INPUTS: { text: string - Raw markdown text from wrenjapan.com crawl }
//   OUTPUTS: { string - Cleaned text with boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER-CLEANUP-ADAPTERS-WRENJAPAN]
// END_CONTRACT: clean
function clean(text: string): string {
  // START_BLOCK_CLEAN_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_006

  // Phase 1: Strip base64 image placeholders (inline patterns that span within lines)
  let result = stripBase64Placeholders(text);

  // Phase 2: Remove trailing footer block (prev/next navigation)
  result = stripFooterBlock(result);

  // Phase 3: Line-by-line filtering for navigation, newsletter, headers, social, etc.
  const lines = result.split("\n");
  const filtered = lines.filter((line) => !isNoiseLine(line));
  result = filtered.join("\n");

  // Phase 4: Collapse 3+ consecutive blank lines into 2
  result = result.replace(/\n{3,}/g, "\n\n");

  // Phase 5: Trim leading/trailing whitespace
  result = result.trim();

  return result;
  // END_BLOCK_CLEAN_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_006
}

// START_BLOCK_DEFINE_ADAPTER_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_007
export const wrenjapanAdapter: SourceAdapter = {
  sourceId: "wrenjapan",
  clean,
};
// END_BLOCK_DEFINE_ADAPTER_M_SITES_PARSER_CLEANUP_ADAPTERS_WRENJAPAN_007
