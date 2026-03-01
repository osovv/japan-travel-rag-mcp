// FILE: src/sites/parser/cleanup/common.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Shared cleanup primitives reused by multiple source adapters (Layer B).
//   SCOPE: SVG placeholder removal, social share row removal, legal footer row removal, whitespace normalization.
//   DEPENDS: none
//   LINKS: M-CLEANUP-COMMON
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   stripSvgPlaceholders - Remove markdown images with data:image/svg+xml URLs and empty image placeholders.
//   stripSocialShareRows - Remove standalone social share button lines.
//   stripLegalFooterRows - Remove standalone copyright, cookie consent, and privacy/terms link lines.
//   normalizeCleanupWhitespace - Collapse 3+ blank lines to 2, trim leading/trailing whitespace.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial shared cleanup primitives for Phase-12.
// END_CHANGE_SUMMARY

// START_BLOCK_DEFINE_SVG_PATTERNS_M_CLEANUP_COMMON_001

/** Matches markdown images with data:image/svg+xml URLs (inline) */
const SVG_DATA_IMAGE_RE = /!\[[^\]]*\]\(data:image\/svg\+xml[^)]*\)/g;

/** Matches standalone empty image placeholders: `![]()` on a line by itself */
const EMPTY_IMAGE_LINE_RE = /^\s*!\[\]\(\)\s*$/;

/** Matches image links wrapping empty images: `[![]()](url)` */
const IMAGE_LINK_EMPTY_RE = /^\s*\[!\[\]\(\)\]\([^)]*\)\s*$/;

// END_BLOCK_DEFINE_SVG_PATTERNS_M_CLEANUP_COMMON_001

// START_BLOCK_DEFINE_SOCIAL_SHARE_PATTERNS_M_CLEANUP_COMMON_002

/** Matches standalone lines that are social share button links */
const SOCIAL_SHARE_LINK_RE =
  /^\s*\[?\s*\]?\(?\s*https?:\/\/(?:(?:www\.)?facebook\.com\/sharer|(?:www\.)?twitter\.com\/intent|x\.com\/intent|share\.flipboard\.com|(?:www\.)?reddit\.com\/submit)/i;

/** Matches standalone lines that are markdown links to share URLs */
const SOCIAL_SHARE_MD_LINK_RE =
  /^\s*\[[^\]]*\]\((?:https?:\/\/(?:(?:www\.)?facebook\.com\/sharer|(?:www\.)?twitter\.com\/intent|x\.com\/intent|share\.flipboard\.com|(?:www\.)?reddit\.com\/submit)|mailto:\?subject)[^)]*\)\s*$/;

/** Matches standalone share labels like `\ SHARE /` or just `Share` */
const SHARE_LABEL_RE = /^\s*(?:\\?\s*SHARE\s*\/?\s*|Share\s*)$/;

/** Matches list items that are social share icon links: `* [](https://facebook.com/sharer/...)` */
const SOCIAL_SHARE_LIST_RE =
  /^\s*\*\s*\[\s*\]\(https?:\/\/(?:(?:www\.)?facebook\.com\/sharer|(?:www\.)?twitter\.com\/intent|x\.com\/intent|share\.flipboard\.com|(?:www\.)?reddit\.com\/submit|mailto:\?subject)[^)]*\)\s*$/;

/** Matches standalone mailto:?subject share links */
const MAILTO_SHARE_RE = /^\s*\[?\s*\]?\(?\s*mailto:\?subject/i;

// END_BLOCK_DEFINE_SOCIAL_SHARE_PATTERNS_M_CLEANUP_COMMON_002

// START_BLOCK_DEFINE_LEGAL_FOOTER_PATTERNS_M_CLEANUP_COMMON_003

/** Matches standalone copyright lines: `(C) 20XX`, `All rights reserved`, `Copyright` */
const COPYRIGHT_RE =
  /^\s*(?:(?:\u00a9|\(c\)|copyright)\s*\d{4}.*|.*all\s+rights\s+reserved\.?\s*)$/i;

/** Matches cookie consent lines */
const COOKIE_CONSENT_RE =
  /^\s*(?:we\s+use\s+cookies\s+on\s+this\s+site.*|accept\s*)$/i;

/** Matches standalone privacy/terms links (line is just a single policy link) */
const PRIVACY_TERMS_LINK_RE =
  /^\s*\[(?:Privacy\s+Policy|Terms\s+of\s+(?:Use|Service)|User\s+Agreement|Cookie\s+Policy)\]\([^)]+\)\s*$/i;

