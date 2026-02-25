# Product Scope v1

Date: 2026-02-21
Project: `japan-travel-rag-mcp`

## 1. Product thesis

Build a best-in-class MCP retrieval + verification infrastructure for travel agents.

The product does not run autonomous trip planning.
It returns deterministic evidence and verification primitives.

## 2. System boundary

Inside this MCP:
1. Curated source ingestion and indexing.
2. Evidence-first retrieval over indexed sources.
3. Deterministic POI/link verification.

Outside this MCP (external agent responsibility):
1. Orchestration and tool sequencing.
2. User intent interpretation and constraints tradeoffs.
3. Final answer synthesis and correctness judgment.
4. Optional external web search beyond curated sources.

## 3. Scope in v1

1. Public MCP tool `search_context`.
2. Public MCP tool `validate_google_map_link`.
3. Public MCP tool `verify_tabelog`.
4. Curated public source ingestion: Telegram + Reddit first.
5. Backfill and incremental sync per source.
6. Data isolation via `workspace_id + region_pack_id + source_list_version`.
7. Lazy canonical POI model with provisional records.
8. HITL review queue for uncertain POI cases.

## 4. Out of scope in v1

1. Internal trip planning (`plan_day` and similar).
2. Internal multi-agent orchestration.
3. Long-term user memory/profile features.
4. Full automated eval pipeline as release prerequisite.
5. Truth scoring engine for claim correctness.

## 5. Source and safety guardrails

1. V1 sources: public-only.
2. Enforce source policy matrix (storage, snippet, attribution, retention rules).
3. Apply regex-based PII redaction at ingest.
4. Block personal-identifier lookup queries (phone/email/person lookup).

## 6. Retrieval principles

1. Hybrid search: lexical + vector + rerank.
2. Cross-language support with RU↔EN query expansion and multilingual vector retrieval.
3. Return evidence objects only, not planner narrative.
4. Expose retrieval match signals; do not expose truth/final correctness score.

## 7. Verification principles

1. Deterministic verdicts: `match|partial|mismatch|inconclusive`.
2. Unknown POI does not auto-fail as mismatch.
3. Use provisional POI and enrichment path for unresolved cases.
4. Include confidence and reason codes in every verification response.

## 8. v1 quality guardrails

1. Weekly smoke set of 30-50 queries.
2. Evidence/citation coverage >= 95%.
3. Connector contract tests and replay fixtures required.
4. Validator obvious error <= 10% on weekly manual audit sample.
