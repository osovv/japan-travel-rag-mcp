import { test, expect, describe } from "bun:test";
import {
  applyEditorialProfile,
  applyTransitOfficialProfile,
  applyCommunityProfile,
} from "./profiles";

// ============================================================================
// applyEditorialProfile
// ============================================================================

describe("applyEditorialProfile", () => {
  test("strips affiliate disclosure blocks", () => {
    const input = `Great guide to Kyoto temples.

*This post contains affiliate links. If you make a purchase, we earn a commission at no extra cost to you.*

Here are the top temples to visit.`;
    const result = applyEditorialProfile(input);
    expect(result).not.toContain("affiliate links");
    expect(result).toContain("Great guide to Kyoto temples.");
    expect(result).toContain("Here are the top temples to visit.");
  });

  test("strips affiliate disclosure without asterisks", () => {
    const input = `Some intro.

This article contains affiliate links and we may earn a small commission.

Main content.`;
    const result = applyEditorialProfile(input);
    expect(result).not.toContain("affiliate links");
    expect(result).toContain("Main content.");
  });

  test("strips READ MORE cross-promotion blocks", () => {
    const input = `Visit Fushimi Inari Shrine for amazing torii gates.

READ MORE:
[10 Best Kyoto Restaurants](https://example.com/restaurants)
[Hidden Gems in Osaka](https://example.com/osaka)

Next paragraph of real content.`;
    const result = applyEditorialProfile(input);
    expect(result).not.toContain("READ MORE");
    expect(result).not.toContain("Best Kyoto Restaurants");
    expect(result).not.toContain("Hidden Gems in Osaka");
    expect(result).toContain("Fushimi Inari Shrine");
    expect(result).toContain("Next paragraph of real content.");
  });

  test("strips RELATED cross-promotion blocks", () => {
    const input = `Content here.

RELATED:
[Another Article](https://example.com/related)

More content.`;
    const result = applyEditorialProfile(input);
    expect(result).not.toContain("RELATED:");
    expect(result).not.toContain("Another Article");
    expect(result).toContain("More content.");
  });

  test("strips Pinterest prompts", () => {
    const input = `Beautiful photo of Mt. Fuji.

Like it? Pin it!

The next section discusses...`;
    const result = applyEditorialProfile(input);
    expect(result).not.toContain("Pin it");
    expect(result).toContain("Beautiful photo");
    expect(result).toContain("next section");
  });

  test("strips 'Pin me to Pinterest' variant", () => {
    const input = `Some content.\nPin me to Pinterest\nMore content.`;
    const result = applyEditorialProfile(input);
    expect(result).not.toContain("Pinterest");
  });

  test("strips 'Save to Pinterest' variant", () => {
    const input = `Some content.\nSave to Pinterest!\nMore content.`;
    const result = applyEditorialProfile(input);
    expect(result).not.toContain("Pinterest");
  });

  test("strips newsletter/email signup CTAs", () => {
    const input = `Final tips for your trip.

Sign up for our weekly newsletter!
Enter your email

Thanks for reading.`;
    const result = applyEditorialProfile(input);
    expect(result).not.toContain("Sign up for");
    expect(result).not.toContain("Enter your email");
    expect(result).toContain("Final tips");
    expect(result).toContain("Thanks for reading.");
  });

  test("strips standalone Subscribe CTA", () => {
    const input = `Content.\nSubscribe\nMore content.`;
    const result = applyEditorialProfile(input);
    expect(result).not.toContain("Subscribe");
  });

  test("strips SVG placeholders via common primitive", () => {
    const input = `![nav](data:image/svg+xml,%3Csvg%20xmlns)\nReal content here.`;
    const result = applyEditorialProfile(input);
    expect(result).not.toContain("data:image/svg+xml");
    expect(result).toContain("Real content here.");
  });

  test("normalizes whitespace", () => {
    const input = `Line 1\n\n\n\n\nLine 2`;
    const result = applyEditorialProfile(input);
    expect(result).toBe("Line 1\n\nLine 2");
  });

  test("preserves real content intact", () => {
    const input = `# Best Temples in Kyoto

Kyoto has over 2,000 temples and shrines. Here are our favorites.

## 1. Kinkaku-ji (Golden Pavilion)

The Golden Pavilion is one of Japan's most iconic landmarks.

![Kinkaku-ji](https://example.com/kinkakuji.jpg)`;
    const result = applyEditorialProfile(input);
    expect(result).toBe(input);
  });

  test("READ MORE block ends at non-link content", () => {
    const input = `Intro.

READ MORE:
[Link One](https://example.com/one)

This is real paragraph content that should be kept.`;
    const result = applyEditorialProfile(input);
    expect(result).not.toContain("READ MORE");
    expect(result).not.toContain("Link One");
    expect(result).toContain("real paragraph content");
  });
});

