import { test, expect, describe } from "bun:test";
import {
  stripSvgPlaceholders,
  stripSocialShareRows,
  stripLegalFooterRows,
  normalizeCleanupWhitespace,
} from "./common";

// ============================================================================
// stripSvgPlaceholders
// ============================================================================

describe("stripSvgPlaceholders", () => {
  test("removes markdown images with data:image/svg+xml URLs", () => {
    const input = `Some text before
![placeholder](data:image/svg+xml,%3Csvg%20xmlns)
Some text after`;
    const result = stripSvgPlaceholders(input);
    expect(result).not.toContain("data:image/svg+xml");
    expect(result).toContain("Some text before");
    expect(result).toContain("Some text after");
  });

  test("removes inline SVG data URIs within a line", () => {
    const input = `Check this ![icon](data:image/svg+xml;base64,PHN2Zz4=) out`;
    const result = stripSvgPlaceholders(input);
    expect(result).toBe("Check this  out");
  });

  test("removes empty image placeholders ![]() on standalone lines", () => {
    const input = `Content above
![]()
Content below`;
    const result = stripSvgPlaceholders(input);
    expect(result).toContain("Content above");
    expect(result).toContain("Content below");
    expect(result).not.toContain("![]()");
  });

  test("removes image links wrapping empty images [![]()](url)", () => {
    const input = `Content above
[![]()](https://example.com/page)
Content below`;
    const result = stripSvgPlaceholders(input);
    expect(result).toContain("Content above");
    expect(result).toContain("Content below");
    expect(result).not.toContain("[![]()]");
  });

  test("preserves images with real URLs", () => {
    const input = `![A temple](https://example.com/temple.jpg)`;
    const result = stripSvgPlaceholders(input);
    expect(result).toBe(input);
  });

  test("preserves images with alt text and real URLs", () => {
    const input = `![Kyoto garden](https://cdn.example.com/images/garden.png)`;
    const result = stripSvgPlaceholders(input);
    expect(result).toBe(input);
  });

  test("does not remove data:image/gif (handled by global.ts)", () => {
    const input = `![](data:image/gif;base64,R0lGODlh)`;
    const result = stripSvgPlaceholders(input);
    // data:image/gif is NOT svg+xml, so it should be preserved (global.ts handles it)
    expect(result).toBe(input);
  });

  test("handles multiple SVG placeholders on different lines", () => {
    const input = `Line 1
![](data:image/svg+xml,%3Csvg)
Line 2
![nav](data:image/svg+xml;base64,PHN2Zz4=)
Line 3`;
    const result = stripSvgPlaceholders(input);
    expect(result).toContain("Line 1");
    expect(result).toContain("Line 2");
    expect(result).toContain("Line 3");
    expect(result).not.toContain("data:image/svg+xml");
  });
});

// ============================================================================
// stripSocialShareRows
// ============================================================================

describe("stripSocialShareRows", () => {
  test("removes standalone facebook share links", () => {
    const input = `Content
[Share on Facebook](https://www.facebook.com/sharer/sharer.php?u=https://example.com)
More content`;
    const result = stripSocialShareRows(input);
    expect(result).not.toContain("facebook.com/sharer");
    expect(result).toContain("Content");
    expect(result).toContain("More content");
  });

  test("removes standalone twitter intent links", () => {
    const input = `Content
[Tweet](https://twitter.com/intent/tweet?url=https://example.com)
More content`;
    const result = stripSocialShareRows(input);
    expect(result).not.toContain("twitter.com/intent");
  });

  test("removes standalone x.com intent links", () => {
    const input = `Content
[Share](https://x.com/intent/tweet?url=https://example.com)
More content`;
    const result = stripSocialShareRows(input);
    expect(result).not.toContain("x.com/intent");
  });

  test("removes standalone flipboard share links", () => {
    const input = `[Flip](https://share.flipboard.com/bookmarklet/popout?url=example.com)`;
    const result = stripSocialShareRows(input);
    expect(result.trim()).toBe("");
  });

  test("removes standalone reddit submit links", () => {
    const input = `[Post to Reddit](https://www.reddit.com/submit?url=https://example.com)`;
    const result = stripSocialShareRows(input);
    expect(result.trim()).toBe("");
  });

  test("removes standalone mailto share links", () => {
    const input = `[Email](mailto:?subject=Check%20this%20out&body=https://example.com)`;
    const result = stripSocialShareRows(input);
    expect(result.trim()).toBe("");
  });

  test("removes SHARE labels", () => {
    const input = `\\ SHARE /
Content here`;
    const result = stripSocialShareRows(input);
    expect(result).not.toContain("SHARE");
    expect(result).toContain("Content here");
  });

  test("removes standalone 'Share' label", () => {
    const input = `Share
Content here`;
    const result = stripSocialShareRows(input);
    expect(result.trim()).toBe("Content here");
  });

  test("removes list-style social share icon links", () => {
    const input = `* [](https://facebook.com/sharer/sharer.php?u=test)
* [](https://twitter.com/intent/tweet?url=test)`;
    const result = stripSocialShareRows(input);
    expect(result.trim()).toBe("");
  });

  test("preserves lines where share links are part of larger content", () => {
    const input = `You can also share your experience on [Facebook](https://facebook.com/sharer/sharer.php?u=test) with friends.`;
    const result = stripSocialShareRows(input);
    expect(result).toContain("share your experience");
  });

  test("preserves normal content mentioning sharing", () => {
    const input = `We share tips for visiting Tokyo temples.`;
    const result = stripSocialShareRows(input);
    expect(result).toBe(input);
  });
});

