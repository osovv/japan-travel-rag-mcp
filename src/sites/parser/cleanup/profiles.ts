// FILE: src/sites/parser/cleanup/profiles.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Profile composers that combine common cleanup primitives with family-specific patterns for Layer B adapters.
//   SCOPE: Editorial profile, transit/official profile, community profile.
//   DEPENDS: M-CLEANUP-COMMON
//   LINKS: M-CLEANUP-PROFILES
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   applyEditorialProfile - Cleanup profile for guide/editorial sources.
//   applyTransitOfficialProfile - Cleanup profile for transit/official sources.
//   applyCommunityProfile - Cleanup profile for community sources.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial profile composers for Phase-12.
// END_CHANGE_SUMMARY

import {
  stripSvgPlaceholders,
  stripSocialShareRows,
  stripLegalFooterRows,
  normalizeCleanupWhitespace,
} from "./common";

// ============================================================================
// EDITORIAL PROFILE PATTERNS
// ============================================================================

// START_BLOCK_DEFINE_EDITORIAL_PATTERNS_M_CLEANUP_PROFILES_001

/** Matches affiliate disclosure blocks: `*This post contains affiliate links...*` */
const AFFILIATE_DISCLOSURE_RE =
  /^\s*\*?This\s+(?:post|article|page)\s+(?:contains?|may\s+contain|includes?)\s+affiliate\s+links[^*]*\*?\s*$/i;

/** Matches "READ MORE:" cross-promotion lines */
const READ_MORE_HEADER_RE = /^\s*(?:READ\s+MORE|RELATED)\s*:/i;

/** Matches Pinterest prompts */
const PINTEREST_PROMPT_RE =
  /^\s*(?:Like\s+it\?\s*Pin\s+it!?|Pin\s+(?:me\s+)?(?:to\s+|on\s+)?Pinterest!?|Save\s+(?:to|on)\s+Pinterest!?)\s*$/i;

/** Matches newsletter/email signup CTAs (standalone lines) */
const NEWSLETTER_CTA_RE =
  /^\s*(?:Sign\s+up\s+for\s+|Enter\s+your\s+email|Subscribe\s*$)/i;

/** Matches lines that are just a standalone markdown link (for READ MORE blocks) */
const STANDALONE_LINK_LINE_RE = /^\s*\[[^\]]+\]\([^)]+\)\s*$/;

// END_BLOCK_DEFINE_EDITORIAL_PATTERNS_M_CLEANUP_PROFILES_001

// ============================================================================
// TRANSIT/OFFICIAL PROFILE PATTERNS
// ============================================================================

// START_BLOCK_DEFINE_TRANSIT_PATTERNS_M_CLEANUP_PROFILES_002

/** Matches app download lines */
const APP_DOWNLOAD_RE =
  /^\s*(?:\[?\s*(?:Download\s+on\s+the\s+App\s+Store|GET\s+IT\s+ON\s+Google\s+Play|Available\s+on\s+the\s+App\s+Store)\s*\]?\s*(?:\([^)]*\))?\s*)$/i;

/** Matches QR code images */
const QR_CODE_IMAGE_RE = /!\[[^\]]*(?:QR|qr)[^\]]*\]\([^)]+\)/;

/** Matches standalone registration CTAs */
const REGISTER_CTA_RE = /^\s*\[Register\s+Here\]\([^)]+\)\s*$/i;

/** Matches JavaScript notice lines */
const JS_NOTICE_RE = /^\s*(?:Please\s+enable\s+JavaScript|JavaScript\s+is\s+(?:required|disabled))/i;

/** Matches template variable artifacts: `{{variableName}}` */
const TEMPLATE_VAR_RE = /^\s*\{\{[^}]+\}\}\s*$/;

// END_BLOCK_DEFINE_TRANSIT_PATTERNS_M_CLEANUP_PROFILES_002

// ============================================================================
// COMMUNITY PROFILE PATTERNS
// ============================================================================

// START_BLOCK_DEFINE_COMMUNITY_PATTERNS_M_CLEANUP_PROFILES_003

/** Matches "New to Reddit?" signup block start */
const REDDIT_SIGNUP_RE = /^\s*New\s+to\s+Reddit\?/i;

/** Matches "Top Posts" / reReddit section headers */
const REDDIT_TOP_POSTS_RE = /^\s*(?:Top\s+Posts|reReddit)\s*$/i;

/** Matches standalone "Read more" and "Share" labels */
const READ_MORE_LABEL_RE = /^\s*(?:Read\s+more|Share)\s*$/i;

/** Matches tracking pixel images: `![](https://id.rlcdn.com/...)` */
const TRACKING_PIXEL_RE = /^\s*!\[\]\(https?:\/\/(?:id\.rlcdn\.com|pixel\.|www\.facebook\.com\/tr)[^)]*\)\s*$/;

