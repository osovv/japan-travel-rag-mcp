// FILE: src/tools/site-sources.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Serve curated source registry as a static MCP tool response with typed output contract and frozen seed data.
//   SCOPE: Provide frozen seed data constant, empty input schema, and typed interfaces for the get_site_sources local tool.
//   DEPENDS: (none)
//   LINKS: M-SITE-SOURCES
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   TierDescription - Shape for a single tier entry (tier number, name, focus).
//   DescriptionAndTiers - Shape for the description text and tier array.
//   SiteSource - Shape for a single curated source entry.
//   SiteSourcesResponse - Full response type: description_and_tiers + sources[].
//   GetSiteSourcesInputSchema - Empty z.object({}) schema for FastMCP tool registration.
//   SITE_SOURCES_RESPONSE - Frozen seed data constant containing curated source registry.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial creation with frozen seed data, empty input schema, and typed response contract.
// END_CHANGE_SUMMARY

import { z } from "zod";

// START_CONTRACT: TierDescription
//   PURPOSE: Describe a single tier in the source priority hierarchy.
//   INPUTS: (none — type definition)
//   OUTPUTS: { tier: number; name: string; focus: string }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITE-SOURCES]
// END_CONTRACT: TierDescription
export type TierDescription = {
  readonly tier: number;
  readonly name: string;
  readonly focus: string;
};

// START_CONTRACT: DescriptionAndTiers
//   PURPOSE: Bundle the human-readable registry description with the ordered tier list.
//   INPUTS: (none — type definition)
//   OUTPUTS: { description: string; tiers: TierDescription[] }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITE-SOURCES]
// END_CONTRACT: DescriptionAndTiers
export type DescriptionAndTiers = {
  readonly description: string;
  readonly tiers: readonly TierDescription[];
};

// START_CONTRACT: SiteSource
//   PURPOSE: Represent a single curated source in the registry.
//   INPUTS: (none — type definition)
//   OUTPUTS: { source_id: string; name: string; domain: string; tier: number; language: string; focus: string; status: "active" | "paused" }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITE-SOURCES]
// END_CONTRACT: SiteSource
export type SiteSource = {
  readonly source_id: string;
  readonly name: string;
  readonly domain: string;
  readonly tier: number;
  readonly language: string;
  readonly focus: string;
  readonly status: "active" | "paused";
};

// START_CONTRACT: SiteSourcesResponse
//   PURPOSE: Full response shape returned by the get_site_sources tool.
//   INPUTS: (none — type definition)
//   OUTPUTS: { description_and_tiers: DescriptionAndTiers; sources: SiteSource[] }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITE-SOURCES]
// END_CONTRACT: SiteSourcesResponse
export type SiteSourcesResponse = {
  readonly description_and_tiers: DescriptionAndTiers;
  readonly sources: readonly SiteSource[];
};

// START_CONTRACT: GetSiteSourcesInputSchema
//   PURPOSE: Empty input schema for FastMCP tool registration — get_site_sources takes no parameters.
//   INPUTS: (none — schema definition)
//   OUTPUTS: z.ZodObject<{}>
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITE-SOURCES]
// END_CONTRACT: GetSiteSourcesInputSchema
// START_BLOCK_EMPTY_INPUT_SCHEMA_M_SITE_SOURCES_001
export const GetSiteSourcesInputSchema = z.object({});
// END_BLOCK_EMPTY_INPUT_SCHEMA_M_SITE_SOURCES_001

