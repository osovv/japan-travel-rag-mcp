// FILE: src/sites/parser/cleanup/adapters/navitime.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Source-specific cleanup adapter (Layer B) for japantravel.navitime.com content.
//   SCOPE: Remove site header/logo/search block, login/My Page links, language selector,
//          Premium Plan/Go to App links, sidebar promo banners, social share rows,
//          cookie consent, area/category mega-menus, 404 detection, app modal elements,
//          and advertising links.
//   DEPENDS: M-CLEANUP-COMMON, M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-ADAPTER-NAVITIME
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   HEADER_NOISE_RE - Patterns for site logo, search icons, login links.
//   LANGUAGE_SELECTOR_RE - Pattern for 14-language selector links.
//   PREMIUM_APP_RE - Premium Plan and Go to App link patterns.
//   SIDEBAR_BANNER_RE - Sidebar promo banner markers (eSIM, Instagram, App, Taiwan, JR Pass).
//   MEGA_MENU_RE - Area/category mega-menu link patterns.
//   APP_MODAL_RE - App modal/close element patterns.
//   ADVERTISING_RE - Advertising link patterns.
//   is404Page - Detect Page Not Found pages.
//   clean - Main cleanup function removing all navitime-specific noise.
//   navitimeAdapter - Exported SourceAdapter constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial navitime adapter for Phase-12 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

import type { SourceAdapter } from "../types";
import {
  stripSvgPlaceholders,
  stripSocialShareRows,
  stripLegalFooterRows,
  normalizeCleanupWhitespace,
} from "../common";

// START_BLOCK_DEFINE_HEADER_NOISE_PATTERNS_M_ADAPTER_NAVITIME_001

/** Site logo + search icons block */
const HEADER_NOISE_RE =
  /ic-site-logo\.svg|検索ボックス|ic-navigationbar-search|ic-header-search/;

/** Login/My Page links */
const LOGIN_MYPAGE_RE =
  /ログイン|\/en\/mypage\?return=|About Premium Plan|About Japan Travel Comfort Package/;

// END_BLOCK_DEFINE_HEADER_NOISE_PATTERNS_M_ADAPTER_NAVITIME_001

// START_BLOCK_DEFINE_LANGUAGE_SELECTOR_PATTERNS_M_ADAPTER_NAVITIME_002

/** 14-language selector links to japantravel.navitime.com/(lang)/... paths */
const LANGUAGE_SELECTOR_RE =
  /japantravel\.navitime\.com\/(?:ko|zh-cn|zh-tw|th|es|fr|de|it|pt|ru|id|vi)\//;

/** Japanese variant of the language selector (travel.navitime.com/ja/) */
const LANGUAGE_SELECTOR_JA_RE = /travel\.navitime\.com\/ja\//;

// END_BLOCK_DEFINE_LANGUAGE_SELECTOR_PATTERNS_M_ADAPTER_NAVITIME_002

// START_BLOCK_DEFINE_PREMIUM_APP_PATTERNS_M_ADAPTER_NAVITIME_003

/** Premium Plan / Go to App links */
const PREMIUM_APP_RE =
  /^\s*(?:\[?\s*)?(?:Premium Plan|Go to App|Japan Travel Comfort Package)\s*(?:\]?\s*$|\]\()/;

/** navitime.co.jp/pcstorage links */
const PCSTORAGE_RE = /navitime\.co\.jp\/pcstorage/;

// END_BLOCK_DEFINE_PREMIUM_APP_PATTERNS_M_ADAPTER_NAVITIME_003

// START_BLOCK_DEFINE_SIDEBAR_BANNER_PATTERNS_M_ADAPTER_NAVITIME_004

/** Sidebar promo banner markers */
const SIDEBAR_BANNER_RE =
  /^-\s+(?:eSIM|JAPAN TRAVEL INSTAGRAM|JAPAN TRAVEL APP|TAIWAN TRAVEL APP|JR PASS CALCULATOR)\s+-\s*$/;

// END_BLOCK_DEFINE_SIDEBAR_BANNER_PATTERNS_M_ADAPTER_NAVITIME_004

// START_BLOCK_DEFINE_MEGA_MENU_PATTERNS_M_ADAPTER_NAVITIME_005

/** Area/category mega-menu links with area codes A\d{4} */
const MEGA_MENU_AREA_RE =
  /japantravel\.navitime\.com\/en\/area\/jp\/interest\/.*\/A\d{4}/;

/** Category mega-menu links (tl01, tl02, etc.) */
const MEGA_MENU_CATEGORY_RE =
  /japantravel\.navitime\.com\/en\/area\/jp\/interest\/tl\d+/;

// END_BLOCK_DEFINE_MEGA_MENU_PATTERNS_M_ADAPTER_NAVITIME_005

// START_BLOCK_DEFINE_APP_MODAL_PATTERNS_M_ADAPTER_NAVITIME_006

/** App modal/close elements */
const APP_MODAL_RE = /close-jt\.svg|apple-touch-icon|\/modal\//;

/** Cookie consent */
const COOKIE_CONSENT_RE =
  /^\s*(?:We use cookies on this site|Accept)\s*$/i;

/** Advertising links */
const ADVERTISING_RE = /広告掲載について|tourism-solution\.navitime\.co\.jp/;

