// FILE: src/sites/parser/cleanup/adapters/jreast.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Source-specific cleanup adapter (Layer B) for jreast.co.jp content.
//   SCOPE: Remove booking CTA banner, breadcrumb navigation, Vue.js template fragments,
//          Japanese-only UI labels, Adobe Reader download block, AI translation disclaimer,
//          generic disclaimer, train status page UI, scroll-to-top icon, and
//          inline "Opens in a new window" suffix.
//   DEPENDS: M-CLEANUP-COMMON, M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-ADAPTER-JREAST
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   BOOKING_CTA_RE - Booking CTA banner patterns.
//   BREADCRUMB_RE - Breadcrumb navigation pattern.
//   VUE_TEMPLATE_RE - Vue.js template fragment patterns.
//   JP_UI_LABELS - Set of Japanese-only UI label strings.
//   ADOBE_READER_RE - Adobe Reader download block patterns.
//   AI_DISCLAIMER_RE - AI translation disclaimer pattern.
//   GENERIC_DISCLAIMER_RE - Generic disclaimer patterns.
//   TRAIN_STATUS_UI_RE - Train status page UI patterns.
//   PAGETOP_ICON_RE - Scroll-to-top icon pattern.
//   OPENS_NEW_WINDOW_RE - "Opens in a new window" inline text pattern.
//   clean - Main cleanup function removing all jreast-specific noise.
//   jreastAdapter - Exported SourceAdapter constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial jreast adapter for Phase-12 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

import type { SourceAdapter } from "../types";
import {
  stripSvgPlaceholders,
  normalizeCleanupWhitespace,
} from "../common";

// START_BLOCK_DEFINE_BOOKING_CTA_PATTERNS_M_ADAPTER_JREAST_001

/** Booking CTA banner patterns */
const BOOKING_CTA_RE =
  /Buy tickets and passes here|Reserve Today!|JR-East Train Reservation|eki-net\.com/;

// END_BLOCK_DEFINE_BOOKING_CTA_PATTERNS_M_ADAPTER_JREAST_001

// START_BLOCK_DEFINE_BREADCRUMB_PATTERNS_M_ADAPTER_JREAST_002

/** Breadcrumb navigation: lines starting with `* [Home](...)` */
const BREADCRUMB_RE =
  /^\s*\*\s*\[Home\]\(https:\/\/www\.jreast\.co\.jp\/(en\/)?multi\/\)/;

// END_BLOCK_DEFINE_BREADCRUMB_PATTERNS_M_ADAPTER_JREAST_002

// START_BLOCK_DEFINE_VUE_TEMPLATE_PATTERNS_M_ADAPTER_JREAST_003

/** Vue.js template fragments */
const VUE_TEMPLATE_RE = /\{\{(?:sectionName|prefItem)\}\}/;

// END_BLOCK_DEFINE_VUE_TEMPLATE_PATTERNS_M_ADAPTER_JREAST_003

// START_BLOCK_DEFINE_JP_UI_LABELS_M_ADAPTER_JREAST_004

/** Japanese-only UI labels to remove (exact line match after trimming) */
const JP_UI_LABELS: RegExp[] = [
  /^のってたのしい列車とは$/,
  /^地図からさがす$/,
  /^列車の楽しみ方からさがす$/,
  /^閉じる$/,
  /^対象のパスから探す$/,
  /^利用可能なパス$/,
  /^乗車できる列車$/,
  /^詳しくはこちら$/,
  /^PLAY MOVIE\(日本語のみ\)$/,
  // Region/area labels in Japanese
  /^(?:北東北地域|南東北地域|信越地域|関東・伊豆地域)$/,
  // Category labels in Japanese
  /^(?:グルメ|景色|車内・\nイベント|車内・)$/,
  // Section with furigana-like labels
  /^(?:⾞窓からの景⾊を楽しむ|⾞内・イベントを楽しむ|車内グルメを楽しむ)$/,
];

/** JP pass descriptions and disclaimers */
const JP_PASS_DISCLAIMER_RE =
  /^※(?:臨時列車等|一部区間にて|⼀部区間にて)/;

/** JP pass section intro text */
const JP_PASS_INTRO_RE =
  /^以下のパスを(?:お持ちの場合|購⼊すると)/;

// END_BLOCK_DEFINE_JP_UI_LABELS_M_ADAPTER_JREAST_004

// START_BLOCK_DEFINE_ADOBE_READER_PATTERNS_M_ADAPTER_JREAST_005

/** Adobe Reader download block */
const ADOBE_READER_RE =
  /Get Adobe Reader|Download Adobe Reader|get\.adobe\.com\/reader/;

// END_BLOCK_DEFINE_ADOBE_READER_PATTERNS_M_ADAPTER_JREAST_005

