// FILE: src/sites/parser/cleanup/index.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Orchestrate the layered cleanup pipeline: Layer A (global) → Layer B (source adapter) → Layer C (quality gate).
//   SCOPE: Wire cleanup layers, select source adapter by source_id, return CleanupResult.
//   DEPENDS: M-SITES-PARSER-CLEANUP-GLOBAL, M-SITES-PARSER-CLEANUP-ADAPTERS-WRENJAPAN, M-SITES-PARSER-CLEANUP-QUALITY-GATE, M-SITES-PARSER-CLEANUP-TYPES
//   LINKS: M-SITES-PARSER
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   ADAPTERS - Registry of source-specific cleanup adapters keyed by source_id.
//   getSourceAdapter - Look up a source adapter by source_id.
//   runCleanupPipeline - Execute Layer A → B → C and return CleanupResult.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: v1.0.0 - Initial cleanup pipeline orchestrator for Phase-11.
// END_CHANGE_SUMMARY

import type { CleanupResult, SourceAdapter } from "./types";
import { globalCleanup } from "./global";
import { wrenjapanAdapter } from "./adapters/wrenjapan";
import { qualityGate } from "./quality-gate";

// START_BLOCK_DEFINE_ADAPTER_REGISTRY_M_SITES_PARSER_CLEANUP_ORCH_001
const ADAPTERS: ReadonlyMap<string, SourceAdapter> = new Map([
  [wrenjapanAdapter.sourceId, wrenjapanAdapter],
]);
// END_BLOCK_DEFINE_ADAPTER_REGISTRY_M_SITES_PARSER_CLEANUP_ORCH_001

// START_CONTRACT: getSourceAdapter
//   PURPOSE: Look up a source-specific cleanup adapter by source_id.
//   INPUTS: { sourceId: string - Source identifier }
//   OUTPUTS: { SourceAdapter | undefined - Matched adapter or undefined for passthrough }
//   SIDE_EFFECTS: [none]
//   LINKS: [M-SITES-PARSER]
// END_CONTRACT: getSourceAdapter
function getSourceAdapter(sourceId: string): SourceAdapter | undefined {
  // START_BLOCK_GET_SOURCE_ADAPTER_M_SITES_PARSER_CLEANUP_ORCH_002
  return ADAPTERS.get(sourceId);
  // END_BLOCK_GET_SOURCE_ADAPTER_M_SITES_PARSER_CLEANUP_ORCH_002
}

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
  const adapter = getSourceAdapter(sourceId);
  if (adapter) {
    cleaned = adapter.clean(cleaned);
  }

  // Layer C: Quality gate
  return qualityGate(cleaned);

  // END_BLOCK_RUN_CLEANUP_PIPELINE_M_SITES_PARSER_CLEANUP_ORCH_003
}
