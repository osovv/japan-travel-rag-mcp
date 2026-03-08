# Landing Page Redesign

**Date:** 2026-03-08
**Status:** Approved

## Problem

The current `/` page only shows a short tagline and one button.
It does not explain what TravelMind is, why someone should care, or why they should click through to the portal.

The landing page needs to help a first-time visitor quickly answer three questions:

1. What is this?
2. Why is it useful?
3. What should I do next?

## Solution

Replace the current single-card landing with a full explainer-style page in plain English.

The page should avoid heavy technical language in the first screen and instead position TravelMind as a trusted travel knowledge layer for Japan. Technical credibility should appear as lightweight proof points, not as the primary message.

### Content strategy

- Lead with clarity, not jargon.
- Explain the product in everyday language before mentioning modern AI-tool compatibility.
- Keep copy short and scannable.
- Reuse a consistent CTA that always points to `/portal`.

### Visual direction

- Editorial travel-tech rather than developer-dashboard UI.
- Light, premium, airy presentation.
- Warm neutral background with teal-led accents and a restrained coral highlight.
- Strong display serif for headlines paired with a readable sans-serif body font.
- Signature element: compact "signal cards" that surface product value at a glance.

## Page structure

### 1. Hero

Purpose: explain the product in one screen and present the main CTA.

Content:

- Eyebrow: `Curated travel knowledge for Japan`
- Headline: `Understand Japan faster with trusted travel context`
- Supporting copy: `TravelMind brings useful travel knowledge into one place, so you can explore food, neighborhoods, transport, and trip ideas with more confidence.`
- Primary CTA: `Connect and explore`
- Secondary CTA: `See how it works`
- Trust chips / signal cards: `Curated sources`, `Clearer answers`, `Useful local context`, `Built for modern AI tools`

### 2. Problem framing

Purpose: show why the product exists.

Heading: `Travel advice is everywhere. Clarity is not.`

Copy: `Great travel tips are often buried in long threads, scattered guides, and mixed-quality recommendations. TravelMind helps turn that noise into a clearer starting point.`

### 3. Benefits

Purpose: make the value concrete without sounding technical.

Cards:

1. `Curated knowledge` — `Start from selected travel sources instead of searching from scratch.`
2. `Better context` — `Get practical guidance that helps you understand places, not just list them.`
3. `Faster research` — `Compare options and explore ideas without digging through endless tabs.`
4. `Easy to connect` — `Move from landing page to working setup in just a few steps.`

### 4. How it works

Purpose: remove friction before the portal click.

Steps:

1. `Open the portal`
2. `Connect in a few minutes`
3. `Start exploring Japan with clearer travel context`

Supporting line: `Simple flow, no complicated setup language on the landing page.`

### 5. Audience strip

Purpose: make the product feel relevant across mixed audiences.

Segments:

- `AI users` — `A better travel knowledge starting point for modern AI workflows.`
- `Travel researchers` — `A faster way to compare areas, food spots, and practical trip details.`
- `Agencies and teams` — `A shared layer of travel context for client and internal research.`

### 6. Scope / trust section

Purpose: make the current scope feel intentional.

Heading: `Start with Japan`

Copy: `TravelMind starts with Japan and is designed to grow over time. The goal is simple: help you explore travel questions with more confidence and less noise.`

### 7. Final CTA

Purpose: capture users after the explanation.

- Heading: `Ready to explore?`
- Copy: `Open the portal, connect, and start with Japan.`
- CTA: `Connect and explore`

## Interaction rules

- Primary CTA always goes to `/portal`.
- Secondary hero CTA scrolls to the `How it works` section.
- Final CTA repeats the top action so users do not need to scroll back.
- Layout must work on desktop and mobile.

## Copy guardrails

- Avoid front-loading terms such as `MCP`, `RAG`, `embeddings`, and `vector search`.
- Mention modern AI-tool compatibility only as a supporting proof point.
- Prefer short paragraphs, clear headings, and cards over dense text blocks.

## Implementation notes

- Keep the landing route inside `src/portal/ui-routes.tsx`.
- Continue using server-rendered JSX via `@kitajs/html`.
- Rework `PortalStyles` so the landing page can support richer layout, typography, section spacing, and responsive behavior.
- Preserve the existing `/portal` flow and route behavior.
