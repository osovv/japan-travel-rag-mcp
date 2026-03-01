// FILE: src/sites/parser/cleanup/adapters/smart_ex.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Source-specific cleanup adapter (Layer B) for smart-ex.jp content.
//   SCOPE: Remove breadcrumb navigation, app download blocks, app service country list,
//          registration CTAs, FAQ/Help banner, credit card / 3D Secure fine print,
//          screenshot references, screenshot meta-comment, "Back" navigation links,
//          operational UI instructions, EX_RIDE logo, and "For Android users" note.
//   DEPENDS: M-CLEANUP-COMMON, M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-ADAPTER-SMART_EX
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   BREADCRUMB_RE - Breadcrumb navigation pattern.
//   APP_DOWNLOAD_RE - App download block patterns (App Store, Google Play, QR codes, logos, onelink).
//   APP_COUNTRY_LIST_RE - App service country list pattern.
//   REGISTRATION_CTA_RE - Registration CTA patterns.
//   FAQ_HELP_BANNER_RE - FAQ/Help banner patterns.
//   SCREENSHOT_REF_RE - Screenshot reference image patterns.
//   SCREENSHOT_META_RE - Screenshot meta-comment pattern.
//   BACK_NAV_RE - "Back" navigation link pattern.
//   OPERATIONAL_UI_RE - Operational UI instruction pattern.
//   EX_RIDE_LOGO_RE - EX_RIDE logo pattern.
//   ANDROID_NOTE_RE - "For Android users" note pattern.
//   stripAppDownloadBlocks - Remove app download blocks.
//   strip3DSecureFinePrint - Remove 3D Secure fine-print paragraphs.
//   clean - Main cleanup function removing all smart_ex-specific noise.
//   smartExAdapter - Exported SourceAdapter constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial smart_ex adapter for Phase-12 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

import type { SourceAdapter } from "../types";
import { normalizeCleanupWhitespace } from "../common";

// START_BLOCK_DEFINE_BREADCRUMB_PATTERN_M_ADAPTER_SMART_EX_001

/** Breadcrumb navigation: numbered list starting with Home */
const BREADCRUMB_RE = /^\s*\d+\.\s*\[Home\]\(https:\/\/smart-ex\.jp\/en\/\)/;

/** Breadcrumb continuation: numbered list item after Home (e.g., `2. Reservation Guide`) */
const BREADCRUMB_CONTINUATION_RE =
  /^\s*\d+\.\s*(?:\[.+?\]\(https:\/\/smart-ex\.jp\/en\/.+?\)|[A-Z][^[\]]*)\s*$/;

// END_BLOCK_DEFINE_BREADCRUMB_PATTERN_M_ADAPTER_SMART_EX_001

// START_BLOCK_DEFINE_APP_DOWNLOAD_PATTERNS_M_ADAPTER_SMART_EX_002

/** App download elements */
const APP_DOWNLOAD_RE =
  /Download on the App Store|GET IT ON Google Play|qr_code_smart_ex\.png|qr_code_express_ride\.png|logo_appstore\.png|logo_googleplay\.png|onelink\.me/;

/** App service country list header */
const APP_COUNTRY_LIST_RE = /^App service provided in/;

/** Country list items (standalone country names following the header) */
const COUNTRY_NAME_RE =
  /^\s*(?:United States|Canada|Australia|Singapore|Hong Kong|Malaysia|Thailand|Taiwan)\s*$/;

// END_BLOCK_DEFINE_APP_DOWNLOAD_PATTERNS_M_ADAPTER_SMART_EX_002

// START_BLOCK_DEFINE_REGISTRATION_CTA_PATTERNS_M_ADAPTER_SMART_EX_003