// START_BLOCK_DEFINE_DISCLAIMER_PATTERNS_M_ADAPTER_JREAST_006

/** AI translation disclaimer */
const AI_DISCLAIMER_RE =
  /AI translation service is used in a part of this page/;

/** Generic disclaimer */
const GENERIC_DISCLAIMER_RE =
  /Use this information as a guide only|We are not responsible for any damages/;

// END_BLOCK_DEFINE_DISCLAIMER_PATTERNS_M_ADAPTER_JREAST_006

// START_BLOCK_DEFINE_TRAIN_STATUS_UI_PATTERNS_M_ADAPTER_JREAST_007

/** Train status page UI patterns */
const TRAIN_STATUS_UI_RE =
  /This screen does not update automatically/;

/** Update/Delay certificate links on status pages */
const STATUS_NAV_RE =
  /^\s*\*\s*\[(?:Update|Delay certificate)\]/;

// END_BLOCK_DEFINE_TRAIN_STATUS_UI_PATTERNS_M_ADAPTER_JREAST_007

// START_BLOCK_DEFINE_PAGETOP_PATTERNS_M_ADAPTER_JREAST_008

/** Scroll-to-top icon */
const PAGETOP_ICON_RE = /ico_multi_pagetop\.svg/;

// END_BLOCK_DEFINE_PAGETOP_PATTERNS_M_ADAPTER_JREAST_008

// START_BLOCK_DEFINE_OPENS_NEW_WINDOW_PATTERN_M_ADAPTER_JREAST_009

/** "Opens in a new window" suffix — strip INLINE, not the whole line */
const OPENS_NEW_WINDOW_RE = /\s*Opens in a new window\.?\s*/g;

// END_BLOCK_DEFINE_OPENS_NEW_WINDOW_PATTERN_M_ADAPTER_JREAST_009

// START_CONTRACT: clean
//   PURPOSE: Remove all jreast-specific boilerplate noise from crawled markdown content.
//   INPUTS: { text: string - Raw markdown text from jreast.co.jp crawl }
//   OUTPUTS: { string - Cleaned text with boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-JREAST]
// END_CONTRACT: clean
function clean(text: string): string {
  // START_BLOCK_CLEAN_M_ADAPTER_JREAST_010

  // Phase 1: Strip SVG placeholder images (shared primitive)
  let result = stripSvgPlaceholders(text);

  // Phase 2: Inline substitution — strip "Opens in a new window" text within lines
  result = result.replace(OPENS_NEW_WINDOW_RE, " ").replace(/ {2,}/g, " ");

  // Phase 3: Line-by-line noise removal
  const lines = result.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();

    // Booking CTA banner
    if (BOOKING_CTA_RE.test(line)) return false;

    // Breadcrumb navigation
    if (BREADCRUMB_RE.test(line)) return false;

    // Breadcrumb continuation lines (e.g., `* Train & Routes` after breadcrumb)
    // These are typically the last part of a breadcrumb
    if (/^\s*\*\s+[^[\]]+$/.test(line) && lines.indexOf(line) === lines.length - 1) {
      // Only if it's the last line and looks like a breadcrumb trail end
    }

    // Vue.js template fragments
    if (VUE_TEMPLATE_RE.test(line)) return false;

    // Japanese-only UI labels
    if (JP_UI_LABELS.some((re) => re.test(trimmed))) return false;

    // JP pass disclaimers
    if (JP_PASS_DISCLAIMER_RE.test(trimmed)) return false;

    // JP pass intro text
    if (JP_PASS_INTRO_RE.test(trimmed)) return false;

    // Adobe Reader download block
    if (ADOBE_READER_RE.test(line)) return false;

    // AI translation disclaimer
    if (AI_DISCLAIMER_RE.test(line)) return false;

    // Generic disclaimer
    if (GENERIC_DISCLAIMER_RE.test(line)) return false;

    // Train status page UI
    if (TRAIN_STATUS_UI_RE.test(line)) return false;

    // Update/Delay certificate nav links
    if (STATUS_NAV_RE.test(line)) return false;

    // Scroll-to-top icon
    if (PAGETOP_ICON_RE.test(line)) return false;

    return true;
  });

  result = filtered.join("\n");

  // Phase 4: Normalize whitespace
  result = normalizeCleanupWhitespace(result);

  return result;
  // END_BLOCK_CLEAN_M_ADAPTER_JREAST_010
}

// START_BLOCK_DEFINE_ADAPTER_M_ADAPTER_JREAST_011
export const jreastAdapter: SourceAdapter = {
  sourceId: "jreast",
  clean,
};
// END_BLOCK_DEFINE_ADAPTER_M_ADAPTER_JREAST_011