// ============================================================================
// stripLegalFooterRows
// ============================================================================

describe("stripLegalFooterRows", () => {
  test("removes copyright lines with year", () => {
    const input = `Content here
\u00a9 2024 Japan Travel Guide`;
    const result = stripLegalFooterRows(input);
    expect(result.trim()).toBe("Content here");
  });

  test("removes (c) copyright lines", () => {
    const input = `Content
(c) 2023 All Rights Reserved`;
    const result = stripLegalFooterRows(input);
    expect(result.trim()).toBe("Content");
  });

  test("removes 'Copyright YYYY' lines", () => {
    const input = `Content
Copyright 2024 Travel Inc.`;
    const result = stripLegalFooterRows(input);
    expect(result.trim()).toBe("Content");
  });

  test("removes 'All rights reserved' lines", () => {
    const input = `Content
All rights reserved.`;
    const result = stripLegalFooterRows(input);
    expect(result.trim()).toBe("Content");
  });

  test("removes cookie consent lines", () => {
    const input = `Content
We use cookies on this site to enhance your experience
Accept`;
    const result = stripLegalFooterRows(input);
    expect(result.trim()).toBe("Content");
  });

  test("removes standalone privacy policy links", () => {
    const input = `Content
[Privacy Policy](https://example.com/privacy)`;
    const result = stripLegalFooterRows(input);
    expect(result.trim()).toBe("Content");
  });

  test("removes standalone Terms of Use links", () => {
    const input = `Content
[Terms of Use](https://example.com/terms)`;
    const result = stripLegalFooterRows(input);
    expect(result.trim()).toBe("Content");
  });

  test("removes standalone User Agreement links", () => {
    const input = `Content
[User Agreement](https://example.com/agreement)`;
    const result = stripLegalFooterRows(input);
    expect(result.trim()).toBe("Content");
  });

  test("removes standalone Cookie Policy links", () => {
    const input = `Content
[Cookie Policy](https://example.com/cookies)`;
    const result = stripLegalFooterRows(input);
    expect(result.trim()).toBe("Content");
  });

  test("preserves copyright in larger content paragraphs", () => {
    const input = `The image is copyright 2024 by the photographer and used with permission.`;
    // This line has content before/after — it's part of a paragraph, not standalone
    const result = stripLegalFooterRows(input);
    // The regex matches "copyright 2024..." at start of line, but this has prefix text
    // so it should be preserved
    expect(result).toContain("image is copyright");
  });

  test("preserves privacy mentions in regular paragraphs", () => {
    const input = `We take your [Privacy Policy](https://example.com/privacy) seriously and protect your data.`;
    const result = stripLegalFooterRows(input);
    expect(result).toContain("Privacy Policy");
  });
});

// ============================================================================
// normalizeCleanupWhitespace
// ============================================================================

describe("normalizeCleanupWhitespace", () => {
  test("collapses 3+ blank lines to exactly 2", () => {
    const input = `Line 1\n\n\n\nLine 2`;
    const result = normalizeCleanupWhitespace(input);
    expect(result).toBe("Line 1\n\nLine 2");
  });

  test("preserves 2 consecutive blank lines", () => {
    const input = `Line 1\n\nLine 2`;
    const result = normalizeCleanupWhitespace(input);
    expect(result).toBe("Line 1\n\nLine 2");
  });

  test("preserves single blank lines", () => {
    const input = `Line 1\nLine 2`;
    const result = normalizeCleanupWhitespace(input);
    expect(result).toBe("Line 1\nLine 2");
  });

  test("trims leading whitespace", () => {
    const input = `   \n\nContent here`;
    const result = normalizeCleanupWhitespace(input);
    expect(result).toBe("Content here");
  });

  test("trims trailing whitespace", () => {
    const input = `Content here\n\n   `;
    const result = normalizeCleanupWhitespace(input);
    expect(result).toBe("Content here");
  });

  test("handles multiple runs of excessive blank lines", () => {
    const input = `A\n\n\n\nB\n\n\n\n\nC`;
    const result = normalizeCleanupWhitespace(input);
    expect(result).toBe("A\n\nB\n\nC");
  });

  test("returns empty string for whitespace-only input", () => {
    const result = normalizeCleanupWhitespace("   \n\n\n   ");
    expect(result).toBe("");
  });
});
