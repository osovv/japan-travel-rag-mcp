// FILE: src/sites/parser/cleanup/types.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Define cleanup pipeline types: SkipReason, CleanupMetrics, SourceAdapter, ParserResult, and quality gate constants.
//   SCOPE: Shared type definitions for the layered cleanup pipeline (global → source adapter → quality gate).
//   DEPENDS: none
//   LINKS: M-SITES-PARSER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SkipReason - String enum for page skip reasons.
//   CleanupMetrics - Post-cleanup quality metrics.
//   SourceAdapter - Interface for per-source cleanup adapters.
//   CleanupResult - Result from cleanup pipeline: accepted text or skip decision.
//   ParserResult - Discriminated union: accepted ParsedPage or structured skip.
//   MIN_CLEAN_CHARS - Quality gate threshold constant.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial cleanup types for Phase-11 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

import type { ParsedPage } from "../index";

// START_BLOCK_DEFINE_SKIP_REASON_M_SITES_PARSER_CLEANUP_001
export type SkipReason =
  | "EMPTY_CONTENT"
  | "EMPTY_AFTER_CLEANUP"
  | "TOO_SHORT_AFTER_CLEANUP";
// END_BLOCK_DEFINE_SKIP_REASON_M_SITES_PARSER_CLEANUP_001

// START_BLOCK_DEFINE_CLEANUP_METRICS_M_SITES_PARSER_CLEANUP_002
export type CleanupMetrics = {
  clean_char_count: number;
};
// END_BLOCK_DEFINE_CLEANUP_METRICS_M_SITES_PARSER_CLEANUP_002

// START_BLOCK_DEFINE_SOURCE_ADAPTER_M_SITES_PARSER_CLEANUP_003
export type SourceAdapter = {
  sourceId: string;
  clean(text: string): string;
};
// END_BLOCK_DEFINE_SOURCE_ADAPTER_M_SITES_PARSER_CLEANUP_003

// START_BLOCK_DEFINE_CLEANUP_RESULT_M_SITES_PARSER_CLEANUP_004
export type CleanupResult =
  | { accepted: true; text: string; metrics: CleanupMetrics }
  | { accepted: false; reason: SkipReason; metrics: CleanupMetrics };
// END_BLOCK_DEFINE_CLEANUP_RESULT_M_SITES_PARSER_CLEANUP_004

// START_BLOCK_DEFINE_PARSER_RESULT_M_SITES_PARSER_CLEANUP_005
export type ParserResult =
  | { status: "accepted"; page: ParsedPage }
  | {
      status: "skipped";
      reason: SkipReason;
      source_id: string;
      url: string;
      metrics?: CleanupMetrics;
    };
// END_BLOCK_DEFINE_PARSER_RESULT_M_SITES_PARSER_CLEANUP_005

// START_BLOCK_DEFINE_QUALITY_GATE_CONSTANTS_M_SITES_PARSER_CLEANUP_006
export const MIN_CLEAN_CHARS = 80;
// END_BLOCK_DEFINE_QUALITY_GATE_CONSTANTS_M_SITES_PARSER_CLEANUP_006
