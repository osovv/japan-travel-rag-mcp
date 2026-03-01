// FILE: src/sites/parser/cleanup/adapters/reddit_japantravel.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Source-specific cleanup adapter (Layer B) for Reddit r/JapanTravel community posts.
//   SCOPE: Sandwich extraction of post title + body from Reddit shell. Strips header chrome, flair links,
//          "Archived/Locked post" notices, Related Answers block, signup CTA, Top Posts, footer, and tracking pixels.
//   DEPENDS: M-CLEANUP-COMMON, M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-ADAPTER-REDDIT_JAPANTRAVEL
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   POST_END_MARKERS - Patterns that mark the end of the post body (truncate from first match).
//   FLAIR_LINK_RE - Pattern matching Reddit flair links to strip after title.
//   TRACKING_PIXEL_RE - Pattern matching tracking pixel images.
//   READ_MORE_LINE_RE - Pattern matching standalone "Read more" lines.
//   VOTE_PLACEHOLDER_RE - Pattern matching "0\n0" vote placeholder pairs.
//   findPostStart - Locate the line index where the post title (#) begins.
//   findPostEnd - Locate the line index where post body ends (first end marker).
//   stripFlairLinks - Remove flair link blocks from extracted text.
//   stripInBodyNoise - Remove Read more, vote placeholders, tracking pixels from body.
//   clean - Main cleanup: sandwich extract title+body, strip noise, normalize whitespace.
//   redditJapantravelAdapter - Exported SourceAdapter constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial reddit_japantravel adapter for Phase-12 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

import type { SourceAdapter } from "../types";
import { normalizeCleanupWhitespace } from "../common";

// START_BLOCK_DEFINE_POST_END_MARKERS_M_ADAPTER_REDDIT_JAPANTRAVEL_001

/** End markers — the first one found after the post start triggers truncation. */
const POST_END_MARKERS: RegExp[] = [
  /^Archived post\.\s*New comments cannot be posted/,
  /^Locked post\.\s*New comments cannot be posted/,
  /^Share$/,
  /^Related Answers Section$/,
  /^Related Answers$/,
  /^New to Reddit\?$/,
  /^##\s*Top Posts/,
];

// END_BLOCK_DEFINE_POST_END_MARKERS_M_ADAPTER_REDDIT_JAPANTRAVEL_001

// START_BLOCK_DEFINE_NOISE_PATTERNS_M_ADAPTER_REDDIT_JAPANTRAVEL_002

/** Matches Reddit flair links: `[\nFlair Text\n](https://www.reddit.com/r/JapanTravel/?f=flair_name:...)` */
const FLAIR_LINK_OPEN_RE = /^\[$/;
const FLAIR_LINK_CLOSE_RE =
  /^\]\(https?:\/\/www\.reddit\.com\/r\/JapanTravel\/\?f=flair_name:/;

/** Matches standalone "Read more" lines */
const READ_MORE_LINE_RE = /^\s*Read more\s*$/;

/** Matches tracking pixel images: `![](https://id.rlcdn.com/...)` */
const TRACKING_PIXEL_RE = /^!\[\]\(https?:\/\/id\.rlcdn\.com\//;

// END_BLOCK_DEFINE_NOISE_PATTERNS_M_ADAPTER_REDDIT_JAPANTRAVEL_002

// START_CONTRACT: findPostStart
//   PURPOSE: Locate the line index where the post title (#) begins, after the Reddit header shell.
//   INPUTS: { lines: string[] - Array of text lines }
//   OUTPUTS: { number - Index of the `#` title line, or -1 if not found }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-REDDIT_JAPANTRAVEL]
// END_CONTRACT: findPostStart
function findPostStart(lines: string[]): number {
  // START_BLOCK_FIND_POST_START_M_ADAPTER_REDDIT_JAPANTRAVEL_003
  //
  // Strategy: Find the `•` bullet separator line that precedes the author username link.
  // The post title `#` heading comes after the author link line.
  // In the expanded banner variant, there may be subreddit description text and
  // "Weekly visitors" / "Weekly contributions" lines before the `•`.
  //
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() !== "•") continue;

    // Found bullet separator — now look for the `#` heading after the author link
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const candidate = lines[j] ?? "";
      if (candidate.trim() === "#") {
        return j;
      }
    }
  }
  return -1;
  // END_BLOCK_FIND_POST_START_M_ADAPTER_REDDIT_JAPANTRAVEL_003
}

// START_CONTRACT: findPostEnd
//   PURPOSE: Locate the line index where the post body ends (first end marker after start).
//   INPUTS: { lines: string[] - Array of text lines, startIndex: number - Line index to search from }
//   OUTPUTS: { number - Index of first end marker line, or lines.length if none found }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-REDDIT_JAPANTRAVEL]
// END_CONTRACT: findPostEnd
function findPostEnd(lines: string[], startIndex: number): number {
  // START_BLOCK_FIND_POST_END_M_ADAPTER_REDDIT_JAPANTRAVEL_004
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (POST_END_MARKERS.some((re) => re.test(line))) {
      return i;
    }
  }
  return lines.length;
  // END_BLOCK_FIND_POST_END_M_ADAPTER_REDDIT_JAPANTRAVEL_004
}

