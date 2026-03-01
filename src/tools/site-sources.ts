// FILE: src/tools/site-sources.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Serve curated source registry via DB-backed read path with frozen seed data as bootstrap/fallback.
//   SCOPE: Provide frozen seed data constant, empty input schema, typed interfaces, and DB query function for the get_site_sources tool.
//   DEPENDS: M-DB, M-LOGGER
//   LINKS: M-SITE-SOURCES
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   TierDescription - Shape for a single tier entry (tier number, name, focus).
//   DescriptionAndTiers - Shape for the description text and tier array.
//   SiteSource - Shape for a single curated source entry (with optional crawl_interval_minutes, max_pages).
//   SiteSourcesResponse - Full response type: description_and_tiers + sources[].
//   GetSiteSourcesInputSchema - Empty z.object({}) schema for FastMCP tool registration.
//   SITE_SOURCES_RESPONSE - Frozen seed data constant containing curated source registry.
//   getSiteSources - Query site_sources DB table and return SiteSourcesResponse; falls back to seed constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   v1.1.0 - Add DB-backed getSiteSources read path with fallback to seed constant; extend SiteSource with crawl_interval_minutes and max_pages.
//   v1.0.0 - Initial creation with frozen seed data, empty input schema, and typed response contract.
// END_CHANGE_SUMMARY

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import type { Logger } from "../logger/index";
import { siteSourcesTable } from "../db/schema";

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
//   OUTPUTS: { source_id: string; name: string; domain: string; tier: number; language: string; focus: string; status: "active" | "paused"; crawl_interval_minutes?: number; max_pages?: number }
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
  readonly crawl_interval_minutes?: number;
  readonly max_pages?: number;
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

// START_CONTRACT: getSiteSources
//   PURPOSE: Query site_sources table and return SiteSourcesResponse with live DB data; falls back to seed constant if DB is empty.
//   INPUTS: { db: NodePgDatabase - Drizzle database handle, logger: Logger - Module logger }
//   OUTPUTS: { Promise<SiteSourcesResponse> }
//   SIDE_EFFECTS: [Reads from site_sources table, logs query result]
//   LINKS: [M-SITE-SOURCES, M-DB, M-LOGGER]
// END_CONTRACT: getSiteSources
// START_BLOCK_GET_SITE_SOURCES_FROM_DB_M_SITE_SOURCES_003
export async function getSiteSources(
  db: NodePgDatabase,
  logger: Logger,
): Promise<SiteSourcesResponse> {
  try {
    const rows = await db
      .select({
        sourceId: siteSourcesTable.sourceId,
        name: siteSourcesTable.name,
        domain: siteSourcesTable.domain,
        tier: siteSourcesTable.tier,
        language: siteSourcesTable.language,
        focus: siteSourcesTable.focus,
        status: siteSourcesTable.status,
        crawlIntervalMinutes: siteSourcesTable.crawlIntervalMinutes,
        maxPages: siteSourcesTable.maxPages,
      })
      .from(siteSourcesTable);

    if (rows.length === 0) {
      logger.info(
        "No rows in site_sources table; returning seed constant as fallback.",
        "getSiteSources",
        "DB_EMPTY_FALLBACK",
      );
      return SITE_SOURCES_RESPONSE;
    }

    const sources: SiteSource[] = rows.map((row) => ({
      source_id: row.sourceId,
      name: row.name,
      domain: row.domain,
      tier: row.tier,
      language: row.language,
      focus: row.focus,
      status: row.status as "active" | "paused",
      crawl_interval_minutes: row.crawlIntervalMinutes,
      max_pages: row.maxPages,
    }));

    logger.info(
      `Loaded ${sources.length} site sources from database.`,
      "getSiteSources",
      "DB_READ_SUCCESS",
    );

    return {
      description_and_tiers: SITE_SOURCES_RESPONSE.description_and_tiers,
      sources,
    };
  } catch (error: unknown) {
    const cause = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Failed to query site_sources table; returning seed constant as fallback. Cause: ${cause}`,
      "getSiteSources",
      "DB_READ_FALLBACK_ON_ERROR",
    );
    return SITE_SOURCES_RESPONSE;
  }
}
// END_BLOCK_GET_SITE_SOURCES_FROM_DB_M_SITE_SOURCES_003
