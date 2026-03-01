// FILE: src/sites/parser/cleanup/global.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Layer A of the cleanup pipeline — apply universal noise removal rules to markdown content from Spider crawl results.
//   SCOPE: Data-URI image removal, empty formatting fragment removal, social-share/signup row removal, standalone nav-link line removal, site-name header stripping, whitespace normalization.
//   DEPENDS: none
//   LINKS: M-SITES-PARSER-CLEANUP-GLOBAL
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   globalCleanup - Apply all universal noise removal rules to raw markdown text.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial Layer A global cleanup for Phase-11 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

// START_BLOCK_DEFINE_DATA_URI_IMAGE_PATTERN_M_SITES_PARSER_CLEANUP_GLOBAL_001
/**
 * Matches markdown images whose URL is a data: URI.
 * Example: `![alt text](data:image/gif;base64,R0lGODlh...)`
 */
const DATA_URI_IMAGE_RE = /!\[[^\]]*\]\(data:[^)]+\)/g;
// END_BLOCK_DEFINE_DATA_URI_IMAGE_PATTERN_M_SITES_PARSER_CLEANUP_GLOBAL_001

// START_BLOCK_DEFINE_EMPTY_FORMATTING_PATTERN_M_SITES_PARSER_CLEANUP_GLOBAL_002
/**
 * Matches lines that contain only empty bold/italic markers with no visible text.
 * Covers: `**`, `***`, `__`, `___` (with optional surrounding whitespace).
 */
const EMPTY_FORMATTING_RE = /^\s*(?:\*{2,3}|_{2,3})\s*$/;
// END_BLOCK_DEFINE_EMPTY_FORMATTING_PATTERN_M_SITES_PARSER_CLEANUP_GLOBAL_002

// START_BLOCK_DEFINE_SOCIAL_SHARE_SIGNUP_PATTERN_M_SITES_PARSER_CLEANUP_GLOBAL_003
/**
 * Matches lines containing newsletter/social signup prompts.
 */
const SOCIAL_SIGNUP_RE =
  /sign\s*up\s+with\s+your\s+email|subscribe\s+to\s+our\s+newsletter|sign\s*up\s+for\s+our\s+newsletter/i;
// END_BLOCK_DEFINE_SOCIAL_SHARE_SIGNUP_PATTERN_M_SITES_PARSER_CLEANUP_GLOBAL_003

// START_BLOCK_DEFINE_NAV_LINK_LINE_PATTERN_M_SITES_PARSER_CLEANUP_GLOBAL_004
/**
 * Matches lines that consist entirely of markdown links separated by delimiters
 * (like ` * `, ` | `, ` · `, commas, or bare whitespace).
 *
 * Examples:
 *   [Игры](url) * [Аниме](url) * [Кино](url)
 *   [Home](/) | [About](/about) | [Contact](/contact)
 *
 * The pattern requires at least two links on the line with no other meaningful text.
 */
const NAV_LINK_LINE_RE =
  /^\s*\[[^\]]+\]\([^)]+\)(?:\s*[*|·,]\s*\[[^\]]+\]\([^)]+\))+\s*$/;
// END_BLOCK_DEFINE_NAV_LINK_LINE_PATTERN_M_SITES_PARSER_CLEANUP_GLOBAL_004

// START_BLOCK_DEFINE_SITE_NAME_HEADER_PATTERN_M_SITES_PARSER_CLEANUP_GLOBAL_005
/**
 * Matches lines that are just a single markdown link acting as a site-name header.
 * Example: `[Тот самый Врен](https://wrenjapan.com/)`
 *
 * Must be the only content on the line (aside from optional leading `#` heading markers).
 */
const SITE_NAME_HEADER_RE = /^\s*#{0,6}\s*\[[^\]]+\]\(https?:\/\/[^)]+\)\s*$/;
// END_BLOCK_DEFINE_SITE_NAME_HEADER_PATTERN_M_SITES_PARSER_CLEANUP_GLOBAL_005

// START_CONTRACT: globalCleanup
//   PURPOSE: Apply universal noise removal rules to raw markdown text (Layer A of cleanup pipeline).
//   INPUTS: { text: string - Raw markdown content from Spider crawl }
//   OUTPUTS: { string - Cleaned markdown with noise removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER-CLEANUP-GLOBAL]
// END_CONTRACT: globalCleanup
export function globalCleanup(text: string): string {
  // START_BLOCK_GLOBAL_CLEANUP_M_SITES_PARSER_CLEANUP_GLOBAL_006
  let result = text;

  // 1. Remove data-URI images
  result = result.replace(DATA_URI_IMAGE_RE, "");

  // 2-5. Filter lines: remove empty formatting, social-share/signup, nav-link, and site-name header lines
  const lines = result.split("\n");
  const filtered = lines.filter((line) => {
    // Remove empty formatting fragments
    if (EMPTY_FORMATTING_RE.test(line)) return false;

    // Remove social-share/signup rows
    if (SOCIAL_SIGNUP_RE.test(line)) return false;

    // Remove standalone link-only nav lines
    if (NAV_LINK_LINE_RE.test(line)) return false;

    // Remove site-name header lines (single link as heading)
    if (SITE_NAME_HEADER_RE.test(line)) return false;

    return true;
  });
  result = filtered.join("\n");

  // 6. Whitespace normalization: collapse 3+ consecutive newlines to 2, trim
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.trim();

  return result;
  // END_BLOCK_GLOBAL_CLEANUP_M_SITES_PARSER_CLEANUP_GLOBAL_006
}