// ============================================================================
// applyTransitOfficialProfile
// ============================================================================

describe("applyTransitOfficialProfile", () => {
  test("strips app download lines", () => {
    const input = `Route information for Shinkansen.

Download on the App Store
GET IT ON Google Play

Check schedule below.`;
    const result = applyTransitOfficialProfile(input);
    expect(result).not.toContain("App Store");
    expect(result).not.toContain("Google Play");
    expect(result).toContain("Route information");
    expect(result).toContain("Check schedule below.");
  });

  test("strips app download with markdown link", () => {
    const input = `[Download on the App Store](https://apps.apple.com/app)`;
    const result = applyTransitOfficialProfile(input);
    expect(result.trim()).toBe("");
  });

  test("strips QR code images", () => {
    const input = `Scan to download:
![QR Code](https://example.com/qr-code.png)
Or visit our website.`;
    const result = applyTransitOfficialProfile(input);
    expect(result).not.toContain("QR Code");
    expect(result).toContain("Scan to download:");
    expect(result).toContain("Or visit our website.");
  });

  test("strips registration CTAs", () => {
    const input = `Create an account for personalized schedules.

[Register Here](https://example.com/register)

View routes below.`;
    const result = applyTransitOfficialProfile(input);
    expect(result).not.toContain("Register Here");
    expect(result).toContain("Create an account");
    expect(result).toContain("View routes below.");
  });

  test("strips JavaScript notices", () => {
    const input = `Please enable JavaScript to use this feature.\nTrain schedule:`;
    const result = applyTransitOfficialProfile(input);
    expect(result).not.toContain("enable JavaScript");
    expect(result).toContain("Train schedule:");
  });

  test("strips template variable artifacts", () => {
    const input = `Station: Tokyo
{{departureTime}}
{{arrivalTime}}
Platform: 5`;
    const result = applyTransitOfficialProfile(input);
    expect(result).not.toContain("{{");
    expect(result).toContain("Station: Tokyo");
    expect(result).toContain("Platform: 5");
  });

  test("strips SVG placeholders via common primitive", () => {
    const input = `![icon](data:image/svg+xml,%3Csvg)\nSchedule info here.`;
    const result = applyTransitOfficialProfile(input);
    expect(result).not.toContain("data:image/svg+xml");
    expect(result).toContain("Schedule info here.");
  });

  test("normalizes whitespace", () => {
    const input = `Line 1\n\n\n\n\nLine 2`;
    const result = applyTransitOfficialProfile(input);
    expect(result).toBe("Line 1\n\nLine 2");
  });

  test("preserves real transit content", () => {
    const input = `# Tokyo to Osaka Shinkansen

The Nozomi train takes approximately 2 hours 15 minutes.

| Departure | Arrival | Duration |
|-----------|---------|----------|
| 06:00     | 08:15   | 2h15m    |`;
    const result = applyTransitOfficialProfile(input);
    expect(result).toBe(input);
  });
});

// ============================================================================
// applyCommunityProfile
// ============================================================================