/** Registration CTAs */
const REGISTRATION_CTA_RE =
  /\[Register Here\]\(https:\/\/shinkansen2\.jr-central\.co\.jp/;

/** How to Register link */
const HOW_TO_REGISTER_RE =
  /\[How to Register\]\(https:\/\/smart-ex\.jp\/en\//;

// END_BLOCK_DEFINE_REGISTRATION_CTA_PATTERNS_M_ADAPTER_SMART_EX_003

// START_BLOCK_DEFINE_FAQ_HELP_PATTERNS_M_ADAPTER_SMART_EX_004

/** FAQ/Help banner */
const FAQ_HELP_BANNER_RE = /FAQ,HELP,CONTACT|banner_03\.png/;

// END_BLOCK_DEFINE_FAQ_HELP_PATTERNS_M_ADAPTER_SMART_EX_004

// START_BLOCK_DEFINE_SCREENSHOT_PATTERNS_M_ADAPTER_SMART_EX_005

/** Screenshot reference images from reservation path */
const SCREENSHOT_REF_RE =
  /smart-ex\.jp\/en\/common\/images\/reservation\//;

/** Screenshot meta-comment */
const SCREENSHOT_META_RE =
  /The details in the screen shots below.*are images\./;

// END_BLOCK_DEFINE_SCREENSHOT_PATTERNS_M_ADAPTER_SMART_EX_005

// START_BLOCK_DEFINE_BACK_NAV_PATTERNS_M_ADAPTER_SMART_EX_006

/** "Back" navigation links */
const BACK_NAV_RE =
  /^\s*\[Back\]\(https:\/\/smart-ex\.jp\/en\//;

/** Operational UI instructions (tap "Back" button) */
const OPERATIONAL_UI_RE =
  /Be sure to tap "Back" button on the screen/;

// END_BLOCK_DEFINE_BACK_NAV_PATTERNS_M_ADAPTER_SMART_EX_006

// START_BLOCK_DEFINE_EX_RIDE_PATTERNS_M_ADAPTER_SMART_EX_007

/** EX_RIDE logo */
const EX_RIDE_LOGO_RE = /logo_ex_ride\.png/;

/** SmartEX logo in app section */
const SMART_EX_APP_LOGO_RE = /logo_smartEX\.png/;

/** "For Android users" note */
const ANDROID_NOTE_RE =
  /For Android users.*service name will be "smart EX App"/;

// END_BLOCK_DEFINE_EX_RIDE_PATTERNS_M_ADAPTER_SMART_EX_007

// START_BLOCK_DEFINE_3D_SECURE_PATTERNS_M_ADAPTER_SMART_EX_008

/**
 * 3D Secure fine-print paragraphs.
 * Conservative: only strip obvious fine-print about 3D Secure and personal authentication,
 * not booking instructions that mention security codes.
 */
const FINE_PRINT_3D_SECURE_RE =
  /has introduced "\[?3D Secure\]?.*personal authentication service.*to ensure the safety/;

const FINE_PRINT_AUTH_FAIL_RE =
  /If you have not set up the personal authentication service.*you may not be able to use/;

const FINE_PRINT_DEBIT_RE =
  /Due to the settlement procedures for debit cards and prepaid cards/;

/** Standalone [Personal authentication service (3-D Secure...)] link */
const AUTH_SERVICE_LINK_RE =
  /^\s*\[?\s*Personal authentication service/;

// END_BLOCK_DEFINE_3D_SECURE_PATTERNS_M_ADAPTER_SMART_EX_008

// START_CONTRACT: stripBreadcrumbs
//   PURPOSE: Remove breadcrumb navigation lines (numbered list starting with Home).
//   INPUTS: { text: string - Markdown text }
//   OUTPUTS: { string - Text with breadcrumbs removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-SMART_EX]
// END_CONTRACT: stripBreadcrumbs
function stripBreadcrumbs(text: string): string {
  // START_BLOCK_STRIP_BREADCRUMBS_M_ADAPTER_SMART_EX_009
  const lines = text.split("\n");
  const result: string[] = [];
  let inBreadcrumb = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (BREADCRUMB_RE.test(line)) {
      inBreadcrumb = true;
      continue;
    }

    if (inBreadcrumb && BREADCRUMB_CONTINUATION_RE.test(line)) {
      continue;
    }

    inBreadcrumb = false;
    result.push(line);
  }

  return result.join("\n");
  // END_BLOCK_STRIP_BREADCRUMBS_M_ADAPTER_SMART_EX_009
}

// START_CONTRACT: clean
//   PURPOSE: Remove all smart_ex-specific boilerplate noise from crawled markdown content.
//   INPUTS: { text: string - Raw markdown text from smart-ex.jp crawl }
//   OUTPUTS: { string - Cleaned text with boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-SMART_EX]
// END_CONTRACT: clean
function clean(text: string): string {
  // START_BLOCK_CLEAN_M_ADAPTER_SMART_EX_010

  // Phase 1: Strip breadcrumb navigation
  let result = stripBreadcrumbs(text);

  // Phase 2: Line-by-line noise removal
  const lines = result.split("\n");
  const filtered = lines.filter((line) => {
    // App download elements
    if (APP_DOWNLOAD_RE.test(line)) return false;

    // App service country list
    if (APP_COUNTRY_LIST_RE.test(line)) return false;
    if (COUNTRY_NAME_RE.test(line)) return false;

    // Registration CTAs
    if (REGISTRATION_CTA_RE.test(line)) return false;
    if (HOW_TO_REGISTER_RE.test(line)) return false;

    // FAQ/Help banner
    if (FAQ_HELP_BANNER_RE.test(line)) return false;

    // Screenshot reference images
    if (SCREENSHOT_REF_RE.test(line)) return false;

    // Screenshot meta-comment
    if (SCREENSHOT_META_RE.test(line)) return false;

    // "Back" navigation links
    if (BACK_NAV_RE.test(line)) return false;

    // Operational UI instructions
    if (OPERATIONAL_UI_RE.test(line)) return false;

    // EX_RIDE logo
    if (EX_RIDE_LOGO_RE.test(line)) return false;

    // SmartEX app logo in download section
    if (SMART_EX_APP_LOGO_RE.test(line)) return false;

    // "For Android users" note
    if (ANDROID_NOTE_RE.test(line)) return false;

    // 3D Secure fine-print paragraphs (conservative — only obvious fine print)
    if (FINE_PRINT_3D_SECURE_RE.test(line)) return false;
    if (FINE_PRINT_AUTH_FAIL_RE.test(line)) return false;
    if (FINE_PRINT_DEBIT_RE.test(line)) return false;

    // Standalone personal authentication service link block
    if (AUTH_SERVICE_LINK_RE.test(line)) return false;

    return true;
  });

  result = filtered.join("\n");

  // Phase 3: Normalize whitespace
  result = normalizeCleanupWhitespace(result);

  return result;
  // END_BLOCK_CLEAN_M_ADAPTER_SMART_EX_010
}

// START_BLOCK_DEFINE_ADAPTER_M_ADAPTER_SMART_EX_011
export const smartExAdapter: SourceAdapter = {
  sourceId: "smart_ex",
  clean,
};
// END_BLOCK_DEFINE_ADAPTER_M_ADAPTER_SMART_EX_011
