// FILE: src/sites/parser/cleanup/quality-gate.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Evaluate post-cleanup text quality and decide whether to accept or skip the page.
//   SCOPE: Layer C of the cleanup pipeline — quality gate applied after global and source-adapter cleanup.
//   DEPENDS: M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-SITES-PARSER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   qualityGate - Evaluate cleaned text against quality thresholds and return accept/skip decision.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial quality gate for Phase-11 per-source cleanup pipeline.
// END_CHANGE_SUMMARY

import type { CleanupResult } from "./types";
import { MIN_CLEAN_CHARS } from "./types";

// START_CONTRACT: qualityGate
//   PURPOSE: Evaluate cleaned text length against minimum thresholds and return a typed accept/skip result.
//   INPUTS: { text: string - Post-cleanup text to evaluate }
//   OUTPUTS: { CleanupResult - Accepted text with metrics, or rejection with reason and metrics }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER]
// END_CONTRACT: qualityGate

// START_BLOCK_QUALITY_GATE_M_SITES_PARSER_CLEANUP_010
export function qualityGate(text: string): CleanupResult {
  const clean_char_count = text.trim().length;

  if (clean_char_count === 0) {
    return {
      accepted: false,
      reason: "EMPTY_AFTER_CLEANUP",
      metrics: { clean_char_count: 0 },
    };
  }

  if (clean_char_count < MIN_CLEAN_CHARS) {
    return {
      accepted: false,
      reason: "TOO_SHORT_AFTER_CLEANUP",
      metrics: { clean_char_count },
    };
  }

  return {
    accepted: true,
    text: text.trim(),
    metrics: { clean_char_count },
  };
}
// END_BLOCK_QUALITY_GATE_M_SITES_PARSER_CLEANUP_010
