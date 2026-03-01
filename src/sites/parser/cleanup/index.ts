// FILE: src/sites/parser/cleanup/index.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Orchestrate the layered cleanup pipeline: Layer A (global) → Layer B (source adapter) → Layer C (quality gate).
//   SCOPE: Wire cleanup layers, resolve source adapter via registry, return CleanupResult.
//   DEPENDS: M-SITES-PARSER-CLEANUP-GLOBAL, M-SITES-PARSER-CLEANUP-REGISTRY, M-SITES-PARSER-CLEANUP-QUALITY-GATE, M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-SITES-PARSER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   runCleanupPipeline - Execute Layer A → B → C and return CleanupResult.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.1.0 - Replace hardcoded adapter map with central registry (M-CLEANUP-REGISTRY).
// END_CHANGE_SUMMARY

import type { CleanupResult } from "./types";
import { globalCleanup } from "./global";
import { getCleanupAdapter } from "./registry";
import { qualityGate } from "./quality-gate";

// START_CONTRACT: runCleanupPipeline
//   PURPOSE: Execute the full cleanup pipeline: Layer A (global) → Layer B (source adapter) → Layer C (quality gate).
//   INPUTS: { text: string - Raw content text, sourceId: string - Source identifier for adapter selection }
//   OUTPUTS: { CleanupResult - Accepted cleaned text with metrics, or rejection with reason and metrics }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER]
// END_CONTRACT: runCleanupPipeline
export function runCleanupPipeline(text: string, sourceId: string): CleanupResult {
  // START_BLOCK_RUN_CLEANUP_PIPELINE_M_SITES_PARSER_CLEANUP_ORCH_003

  // Layer A: Global cleanup
  let cleaned = globalCleanup(text);

  // Layer B: Source-specific adapter (passthrough if no adapter registered)
  const adapter = getCleanupAdapter(sourceId);
  if (adapter) {
    cleaned = adapter.clean(cleaned);
  }

  // Layer C: Quality gate
  return qualityGate(cleaned);

  // END_BLOCK_RUN_CLEANUP_PIPELINE_M_SITES_PARSER_CLEANUP_ORCH_003
}
