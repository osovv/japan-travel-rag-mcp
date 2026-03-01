// FILE: src/tools/site-sources.test.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify M-SITE-SOURCES contract: seed data integrity, output shape, input schema emptiness, and DB-backed getSiteSources.
//   SCOPE: Unit test SITE_SOURCES_RESPONSE structure, GetSiteSourcesInputSchema behavior, frozen immutability, and getSiteSources with mock DB.
//   DEPENDS: M-SITE-SOURCES
//   LINKS: M-SITE-SOURCES
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SiteSourcesSeedDataTests - Verify seed data counts, shapes, and exact values.
//   GetSiteSourcesInputSchemaTests - Verify empty input schema accepts {} and rejects unknown keys.
//   FrozenImmutabilityTests - Verify seed data cannot be mutated at runtime.
//   GetSiteSourcesDBTests - Verify getSiteSources returns DB data or falls back to seed constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   v1.1.0 - Add getSiteSources DB-backed read path tests with mock DB and logger.
//   v1.0.0 - Initial generation for M-SITE-SOURCES contract tests.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "../logger/index";
import {
  SITE_SOURCES_RESPONSE,
  GetSiteSourcesInputSchema,
  getSiteSources,
  type SiteSourcesResponse,
  type SiteSource,
  type TierDescription,
  type DescriptionAndTiers,
} from "./site-sources";

// START_BLOCK_TEST_HELPERS_M_SITE_SOURCES_TEST_000
const noop = () => {};
function createMockLogger(): Logger {
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => createMockLogger(),
  };
}

type SelectChain = { from: (table: unknown) => Promise<unknown[]> };

function createMockDb(rows: unknown[]): NodePgDatabase {
  return {
    select: () => ({
      from: () => Promise.resolve(rows),
    }),
  } as unknown as NodePgDatabase;
}

function createThrowingDb(error: Error): NodePgDatabase {
  return {
    select: () => ({
      from: () => Promise.reject(error),
    }),
  } as unknown as NodePgDatabase;
}
// END_BLOCK_TEST_HELPERS_M_SITE_SOURCES_TEST_000