/** Matches Privacy Policy link line (end of Reddit signup block) */
const PRIVACY_POLICY_LINE_RE = /^\s*\[Privacy\s+Policy\]\(/i;

// END_BLOCK_DEFINE_COMMUNITY_PATTERNS_M_CLEANUP_PROFILES_003

// START_CONTRACT: applyEditorialProfile
//   PURPOSE: Cleanup profile for guide/editorial sources (insidekyoto, trulytokyo, kansai_odyssey, etc.).
//   INPUTS: { text: string - Markdown text after Layer A global cleanup }
//   OUTPUTS: { string - Text with editorial boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CLEANUP-PROFILES]
// END_CONTRACT: applyEditorialProfile
export function applyEditorialProfile(text: string): string {
  // START_BLOCK_APPLY_EDITORIAL_PROFILE_M_CLEANUP_PROFILES_004

  // Phase 1: Strip SVG placeholders
  let result = stripSvgPlaceholders(text);

  // Phase 2: Line-by-line filtering for editorial-specific noise
  const lines = result.split("\n");
  const filtered: string[] = [];
  let inReadMoreBlock = false;

  for (const line of lines) {
    // Track READ MORE blocks: header + following link-only lines
    if (READ_MORE_HEADER_RE.test(line)) {
      inReadMoreBlock = true;
      continue;
    }
    if (inReadMoreBlock) {
      // Continue skipping link-only lines after READ MORE header
      if (STANDALONE_LINK_LINE_RE.test(line) || line.trim() === "") {
        continue;
      }
      // Non-link, non-empty line ends the READ MORE block
      inReadMoreBlock = false;
    }

    // Skip affiliate disclosures
    if (AFFILIATE_DISCLOSURE_RE.test(line)) continue;

    // Skip Pinterest prompts
    if (PINTEREST_PROMPT_RE.test(line)) continue;

    // Skip newsletter/email signup CTAs
    if (NEWSLETTER_CTA_RE.test(line)) continue;

    filtered.push(line);
  }

  result = filtered.join("\n");

  // Phase 3: Normalize whitespace
  result = normalizeCleanupWhitespace(result);

  return result;
  // END_BLOCK_APPLY_EDITORIAL_PROFILE_M_CLEANUP_PROFILES_004
}

// START_CONTRACT: applyTransitOfficialProfile
//   PURPOSE: Cleanup profile for transit/official sources (navitime, jorudan, jreast, smart_ex).
//   INPUTS: { text: string - Markdown text after Layer A global cleanup }
//   OUTPUTS: { string - Text with transit/official boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CLEANUP-PROFILES]
// END_CONTRACT: applyTransitOfficialProfile
export function applyTransitOfficialProfile(text: string): string {
  // START_BLOCK_APPLY_TRANSIT_OFFICIAL_PROFILE_M_CLEANUP_PROFILES_005

  // Phase 1: Strip SVG placeholders
  let result = stripSvgPlaceholders(text);

  // Phase 2: Line-by-line filtering for transit/official-specific noise
  const lines = result.split("\n");
  const filtered = lines.filter((line) => {
    if (APP_DOWNLOAD_RE.test(line)) return false;
    if (QR_CODE_IMAGE_RE.test(line.trim()) && line.trim().startsWith("!["))
      return false;
    if (REGISTER_CTA_RE.test(line)) return false;
    if (JS_NOTICE_RE.test(line)) return false;
    if (TEMPLATE_VAR_RE.test(line)) return false;
    return true;
  });

  result = filtered.join("\n");

  // Phase 3: Normalize whitespace
  result = normalizeCleanupWhitespace(result);

  return result;
  // END_BLOCK_APPLY_TRANSIT_OFFICIAL_PROFILE_M_CLEANUP_PROFILES_005
}

// START_CONTRACT: applyCommunityProfile
//   PURPOSE: Cleanup profile for community sources (reddit_japantravel).
//   INPUTS: { text: string - Markdown text after Layer A global cleanup }
//   OUTPUTS: { string - Text with community boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-CLEANUP-PROFILES]
// END_CONTRACT: applyCommunityProfile
export function applyCommunityProfile(text: string): string {
  // START_BLOCK_APPLY_COMMUNITY_PROFILE_M_CLEANUP_PROFILES_006

  // Phase 1: Line-by-line filtering with block-level awareness
  // (Must run before stripLegalFooterRows so Privacy Policy end-marker is still present)
  const lines = text.split("\n");
  const filtered: string[] = [];
  let inRedditSignupBlock = false;
  let inTopPostsBlock = false;

  for (const line of lines) {
    // Track "New to Reddit?" signup blocks — skip until Privacy Policy line
    if (REDDIT_SIGNUP_RE.test(line)) {
      inRedditSignupBlock = true;
      continue;
    }
    if (inRedditSignupBlock) {
      if (PRIVACY_POLICY_LINE_RE.test(line)) {
        inRedditSignupBlock = false;
      }
      continue;
    }

    // Track "Top Posts" / reReddit sections — skip until heading (new section)
    if (REDDIT_TOP_POSTS_RE.test(line)) {
      inTopPostsBlock = true;
      continue;
    }
    if (inTopPostsBlock) {
      // End block on a markdown heading (new section)
      if (/^\s*#{1,6}\s+/.test(line)) {
        inTopPostsBlock = false;
        filtered.push(line);
        continue;
      }
      continue;
    }

    // Skip standalone Read more / Share labels
    if (READ_MORE_LABEL_RE.test(line)) continue;

    // Skip tracking pixels
    if (TRACKING_PIXEL_RE.test(line)) continue;

    filtered.push(line);
  }

  let result = filtered.join("\n");

  // Phase 2: Strip legal footer rows
  result = stripLegalFooterRows(result);

  // Phase 3: Strip social share rows
  result = stripSocialShareRows(result);

  // Phase 4: Normalize whitespace
  result = normalizeCleanupWhitespace(result);

  return result;
  // END_BLOCK_APPLY_COMMUNITY_PROFILE_M_CLEANUP_PROFILES_006
}
