# Session Decisions (2026-02-21)

## Confirmed decisions

1. Product boundary for v1 is MCP retrieval + verification infrastructure.
2. External agent owns orchestration, correctness judgment, and final user response.
3. Public tools in v1:
   - `search_context`
   - `validate_google_map_link`
   - `verify_tabelog`
4. Isolation model is updated to:
   - `workspace_id`
   - `region_pack_id`
   - `source_list_version`
5. Region/country is represented as pack scope, not tenant identity.
6. V1 source scope is public-only.
7. Backfill remains admin/internal only.
8. Canonical POI is lazy-built from observed assertions.
9. Unknown POI does not auto-map to mismatch.
10. HITL is required for uncertain/conflicting POI cases.

## Confirmed v1 retrieval policy

1. Hybrid retrieval (lexical + vector + rerank).
2. Cross-language strategy: RU↔EN query expansion + multilingual vector retrieval.
3. Evidence-first output with citations and context.
4. No truth/final correctness scoring in retrieval output.

## Confirmed v1 safety policy

1. Regex-based PII redaction at ingest.
2. Query abuse guardrails for personal identifier lookup patterns.
3. Source policy matrix is required for storage/snippet/attribution controls.

## Deferred from v1

1. Internal trip planner (`plan_day` class features).
2. Internal multi-agent orchestration.
3. Memory/profile subsystem.
4. Full automated eval pipeline as hard release prerequisite.

## v1 quality stance

1. Weekly smoke set (30-50 queries).
2. Evidence coverage threshold >= 95%.
3. Connector replay tests are mandatory.
4. Validator obvious error threshold <= 10% (manual audit sample).