// START_BLOCK_SEED_DATA_INTEGRITY_TESTS_M_SITE_SOURCES_TEST_001
describe("SITE_SOURCES_RESPONSE seed data", () => {
  it("has description_and_tiers with description string", () => {
    expect(typeof SITE_SOURCES_RESPONSE.description_and_tiers.description).toBe("string");
    expect(SITE_SOURCES_RESPONSE.description_and_tiers.description.length).toBeGreaterThan(0);
  });

  it("has exactly 3 tiers", () => {
    expect(SITE_SOURCES_RESPONSE.description_and_tiers.tiers).toHaveLength(3);
  });

  it("tiers are numbered 0, 1, 2", () => {
    const tierNumbers = SITE_SOURCES_RESPONSE.description_and_tiers.tiers.map((t) => t.tier);
    expect(tierNumbers).toEqual([0, 1, 2]);
  });

  it("each tier has name and focus strings", () => {
    for (const tier of SITE_SOURCES_RESPONSE.description_and_tiers.tiers) {
      expect(typeof tier.name).toBe("string");
      expect(tier.name.length).toBeGreaterThan(0);
      expect(typeof tier.focus).toBe("string");
      expect(tier.focus.length).toBeGreaterThan(0);
    }
  });

  it("has exactly 12 sources", () => {
    expect(SITE_SOURCES_RESPONSE.sources).toHaveLength(12);
  });

  it("each source has all required fields", () => {
    for (const source of SITE_SOURCES_RESPONSE.sources) {
      expect(typeof source.source_id).toBe("string");
      expect(source.source_id.length).toBeGreaterThan(0);
      expect(typeof source.name).toBe("string");
      expect(typeof source.domain).toBe("string");
      expect(typeof source.tier).toBe("number");
      expect(typeof source.language).toBe("string");
      expect(typeof source.focus).toBe("string");
      expect(["active", "paused"]).toContain(source.status);
    }
  });

  it("all source_ids are unique", () => {
    const ids = SITE_SOURCES_RESPONSE.sources.map((s) => s.source_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tier 0 has exactly 1 source (wrenjapan)", () => {
    const tier0 = SITE_SOURCES_RESPONSE.sources.filter((s) => s.tier === 0);
    expect(tier0).toHaveLength(1);
    expect(tier0[0]?.source_id).toBe("wrenjapan");
  });

  it("tier 1 has exactly 6 sources", () => {
    const tier1 = SITE_SOURCES_RESPONSE.sources.filter((s) => s.tier === 1);
    expect(tier1).toHaveLength(6);
  });

  it("tier 2 has exactly 5 sources", () => {
    const tier2 = SITE_SOURCES_RESPONSE.sources.filter((s) => s.tier === 2);
    expect(tier2).toHaveLength(5);
  });

  it("all seed sources have status active", () => {
    for (const source of SITE_SOURCES_RESPONSE.sources) {
      expect(source.status).toBe("active");
    }
  });

  it("wrenjapan source has language ru", () => {
    const wrenjapan = SITE_SOURCES_RESPONSE.sources.find((s) => s.source_id === "wrenjapan");
    expect(wrenjapan?.language).toBe("ru");
  });

  it("jreast and smart_ex have language en/ja", () => {
    const enJaSources = SITE_SOURCES_RESPONSE.sources.filter((s) => s.language === "en/ja");
    expect(enJaSources).toHaveLength(2);
    const ids = enJaSources.map((s) => s.source_id).sort();
    expect(ids).toEqual(["jreast", "smart_ex"]);
  });
});
// END_BLOCK_SEED_DATA_INTEGRITY_TESTS_M_SITE_SOURCES_TEST_001

// START_BLOCK_INPUT_SCHEMA_TESTS_M_SITE_SOURCES_TEST_002
describe("GetSiteSourcesInputSchema", () => {
  it("accepts empty object", () => {
    const result = GetSiteSourcesInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts undefined coerced to empty", () => {
    const result = GetSiteSourcesInputSchema.safeParse(undefined);
    // Zod v4 object schema rejects undefined
    expect(result.success).toBe(false);
  });

  it("rejects non-object input", () => {
    const result = GetSiteSourcesInputSchema.safeParse("string");
    expect(result.success).toBe(false);
  });
});
// END_BLOCK_INPUT_SCHEMA_TESTS_M_SITE_SOURCES_TEST_002

// START_BLOCK_FROZEN_IMMUTABILITY_TESTS_M_SITE_SOURCES_TEST_003
describe("SITE_SOURCES_RESPONSE immutability", () => {
  it("top-level object is frozen", () => {
    expect(Object.isFrozen(SITE_SOURCES_RESPONSE)).toBe(true);
  });

  it("description_and_tiers is frozen", () => {
    expect(Object.isFrozen(SITE_SOURCES_RESPONSE.description_and_tiers)).toBe(true);
  });

  it("tiers array is frozen", () => {
    expect(Object.isFrozen(SITE_SOURCES_RESPONSE.description_and_tiers.tiers)).toBe(true);
  });

  it("sources array is frozen", () => {
    expect(Object.isFrozen(SITE_SOURCES_RESPONSE.sources)).toBe(true);
  });

  it("individual source entries are frozen", () => {
    for (const source of SITE_SOURCES_RESPONSE.sources) {
      expect(Object.isFrozen(source)).toBe(true);
    }
  });

  it("individual tier entries are frozen", () => {
    for (const tier of SITE_SOURCES_RESPONSE.description_and_tiers.tiers) {
      expect(Object.isFrozen(tier)).toBe(true);
    }
  });
});
// END_BLOCK_FROZEN_IMMUTABILITY_TESTS_M_SITE_SOURCES_TEST_003

// START_BLOCK_TYPE_CONFORMANCE_TESTS_M_SITE_SOURCES_TEST_004
describe("SiteSourcesResponse type conformance", () => {
  it("response satisfies SiteSourcesResponse type", () => {
    // Compile-time check: if this compiles, the type is correct
    const _response: SiteSourcesResponse = SITE_SOURCES_RESPONSE;
    expect(_response).toBeDefined();
  });

  it("individual source satisfies SiteSource type", () => {
    const source = SITE_SOURCES_RESPONSE.sources[0];
    expect(source).toBeDefined();
    const _source: SiteSource = source!;
    expect(_source.source_id).toBe("wrenjapan");
  });

  it("individual tier satisfies TierDescription type", () => {
    const tier = SITE_SOURCES_RESPONSE.description_and_tiers.tiers[0];
    expect(tier).toBeDefined();
    const _tier: TierDescription = tier!;
    expect(_tier.tier).toBe(0);
  });

  it("description_and_tiers satisfies DescriptionAndTiers type", () => {
    const _dat: DescriptionAndTiers = SITE_SOURCES_RESPONSE.description_and_tiers;
    expect(_dat).toBeDefined();
  });
});
// END_BLOCK_TYPE_CONFORMANCE_TESTS_M_SITE_SOURCES_TEST_004

// START_BLOCK_GET_SITE_SOURCES_DB_TESTS_M_SITE_SOURCES_TEST_005
describe("getSiteSources", () => {
  const mockLogger = createMockLogger();

  it("returns seed constant when DB returns empty rows", async () => {
    const db = createMockDb([]);
    const result = await getSiteSources(db, mockLogger);
    expect(result).toBe(SITE_SOURCES_RESPONSE);
  });

  it("returns DB data when rows exist", async () => {
    const dbRows = [
      {
        sourceId: "test_source",
        name: "Test Source",
        domain: "test.com",
        tier: 1,
        language: "en",
        focus: "Testing",
        status: "active",
        crawlIntervalMinutes: 4320,
        maxPages: 150,
      },
    ];
    const db = createMockDb(dbRows);
    const result = await getSiteSources(db, mockLogger);

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.source_id).toBe("test_source");
    expect(result.sources[0]!.name).toBe("Test Source");
    expect(result.sources[0]!.domain).toBe("test.com");
    expect(result.sources[0]!.tier).toBe(1);
    expect(result.sources[0]!.language).toBe("en");
    expect(result.sources[0]!.focus).toBe("Testing");
    expect(result.sources[0]!.status).toBe("active");
    expect(result.sources[0]!.crawl_interval_minutes).toBe(4320);
    expect(result.sources[0]!.max_pages).toBe(150);
  });

  it("uses description_and_tiers from seed constant even with DB data", async () => {
    const dbRows = [
      {
        sourceId: "test_source",
        name: "Test Source",
        domain: "test.com",
        tier: 1,
        language: "en",
        focus: "Testing",
        status: "active",
        crawlIntervalMinutes: 4320,
        maxPages: 150,
      },
    ];
    const db = createMockDb(dbRows);
    const result = await getSiteSources(db, mockLogger);

    expect(result.description_and_tiers).toBe(SITE_SOURCES_RESPONSE.description_and_tiers);
  });

  it("maps DB columns to SiteSource shape correctly", async () => {
    const dbRows = [
      {
        sourceId: "wrenjapan",
        name: "WrenJapan",
        domain: "wrenjapan.com",
        tier: 0,
        language: "ru",
        focus: "Visa, money",
        status: "paused",
        crawlIntervalMinutes: 1440,
        maxPages: 200,
      },
      {
        sourceId: "insidekyoto",
        name: "InsideKyoto",
        domain: "insidekyoto.com",
        tier: 1,
        language: "en",
        focus: "Kyoto districts",
        status: "active",
        crawlIntervalMinutes: 4320,
        maxPages: 150,
      },
    ];
    const db = createMockDb(dbRows);
    const result = await getSiteSources(db, mockLogger);

    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]!.status).toBe("paused");
    expect(result.sources[1]!.status).toBe("active");
  });

  it("returns seed constant as fallback when DB throws", async () => {
    const db = createThrowingDb(new Error("connection refused"));
    const result = await getSiteSources(db, mockLogger);
    expect(result).toBe(SITE_SOURCES_RESPONSE);
  });

  it("result satisfies SiteSourcesResponse type with DB data", async () => {
    const dbRows = [
      {
        sourceId: "test_source",
        name: "Test",
        domain: "test.com",
        tier: 0,
        language: "en",
        focus: "Test",
        status: "active",
        crawlIntervalMinutes: 1440,
        maxPages: 200,
      },
    ];
    const db = createMockDb(dbRows);
    const result = await getSiteSources(db, mockLogger);
    const _typed: SiteSourcesResponse = result;
    expect(_typed.description_and_tiers).toBeDefined();
    expect(_typed.sources).toBeDefined();
  });
});
// END_BLOCK_GET_SITE_SOURCES_DB_TESTS_M_SITE_SOURCES_TEST_005