// START_CONTRACT: SITE_SOURCES_RESPONSE
//   PURPOSE: Frozen seed data constant containing the curated source registry from the product guide.
//   INPUTS: (none — constant)
//   OUTPUTS: SiteSourcesResponse
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITE-SOURCES]
// END_CONTRACT: SITE_SOURCES_RESPONSE
// START_BLOCK_FROZEN_SEED_DATA_M_SITE_SOURCES_002
export const SITE_SOURCES_RESPONSE: SiteSourcesResponse = Object.freeze({
  description_and_tiers: Object.freeze({
    description:
      "Curated sources for practical Japan travel research. Prioritize actionable logistics over generic listicles.",
    tiers: Object.freeze([
      Object.freeze({
        tier: 0,
        name: "WrenJapan First",
        focus: "RU practical essentials: visa, money, accommodation, transport, budgets",
      }),
      Object.freeze({
        tier: 1,
        name: "Authoritative Guides",
        focus: "City/district planning, itineraries, practical guidance",
      }),
      Object.freeze({
        tier: 2,
        name: "Community and Transit Tools",
        focus: "Real traveler edge-cases and route/fare tools",
      }),
    ] as const),
  }),
  sources: Object.freeze([
    Object.freeze({
      source_id: "wrenjapan",
      name: "WrenJapan (\u041a\u043e\u043d\u0441\u0442\u0430\u043d\u0442\u0438\u043d \u0413\u043e\u0432\u043e\u0440\u0443\u043d)",
      domain: "wrenjapan.com",
      tier: 0,
      language: "ru",
      focus: "Visa, money, stay, flights, transport, trip budgets",
      status: "active" as const,
    }),
    Object.freeze({
      source_id: "insidekyoto",
      name: "InsideKyoto",
      domain: "insidekyoto.com",
      tier: 1,
      language: "en",
      focus: "Kyoto districts, itineraries, where to stay",
      status: "active" as const,
    }),
    Object.freeze({
      source_id: "trulytokyo",
      name: "TrulyTokyo",
      domain: "trulytokyo.com",
      tier: 1,
      language: "en",
      focus: "Tokyo districts, food, accommodation, routes",
      status: "active" as const,
    }),
    Object.freeze({
      source_id: "kansai_odyssey",
      name: "Kansai Odyssey",
      domain: "kansai-odyssey.com",
      tier: 1,
      language: "en",
      focus: "Off-the-beaten-path Kansai",
      status: "active" as const,
    }),
    Object.freeze({
      source_id: "invisible_tourist",
      name: "The Invisible Tourist",
      domain: "theinvisibletourist.com",
      tier: 1,
      language: "en",
      focus: "Anti-overtourism, less crowded routes",
      status: "active" as const,
    }),
    Object.freeze({
      source_id: "japan_unravelled",
      name: "Japan Unravelled",
      domain: "japanunravelled.substack.com",
      tier: 1,
      language: "en",
      focus: "Beginner mistakes, monthly practical insights",
      status: "active" as const,
    }),
    Object.freeze({
      source_id: "japan_guide",
      name: "Japan-Guide",
      domain: "japan-guide.com",
      tier: 1,
      language: "en",
      focus: "Reference skeleton: regions, transport, key places",
      status: "active" as const,
    }),
    Object.freeze({
      source_id: "reddit_japantravel",
      name: "r/JapanTravel",
      domain: "reddit.com/r/JapanTravel",
      tier: 2,
      language: "en",
      focus: "FAQ, trip reports, edge cases",
      status: "active" as const,
    }),
    Object.freeze({
      source_id: "navitime",
      name: "NAVITIME",
      domain: "japantravel.navitime.com",
      tier: 2,
      language: "en",
      focus: "Route planning and pass support",
      status: "active" as const,
    }),
    Object.freeze({
      source_id: "jorudan",
      name: "Jorudan",
      domain: "world.jorudan.co.jp",
      tier: 2,
      language: "en",
      focus: "Route, fare, and time calculator",
      status: "active" as const,
    }),
    Object.freeze({
      source_id: "jreast",
      name: "JR East",
      domain: "jreast.co.jp",
      tier: 2,
      language: "en/ja",
      focus: "Official railway status and base info",
      status: "active" as const,
    }),
    Object.freeze({
      source_id: "smart_ex",
      name: "SmartEX",
      domain: "smart-ex.jp",
      tier: 2,
      language: "en/ja",
      focus: "Shinkansen online reservations",
      status: "active" as const,
    }),
  ] as const),
});
// END_BLOCK_FROZEN_SEED_DATA_M_SITE_SOURCES_002