describe("applyCommunityProfile", () => {
  test("strips 'New to Reddit?' signup blocks through Privacy Policy", () => {
    const input = `Great post about Japan travel tips.

New to Reddit? Create an account
Log in
By continuing, you agree to our
[User Agreement](https://example.com/agreement)
[Privacy Policy](https://example.com/privacy)

I really enjoyed visiting Kyoto.`;
    const result = applyCommunityProfile(input);
    expect(result).not.toContain("New to Reddit");
    expect(result).not.toContain("Create an account");
    expect(result).not.toContain("Log in");
    expect(result).not.toContain("User Agreement");
    expect(result).toContain("Great post about Japan travel tips.");
    expect(result).toContain("I really enjoyed visiting Kyoto.");
  });

  test("strips Top Posts sections", () => {
    const input = `Useful discussion content.

Top Posts

Some trending post title
Another trending post

## Next Section

Real content continues here.`;
    const result = applyCommunityProfile(input);
    expect(result).not.toContain("Top Posts");
    expect(result).not.toContain("trending post");
    expect(result).toContain("Useful discussion content.");
    expect(result).toContain("## Next Section");
    expect(result).toContain("Real content continues here.");
  });

  test("strips reReddit sections", () => {
    const input = `Discussion content.

reReddit

Some recommended post
Another one

## Comments

Real comments here.`;
    const result = applyCommunityProfile(input);
    expect(result).not.toContain("reReddit");
    expect(result).not.toContain("recommended post");
    expect(result).toContain("Discussion content.");
    expect(result).toContain("## Comments");
  });

  test("strips standalone Read more labels", () => {
    const input = `Some comment text.
Read more
More comment text.`;
    const result = applyCommunityProfile(input);
    expect(result).not.toMatch(/^Read more$/m);
    expect(result).toContain("Some comment text.");
    expect(result).toContain("More comment text.");
  });

  test("strips standalone Share labels", () => {
    const input = `Comment text.
Share
More text.`;
    const result = applyCommunityProfile(input);
    expect(result).not.toMatch(/^Share$/m);
  });

  test("strips tracking pixels", () => {
    const input = `Discussion content.
![](https://id.rlcdn.com/463867.gif?n=1)
More content.`;
    const result = applyCommunityProfile(input);
    expect(result).not.toContain("rlcdn.com");
    expect(result).toContain("Discussion content.");
    expect(result).toContain("More content.");
  });

  test("strips facebook tracking pixels", () => {
    const input = `Content.
![](https://www.facebook.com/tr?id=123&ev=PageView)
More content.`;
    const result = applyCommunityProfile(input);
    expect(result).not.toContain("facebook.com/tr");
  });

  test("strips legal footer rows via common primitive", () => {
    const input = `Discussion content.
\u00a9 2024 Reddit Inc.
All rights reserved.`;
    const result = applyCommunityProfile(input);
    expect(result).not.toContain("\u00a9 2024");
    expect(result).not.toContain("All rights reserved");
    expect(result).toContain("Discussion content.");
  });

  test("strips social share rows via common primitive", () => {
    const input = `Post content.
[Share on Facebook](https://www.facebook.com/sharer/sharer.php?u=test)
More content.`;
    const result = applyCommunityProfile(input);
    expect(result).not.toContain("facebook.com/sharer");
  });

  test("normalizes whitespace", () => {
    const input = `Line 1\n\n\n\n\nLine 2`;
    const result = applyCommunityProfile(input);
    expect(result).toBe("Line 1\n\nLine 2");
  });

  test("preserves real community content", () => {
    const input = `# Japan Trip Report - 14 Days

We spent 14 days traveling through Japan, visiting Tokyo, Kyoto, Osaka, and Hiroshima.

## Day 1 - Arrival in Tokyo

Arrived at Narita Airport and took the Narita Express to Shinjuku.`;
    const result = applyCommunityProfile(input);
    expect(result).toBe(input);
  });
});
