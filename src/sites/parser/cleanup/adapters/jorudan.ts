// FILE: src/sites/parser/cleanup/adapters/jorudan.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Source-specific cleanup adapter (Layer B) for world.jorudan.co.jp content.
//   SCOPE: Detect JS redirect stubs, remove bilingual JP/EN duplicate lines, footer legal links,
//          contact image, pricing/subscription tables, paid login/paywall notices,
//          JavaScript notices, disclaimer blocks, advertising sections, and header "About Us" link.
//   DEPENDS: M-CLEANUP-COMMON, M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-ADAPTER-JORUDAN
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   JS_REDIRECT_RE - Pattern for failed crawl pages with JS redirect stubs.
//   CJK_HEAVY_LINE_RE - Pattern for lines >50% CJK characters.
//   JP_FAQ_MARKER_RE - Japanese FAQ markers (【質問】, 【回答】).
//   FOOTER_LEGAL_RE - Footer legal link patterns.
//   CONTACT_IMAGE_RE - Contact Us mail image pattern.
//   PAID_LOGIN_RE - Paid login/paywall notice patterns.
//   JS_NOTICE_RE - JavaScript enable notice pattern.
//   DISCLAIMER_RE - Disclaimer block patterns.
//   ADVERTISING_RE - Advertising section patterns.
//   ABOUT_US_RE - Header "About Us" link pattern.
//   isJsRedirectStub - Detect JS redirect stub pages.
//   isCjkHeavyLine - Check if a line is >50% CJK characters.
//   clean - Main cleanup function removing all jorudan-specific noise.
//   jorudanAdapter - Exported SourceAdapter constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial jorudan adapter for Phase-12 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

import type { SourceAdapter } from "../types";
import { normalizeCleanupWhitespace } from "../common";

// START_BLOCK_DEFINE_JS_REDIRECT_PATTERN_M_ADAPTER_JORUDAN_001

/** JS redirect stub detection — these are failed crawl pages */
const JS_REDIRECT_RE = /If the page does not move, please click/;

// END_BLOCK_DEFINE_JS_REDIRECT_PATTERN_M_ADAPTER_JORUDAN_001

// START_BLOCK_DEFINE_CJK_PATTERNS_M_ADAPTER_JORUDAN_002

/**
 * CJK unified ideographs range (covers Chinese/Japanese kanji).
 * Also includes hiragana, katakana, and CJK symbols.
 */
const CJK_CHAR_RE =
  /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uFF00-\uFFEF]/g;

/** Japanese FAQ markers */
const JP_FAQ_MARKER_RE = /^(?:【質問】|【回答】)/;

/** Lines that are CJK headings: ## [CJK text] */
const CJK_HEADING_RE = /^##\s+[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uFF00-\uFFEF]/;

// END_BLOCK_DEFINE_CJK_PATTERNS_M_ADAPTER_JORUDAN_002

// START_BLOCK_DEFINE_FOOTER_LEGAL_PATTERNS_M_ADAPTER_JORUDAN_003