// START_CONTRACT: stripFlairLinks
//   PURPOSE: Remove flair link blocks from extracted text. Flair links span 3 lines:
//            `[` then flair text then `](url)`.
//   INPUTS: { lines: string[] - Array of text lines }
//   OUTPUTS: { string[] - Lines with flair link blocks removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-REDDIT_JAPANTRAVEL]
// END_CONTRACT: stripFlairLinks
function stripFlairLinks(lines: string[]): string[] {
  // START_BLOCK_STRIP_FLAIR_LINKS_M_ADAPTER_REDDIT_JAPANTRAVEL_005
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Check if this starts a flair link block: `[` on its own line
    if (FLAIR_LINK_OPEN_RE.test(line.trim())) {
      // Look ahead: next line is flair text, line after closes with `](url)`
      const closeLine = lines[i + 2] ?? "";
      if (FLAIR_LINK_CLOSE_RE.test(closeLine.trim())) {
        // Skip 3 lines: `[`, flair text, `](url)`
        i += 3;
        continue;
      }
    }

    result.push(line);
    i++;
  }
  return result;
  // END_BLOCK_STRIP_FLAIR_LINKS_M_ADAPTER_REDDIT_JAPANTRAVEL_005
}

// START_CONTRACT: stripInBodyNoise
//   PURPOSE: Remove noise lines within extracted post body: "Read more", vote placeholders,
//            tracking pixels.
//   INPUTS: { text: string - Extracted post body text }
//   OUTPUTS: { string - Text with in-body noise removed }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-REDDIT_JAPANTRAVEL]
// END_CONTRACT: stripInBodyNoise
function stripInBodyNoise(text: string): string {
  // START_BLOCK_STRIP_IN_BODY_NOISE_M_ADAPTER_REDDIT_JAPANTRAVEL_006
  const lines = text.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Strip standalone "Read more" lines
    if (READ_MORE_LINE_RE.test(line)) continue;

    // Strip tracking pixel images
    if (TRACKING_PIXEL_RE.test(line.trim())) continue;

    // Strip vote placeholder pairs: a line that is just "0" followed by another "0"
    if (
      line.trim() === "0" &&
      i + 1 < lines.length &&
      (lines[i + 1] ?? "").trim() === "0"
    ) {
      i++; // Skip both lines
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
  // END_BLOCK_STRIP_IN_BODY_NOISE_M_ADAPTER_REDDIT_JAPANTRAVEL_006
}

// START_CONTRACT: clean
//   PURPOSE: Remove all reddit r/JapanTravel-specific boilerplate noise from crawled markdown content
//            using sandwich extraction of post title + body.
//   INPUTS: { text: string - Raw markdown text from Reddit r/JapanTravel crawl }
//   OUTPUTS: { string - Cleaned text with only the post title and body preserved }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-ADAPTER-REDDIT_JAPANTRAVEL]
// END_CONTRACT: clean
function clean(text: string): string {
  // START_BLOCK_CLEAN_M_ADAPTER_REDDIT_JAPANTRAVEL_007

  const lines = text.split("\n");

  // Phase 1: Find post start (the `#` title heading after the `•` author separator)
  const titleIndex = findPostStart(lines);
  if (titleIndex === -1) {
    // Could not find post structure — return empty (quality gate will handle)
    return "";
  }

  // Phase 2: Find post end (first end marker after title)
  const endIndex = findPostEnd(lines, titleIndex + 1);

  // Phase 3: Extract the sandwich — title line (`#`) through to end marker (exclusive)
  // The `#` line is just `#`, and the actual title text is on the next line.
  // We include both the `#` and everything up to the end marker.
  const extracted = lines.slice(titleIndex, endIndex);

  // Phase 4: Strip flair links from extracted content
  const withoutFlairs = stripFlairLinks(extracted);
  let result = withoutFlairs.join("\n");

  // Phase 5: Strip in-body noise (Read more, vote placeholders, tracking pixels)
  result = stripInBodyNoise(result);

  // Phase 6: Normalize whitespace (collapse 3+ blank lines to 2, trim)
  result = normalizeCleanupWhitespace(result);

  return result;
  // END_BLOCK_CLEAN_M_ADAPTER_REDDIT_JAPANTRAVEL_007
}

// START_BLOCK_DEFINE_ADAPTER_M_ADAPTER_REDDIT_JAPANTRAVEL_008
export const redditJapantravelAdapter: SourceAdapter = {
  sourceId: "reddit_japantravel",
  clean,
};
// END_BLOCK_DEFINE_ADAPTER_M_ADAPTER_REDDIT_JAPANTRAVEL_008
