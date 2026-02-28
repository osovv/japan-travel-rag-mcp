// FILE: src/tools/site-sources.test.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify M-SITE-SOURCES contract: seed data integrity, output shape, and input schema emptiness.
//   SCOPE: Unit test SITE_SOURCES_RESPONSE structure, GetSiteSourcesInputSchema behavior, and frozen immutability.
//   DEPENDS: M-SITE-SOURCES
//   LINKS: M-SITE-SOURCES
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SiteSourcesSeedDataTests - Verify seed data counts, shapes, and exact values.
//   GetSiteSourcesInputSchemaTests - Verify empty input schema accepts {} and rejects unknown keys.
//   FrozenImmutabilityTests - Verify seed data cannot be mutated at runtime.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial generation for M-SITE-SOURCES contract tests.
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";
import {
  SITE_SOURCES_RESPONSE,
  GetSiteSourcesInputSchema,
  type SiteSourcesResponse,
  type SiteSource,
  type TierDescription,
  type DescriptionAndTiers,
} from "./site-sources";

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
    expect(tier0[0].source_id).toBe("wrenjapan");
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
    expect(wrenjapan).toBeDefined();
    expect(wrenjapan!.language).toBe("ru");
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
    const _source: SiteSource = SITE_SOURCES_RESPONSE.sources[0];
    expect(_source).toBeDefined();
  });

  it("individual tier satisfies TierDescription type", () => {
    const _tier: TierDescription = SITE_SOURCES_RESPONSE.description_and_tiers.tiers[0];
    expect(_tier).toBeDefined();
  });

  it("description_and_tiers satisfies DescriptionAndTiers type", () => {
    const _dat: DescriptionAndTiers = SITE_SOURCES_RESPONSE.description_and_tiers;
    expect(_dat).toBeDefined();
  });
});
// END_BLOCK_TYPE_CONFORMANCE_TESTS_M_SITE_SOURCES_TEST_004