/** Footer legal links specific to jorudan */
const FOOTER_LEGAL_RE =
  /^\s*\[?\[(?:Privacy Policy|Information Security Policy|Terms of Use)\]\(https?:\/\/world\.jorudan\.co\.jp/;

/** Contact Us image */
const CONTACT_IMAGE_RE = /Contact Us\s*!\[mail_jtpweb\]/;

// END_BLOCK_DEFINE_FOOTER_LEGAL_PATTERNS_M_ADAPTER_JORUDAN_003

// START_BLOCK_DEFINE_PAYWALL_PATTERNS_M_ADAPTER_JORUDAN_004

/** Paid login / paywall notices */
const PAID_LOGIN_RE =
  /Functions of Japan Transit Planner are available after paid login|有料登録/;

/** JavaScript notices */
const JS_NOTICE_RE =
  /Please enable JavaScript on your browser/;

/** Disclaimer blocks */
const DISCLAIMER_RE =
  /we can't guarantee correctness|Just for your information|Some names may be displayed in Japanese/;

/** JP disclaimer duplicates */
const JP_DISCLAIMER_RE =
  /内容には万全を期しておりますが|あくまでも参考としてご使用ください|一部の名称については、日本語で表示する/;

// END_BLOCK_DEFINE_PAYWALL_PATTERNS_M_ADAPTER_JORUDAN_004

// START_BLOCK_DEFINE_ADVERTISING_PATTERNS_M_ADAPTER_JORUDAN_005

/** Advertising sections */
const ADVERTISING_RE =
  /About advertisement|About targeting advertisement/;

/** Header "About Us" link */
const ABOUT_US_RE =
  /^\s*\[About Us\]\(https:\/\/www\.jorudan\.co\.jp\/company\/english\/\)\s*$/;

// END_BLOCK_DEFINE_ADVERTISING_PATTERNS_M_ADAPTER_JORUDAN_005

// START_CONTRACT: isJsRedirectStub
//   PURPOSE: Detect if page is a JS redirect stub (failed crawl).
//   INPUTS: { text: string - Raw markdown text }
//   OUTPUTS: { boolean - true if page is a JS redirect stub }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-JORUDAN]
// END_CONTRACT: isJsRedirectStub
function isJsRedirectStub(text: string): boolean {
  // START_BLOCK_IS_JS_REDIRECT_STUB_M_ADAPTER_JORUDAN_006
  return JS_REDIRECT_RE.test(text);
  // END_BLOCK_IS_JS_REDIRECT_STUB_M_ADAPTER_JORUDAN_006
}

// START_CONTRACT: isCjkHeavyLine
//   PURPOSE: Check if a standalone line is >50% CJK characters (Japanese duplicate text).
//   INPUTS: { line: string - A single text line }
//   OUTPUTS: { boolean - true if line is >50% CJK characters }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-JORUDAN]
// END_CONTRACT: isCjkHeavyLine
function isCjkHeavyLine(line: string): boolean {
  // START_BLOCK_IS_CJK_HEAVY_LINE_M_ADAPTER_JORUDAN_007
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  // Don't strip lines that are part of markdown structure (headings with mixed content, links, etc.)
  // Only strip standalone text lines that are Japanese duplicates
  const cjkMatches = trimmed.match(CJK_CHAR_RE);
  if (!cjkMatches) return false;
  const cjkCharCount = cjkMatches.length;
  // Count non-whitespace characters
  const nonWhitespace = trimmed.replace(/\s/g, "");
  if (nonWhitespace.length === 0) return false;
  return cjkCharCount / nonWhitespace.length > 0.5;
  // END_BLOCK_IS_CJK_HEAVY_LINE_M_ADAPTER_JORUDAN_007
}

// START_CONTRACT: clean
//   PURPOSE: Remove all jorudan-specific boilerplate noise from crawled markdown content.
//   INPUTS: { text: string - Raw markdown text from world.jorudan.co.jp crawl }
//   OUTPUTS: { string - Cleaned text with boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-JORUDAN]
// END_CONTRACT: clean
function clean(text: string): string {
  // START_BLOCK_CLEAN_M_ADAPTER_JORUDAN_008

  // Early exit: JS redirect stubs are failed crawl pages
  if (isJsRedirectStub(text)) {
    return "";
  }

  // Phase 1: Line-by-line noise removal
  const lines = text.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();

    // Header "About Us" link
    if (ABOUT_US_RE.test(line)) return false;

    // Japanese FAQ markers (standalone JP lines)
    if (JP_FAQ_MARKER_RE.test(trimmed)) return false;

    // CJK-only headings (## followed by CJK text)
    if (CJK_HEADING_RE.test(trimmed)) return false;

    // Footer legal links
    if (FOOTER_LEGAL_RE.test(line)) return false;

    // Contact Us image
    if (CONTACT_IMAGE_RE.test(line)) return false;

    // Paid login / paywall notices
    if (PAID_LOGIN_RE.test(line)) return false;

    // JavaScript notices
    if (JS_NOTICE_RE.test(line)) return false;

    // JP version of JS notice
    if (/この機能をご利用の場合は、ブラウザでJavaScriptを有効にしてください/.test(line)) return false;

    // Disclaimer blocks
    if (DISCLAIMER_RE.test(line)) return false;

    // JP disclaimer duplicates
    if (JP_DISCLAIMER_RE.test(line)) return false;

    // Advertising sections
    if (ADVERTISING_RE.test(line)) return false;

    // Standalone CJK-heavy lines (>50% CJK = Japanese translation duplicates)
    // But skip lines that start with markdown markers for mixed content
    if (
      isCjkHeavyLine(trimmed) &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("[") &&
      !trimmed.startsWith("!")
    ) {
      return false;
    }

    // 【Notice】 markers (JP notice headers)
    if (/^【Notice】/.test(trimmed)) return false;

    return true;
  });

  let result = filtered.join("\n");

  // Phase 2: Normalize whitespace
  result = normalizeCleanupWhitespace(result);

  return result;
  // END_BLOCK_CLEAN_M_ADAPTER_JORUDAN_008
}

// START_BLOCK_DEFINE_ADAPTER_M_ADAPTER_JORUDAN_009
export const jorudanAdapter: SourceAdapter = {
  sourceId: "jorudan",
  clean,
};
// END_BLOCK_DEFINE_ADAPTER_M_ADAPTER_JORUDAN_009