// END_BLOCK_DEFINE_APP_MODAL_PATTERNS_M_ADAPTER_NAVITIME_006

// START_CONTRACT: is404Page
//   PURPOSE: Detect if page is a 404 "Page Not Found" page.
//   INPUTS: { text: string - Raw markdown text }
//   OUTPUTS: { boolean - true if page is a 404 page }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-NAVITIME]
// END_CONTRACT: is404Page
function is404Page(text: string): boolean {
  // START_BLOCK_IS_404_PAGE_M_ADAPTER_NAVITIME_007
  return /^#\s+Page Not Found/m.test(text);
  // END_BLOCK_IS_404_PAGE_M_ADAPTER_NAVITIME_007
}

// START_CONTRACT: stripSidebarBannerBlocks
//   PURPOSE: Remove sidebar promo banner blocks (marker line + following image/link lines).
//   INPUTS: { text: string - Markdown text }
//   OUTPUTS: { string - Text with sidebar banner blocks removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-NAVITIME]
// END_CONTRACT: stripSidebarBannerBlocks
function stripSidebarBannerBlocks(text: string): string {
  // START_BLOCK_STRIP_SIDEBAR_BANNER_BLOCKS_M_ADAPTER_NAVITIME_008
  const lines = text.split("\n");
  const result: string[] = [];
  let inBannerBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (SIDEBAR_BANNER_RE.test(line)) {
      inBannerBlock = true;
      continue;
    }

    if (inBannerBlock) {
      // Banner blocks consist of the marker line followed by image/link lines
      // End when we hit a blank line or another banner marker or non-image/link content
      const trimmed = line.trim();
      if (
        trimmed === "" ||
        trimmed.startsWith("[") ||
        trimmed.startsWith("![") ||
        trimmed.startsWith("](")
      ) {
        continue;
      }
      // Reached content that isn't part of the banner
      inBannerBlock = false;
      result.push(line);
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
  // END_BLOCK_STRIP_SIDEBAR_BANNER_BLOCKS_M_ADAPTER_NAVITIME_008
}

// START_CONTRACT: clean
//   PURPOSE: Remove all navitime-specific boilerplate noise from crawled markdown content.
//   INPUTS: { text: string - Raw markdown text from japantravel.navitime.com crawl }
//   OUTPUTS: { string - Cleaned text with boilerplate removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-NAVITIME]
// END_CONTRACT: clean
function clean(text: string): string {
  // START_BLOCK_CLEAN_M_ADAPTER_NAVITIME_009

  // Early exit: 404 pages
  if (is404Page(text)) {
    return "";
  }

  // Phase 1: Strip SVG placeholder images (shared primitive)
  let result = stripSvgPlaceholders(text);

  // Phase 2: Strip social share rows (shared primitive)
  result = stripSocialShareRows(result);

  // Phase 3: Strip legal footer rows (shared primitive)
  result = stripLegalFooterRows(result);

  // Phase 4: Remove sidebar promo banner blocks
  result = stripSidebarBannerBlocks(result);

  // Phase 5: Line-by-line noise removal
  const lines = result.split("\n");
  const filtered = lines.filter((line) => {
    // Header noise (logo, search icons)
    if (HEADER_NOISE_RE.test(line)) return false;
    // Login/My Page links
    if (LOGIN_MYPAGE_RE.test(line)) return false;
    // Language selector links
    if (LANGUAGE_SELECTOR_RE.test(line)) return false;
    if (LANGUAGE_SELECTOR_JA_RE.test(line)) return false;
    // Premium Plan / Go to App
    if (PREMIUM_APP_RE.test(line)) return false;
    if (PCSTORAGE_RE.test(line)) return false;
    // Area/category mega-menu links (standalone link lines)
    if (MEGA_MENU_AREA_RE.test(line) && /^\s*\*?\s*\[/.test(line))
      return false;
    // Category menu links (standalone)
    if (
      MEGA_MENU_CATEGORY_RE.test(line) &&
      /^\s*\*?\s*\[/.test(line) &&
      !line.includes("guide/")
    )
      return false;
    // App modal/close elements
    if (APP_MODAL_RE.test(line)) return false;
    // Cookie consent
    if (COOKIE_CONSENT_RE.test(line)) return false;
    // Advertising links
    if (ADVERTISING_RE.test(line)) return false;
    // SHARE label (handled more specifically for navitime)
    if (/^\s*\\\\\s*SHARE\s*\/\s*$/.test(line)) return false;
    // Standalone "English" language label
    if (/^\s*English\s*$/.test(line)) return false;
    // Standalone "LOGIN" label
    if (/^\s*LOGIN\s*$/.test(line)) return false;
    // Standalone "Click here" label at end of page
    if (/^\s*Click here\s*$/.test(line)) return false;

    return true;
  });

  result = filtered.join("\n");

  // Phase 6: Normalize whitespace
  result = normalizeCleanupWhitespace(result);

  return result;
  // END_BLOCK_CLEAN_M_ADAPTER_NAVITIME_009
}

// START_BLOCK_DEFINE_ADAPTER_M_ADAPTER_NAVITIME_010
export const navitimeAdapter: SourceAdapter = {
  sourceId: "navitime",
  clean,
};
// END_BLOCK_DEFINE_ADAPTER_M_ADAPTER_NAVITIME_010