// END_BLOCK_DEFINE_LEGAL_FOOTER_PATTERNS_M_CLEANUP_COMMON_003

// START_CONTRACT: stripSvgPlaceholders
//   PURPOSE: Remove markdown images with data:image/svg+xml URLs and empty image placeholders.
//   INPUTS: { text: string - Markdown text }
//   OUTPUTS: { string - Text with SVG placeholders and empty images removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CLEANUP-COMMON]
// END_CONTRACT: stripSvgPlaceholders
export function stripSvgPlaceholders(text: string): string {
  // START_BLOCK_STRIP_SVG_PLACEHOLDERS_M_CLEANUP_COMMON_004

  // Remove inline SVG data URI images
  let result = text.replace(SVG_DATA_IMAGE_RE, "");

  // Filter out empty image lines and image-link-wrapping-empty-image lines
  const lines = result.split("\n");
  const filtered = lines.filter((line) => {
    if (EMPTY_IMAGE_LINE_RE.test(line)) return false;
    if (IMAGE_LINK_EMPTY_RE.test(line)) return false;
    return true;
  });

  return filtered.join("\n");
  // END_BLOCK_STRIP_SVG_PLACEHOLDERS_M_CLEANUP_COMMON_004
}

// START_CONTRACT: stripSocialShareRows
//   PURPOSE: Remove standalone lines that are social share button links or labels.
//   INPUTS: { text: string - Markdown text }
//   OUTPUTS: { string - Text with social share rows removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CLEANUP-COMMON]
// END_CONTRACT: stripSocialShareRows
export function stripSocialShareRows(text: string): string {
  // START_BLOCK_STRIP_SOCIAL_SHARE_ROWS_M_CLEANUP_COMMON_005
  const lines = text.split("\n");
  const filtered = lines.filter((line) => {
    if (SOCIAL_SHARE_MD_LINK_RE.test(line)) return false;
    if (SOCIAL_SHARE_LIST_RE.test(line)) return false;
    if (SHARE_LABEL_RE.test(line)) return false;
    // Standalone bare share URLs (not part of larger content)
    if (SOCIAL_SHARE_LINK_RE.test(line) && line.trim().split(/\s+/).length <= 3)
      return false;
    if (MAILTO_SHARE_RE.test(line) && line.trim().split(/\s+/).length <= 3)
      return false;
    return true;
  });
  return filtered.join("\n");
  // END_BLOCK_STRIP_SOCIAL_SHARE_ROWS_M_CLEANUP_COMMON_005
}

// START_CONTRACT: stripLegalFooterRows
//   PURPOSE: Remove standalone copyright, cookie consent, and privacy/terms link lines.
//   INPUTS: { text: string - Markdown text }
//   OUTPUTS: { string - Text with legal footer rows removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CLEANUP-COMMON]
// END_CONTRACT: stripLegalFooterRows
export function stripLegalFooterRows(text: string): string {
  // START_BLOCK_STRIP_LEGAL_FOOTER_ROWS_M_CLEANUP_COMMON_006
  const lines = text.split("\n");
  const filtered = lines.filter((line) => {
    if (COPYRIGHT_RE.test(line)) return false;
    if (COOKIE_CONSENT_RE.test(line)) return false;
    if (PRIVACY_TERMS_LINK_RE.test(line)) return false;
    return true;
  });
  return filtered.join("\n");
  // END_BLOCK_STRIP_LEGAL_FOOTER_ROWS_M_CLEANUP_COMMON_006
}

// START_CONTRACT: normalizeCleanupWhitespace
//   PURPOSE: Collapse 3+ consecutive blank lines to exactly 2, trim leading/trailing whitespace.
//   INPUTS: { text: string - Text to normalize }
//   OUTPUTS: { string - Whitespace-normalized text }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CLEANUP-COMMON]
// END_CONTRACT: normalizeCleanupWhitespace
export function normalizeCleanupWhitespace(text: string): string {
  // START_BLOCK_NORMALIZE_CLEANUP_WHITESPACE_M_CLEANUP_COMMON_007
  let result = text.replace(/\n{3,}/g, "\n\n");
  result = result.trim();
  return result;
  // END_BLOCK_NORMALIZE_CLEANUP_WHITESPACE_M_CLEANUP_COMMON_007
}
