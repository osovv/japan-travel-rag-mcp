// FILE: src/sites/parser/cleanup/registry.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Central registry mapping source_id strings to their SourceAdapter instances.
//   SCOPE: Provide lookup and enumeration of all supported cleanup adapters.
//   DEPENDS: M-SITES-PARSER-CLEANUP-TYPES, all 12 adapter modules
//   LINKS: M-SITES-PARSER-CLEANUP-REGISTRY
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ADAPTER_MAP - ReadonlyMap of source_id → SourceAdapter for all registered adapters.
//   SUPPORTED_CLEANUP_SOURCE_IDS - Alphabetically sorted array of all supported source IDs.
//   getCleanupAdapter - Resolve a SourceAdapter by source_id, or null if unknown.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial adapter registry for Phase-12 cleanup pipeline.
// END_CHANGE_SUMMARY

import type { SourceAdapter } from "./types";
import { wrenjapanAdapter } from "./adapters/wrenjapan";
import { insidekyotoAdapter } from "./adapters/insidekyoto";
import { trulytokyoAdapter } from "./adapters/trulytokyo";
import { kansaiOdysseyAdapter } from "./adapters/kansai_odyssey";
import { invisibleTouristAdapter } from "./adapters/invisible_tourist";
import { japanUnravelledAdapter } from "./adapters/japan_unravelled";
import { japanGuideAdapter } from "./adapters/japan_guide";
import { redditJapantravelAdapter } from "./adapters/reddit_japantravel";
import { navitimeAdapter } from "./adapters/navitime";
import { jorudanAdapter } from "./adapters/jorudan";
import { jreastAdapter } from "./adapters/jreast";
import { smartExAdapter } from "./adapters/smart_ex";

// START_BLOCK_DEFINE_ADAPTER_MAP_M_SITES_PARSER_CLEANUP_REGISTRY_001
const ALL_ADAPTERS: SourceAdapter[] = [
  wrenjapanAdapter,
  insidekyotoAdapter,
  trulytokyoAdapter,
  kansaiOdysseyAdapter,
  invisibleTouristAdapter,
  japanUnravelledAdapter,
  japanGuideAdapter,
  redditJapantravelAdapter,
  navitimeAdapter,
  jorudanAdapter,
  jreastAdapter,
  smartExAdapter,
];

const ADAPTER_MAP: ReadonlyMap<string, SourceAdapter> = new Map(
  ALL_ADAPTERS.map((a) => [a.sourceId, a]),
);
// END_BLOCK_DEFINE_ADAPTER_MAP_M_SITES_PARSER_CLEANUP_REGISTRY_001

// START_BLOCK_DEFINE_SUPPORTED_IDS_M_SITES_PARSER_CLEANUP_REGISTRY_002
/** Alphabetically sorted array of all supported source IDs. */
export const SUPPORTED_CLEANUP_SOURCE_IDS: string[] = [
  ...ADAPTER_MAP.keys(),
].sort();
// END_BLOCK_DEFINE_SUPPORTED_IDS_M_SITES_PARSER_CLEANUP_REGISTRY_002

// START_CONTRACT: getCleanupAdapter
//   PURPOSE: Resolve a SourceAdapter by source_id.
//   INPUTS: { sourceId: string - Source identifier }
//   OUTPUTS: { SourceAdapter | null - Matched adapter or null for unknown sources }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER-CLEANUP-REGISTRY]
// END_CONTRACT: getCleanupAdapter
export function getCleanupAdapter(sourceId: string): SourceAdapter | null {
  // START_BLOCK_GET_CLEANUP_ADAPTER_M_SITES_PARSER_CLEANUP_REGISTRY_003
  return ADAPTER_MAP.get(sourceId) ?? null;
  // END_BLOCK_GET_CLEANUP_ADAPTER_M_SITES_PARSER_CLEANUP_REGISTRY_003
}
