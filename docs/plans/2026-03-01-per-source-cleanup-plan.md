# Per-Source Cleanup and Content Quality Plan

Date: 2026-03-01
Project: `japan-travel-rag-mcp`
Status: Draft implementation plan

## 1. Goal

Improve curated-sites indexing quality by removing domain-specific crawl noise before chunking/embedding, starting with `wrenjapan.com`.

Target user-facing effect:
1. `search_sites` returns cleaner, article-focused snippets.
2. `get_page_chunk` returns evidence without navigation/share/newsletter boilerplate.
3. Index quality improves without changing MCP tool contracts.

## 2. Problem Summary

Current parser cleanup is mostly generic and cannot reliably remove source-specific boilerplate:
1. Navigation/header/footer blocks leak into indexed text.
2. Placeholder image payloads (for example `data:image/gif;base64,...`) leak into chunks.
3. Social share/prev-next blocks are stored as content.
4. Link-heavy preamble often appears before real article body.

As a result, chunking quality degrades and retrieval ranks noise.

## 3. Scope

In scope:
1. Add layered cleanup pipeline: global rules + per-source rules + quality gate.
2. Introduce first source profile for `wrenjapan`.
3. Add parser tests with noisy real-world fixture patterns.
4. Add ingestion observability for cleanup effect.

Out of scope (this phase):
1. LLM-based cleanup/summarization.
2. Redesign of chunking algorithm.
3. Public admin UI for editing cleanup rules.
4. Full historical reindex automation.

## 4. Locked Decisions (v1)

1. Cleanup is deterministic and rule-based.
2. Cleanup happens in parser stage before chunking and embedding.
3. Existing MCP tool inputs/outputs remain unchanged.
4. Existing source registry remains source-of-truth for active sources.
5. First rollout is `wrenjapan` profile + generic hardening for all sources.
6. Cleanup code is extracted into dedicated parser cleanup modules (not kept inline in one function).
7. `parseCrawlItem` returns a discriminated union for accepted vs skipped pages.
8. Quality skips are non-fatal ingestion outcomes (tracked separately from errors).
9. Source adapter selection in v1 is by `source_id` only.
10. Initial quality gate thresholds are intentionally soft to avoid over-skipping.
11. Rollout reindex strategy for this phase is `purge + recrawl` for `wrenjapan`.

## 5. Target Design

### 5.1 Layered cleanup pipeline

1. Layer A (`global`): normalize universal noise for all sources.
2. Layer B (`source adapter`): apply source-specific cleanup profile by `source_id` and/or domain.
3. Layer C (`quality gate`): compute post-cleanup quality metrics and skip/flag low-value pages.

Pipeline order:
1. Select raw content field (`content/markdown/text/html` fallback remains as-is).
2. Apply global cleanup transforms.
3. Apply optional source adapter transforms.
4. Run quality gate and decide `index` vs `skip`.
5. Continue to chunking only for accepted pages.

### 5.1.1 Parser cleanup code layout

1. `src/sites/parser/cleanup/index.ts` — orchestration of Layer A/B/C.
2. `src/sites/parser/cleanup/global.ts` — generic cleanup transforms.
3. `src/sites/parser/cleanup/adapters/wrenjapan.ts` — `wrenjapan` source profile rules.
4. `src/sites/parser/cleanup/quality-gate.ts` — metrics computation + accept/skip decision.
5. `src/sites/parser/cleanup/types.ts` — cleanup contracts and decision/result types.
6. `src/sites/parser/index.ts` remains thin: parse input, call cleanup pipeline, return parser union result.

### 5.2 Global cleanup baseline (Layer A)

Mandatory rules:
1. Remove inline data-URI image artifacts (`data:image/...`).
2. Remove empty emphasis/format fragments (for example isolated `**` lines).
3. Remove pure social-share link rows.
4. Collapse repetitive whitespace/newlines.
5. Keep existing generic boilerplate line filters.

### 5.3 Wren source adapter (Layer B: `wrenjapan`)

Initial profile behaviors:
1. Strip top navigation/menu blocks before article body.
2. Strip newsletter/signup promo text blocks.
3. Strip repeated image placeholder rows.
4. Strip footer navigation (`earlier/later`, share widgets).
5. Keep article headings and inline links that are semantically relevant.

Selection rule:
1. Adapter enabled only when `source_id === "wrenjapan"` (v1).

### 5.4 Quality gate (Layer C)

Post-cleanup metrics:
1. `clean_char_count`
2. `link_density` (ratio of link-only/URL-heavy lines)
3. `boilerplate_line_ratio`
4. `heading_count`

Default gating policy (v1 draft):
1. `MIN_CLEAN_CHARS = 80`
2. `MAX_LINK_DENSITY = 0.85`
3. `MAX_BOILERPLATE_RATIO = 0.75`
4. `MIN_BODY_SIGNALS = 1`
5. Skip if thresholds indicate likely non-article/noise-heavy page.
6. Log skip reason code for observability.

### 5.5 Parser output contract (accepted vs skipped)

1. `parseCrawlItem` returns:
   - `{ status: "accepted", page: ParsedPage }`
   - `{ status: "skipped", reason: SkipReason, source_id: string, url: string, metrics?: CleanupMetrics }`
2. `ParsedPage` represents accepted content only.
3. Skip reasons are deterministic string enums (for logs/counters/tests).

## 6. Integration Points

Primary modules affected:
1. `M-SITES-PARSER` (`src/sites/parser/index.ts`) — add layered cleanup + quality gate.
2. `M-SITES-INGESTION` (`src/sites/ingestion/orchestrator.ts`) — handle parser quality-skip as non-fatal skip path with dedicated counters.
3. `M-SITES-PARSER-TEST` (`src/sites/parser/index.test.ts`) — add deterministic fixture coverage for noisy source content.

Optional future extension:
1. Source-level cleanup settings in `site_sources` table (for profile/config storage).

Ingestion result/logging updates:
1. Add `pages_skipped` counter to `IngestionResult`.
2. Parser skip decisions do not populate `result.errors[]`.
3. Log parser skips as `info`/`warn` with reason and source metadata.

## 7. Implementation Phases

### Phase 0: Contract and rule design

Deliverables:
1. Update parser module contract to include layered cleanup and quality gate semantics.
2. Define source adapter interface and rule registry structure.
3. Define deterministic skip reason codes.
4. Define parser discriminated-union output contract and orchestrator handling contract.

Exit criteria:
1. Contract clearly describes inputs/outputs and skip behavior.
2. No ambiguity on parser ownership vs chunker ownership.

### Phase 1: Global hardening

Deliverables:
1. Implement global cleanup rules for `data:image`, empty formatting rows, share-link garbage.
2. Add regression tests for noisy markdown snippets.

Exit criteria:
1. Existing parser tests pass.
2. New global cleanup tests pass.

### Phase 2: Wren source adapter

Deliverables:
1. Implement `wrenjapan` adapter with deterministic pattern rules.
2. Add fixture tests from representative Wren pages.

Exit criteria:
1. Wren fixture output removes nav/share/footer noise while preserving article body.
2. No regressions for non-Wren fixtures.

### Phase 3: Quality gate + ingestion behavior

Deliverables:
1. Add quality metrics computation in parser.
2. Add parser decision: `accept` or `skip` with reason code.
3. Add `pages_skipped` to ingestion result.
4. Update ingestion logging/counters for skipped pages.
5. Keep `errors[]` only for true failures.

Exit criteria:
1. Low-quality pages are skipped without failing source ingestion run.
2. Skip reasons appear in structured logs.

### Phase 4: Validation and rollout

Deliverables:
1. Dry-run crawl sample for `wrenjapan` and compare before/after cleanup stats.
2. Execute `purge + recrawl` for `wrenjapan` to refresh index with new cleanup output.

Exit criteria:
1. Observable reduction of boilerplate in indexed chunks.
2. Manual `search_sites` smoke queries show better snippet relevance.

## 8. Observability and QA

Minimum logging and counters:
1. `cleanup_profile_applied` (source_id/domain/profile_name).
2. `cleanup_chars_removed` and `cleanup_lines_removed`.
3. `quality_gate_decision` (`accepted`/`skipped`) + reason code.
4. Per-source skip rate over time.

Testing strategy:
1. Unit tests for global cleanup rules.
2. Unit tests for `wrenjapan` profile rules.
3. Parser integration tests for quality gate decisions.
4. Ingestion test assertions for skip handling.

## 9. Risks and Mitigations

1. Risk: over-cleaning removes useful content.
   Mitigation: start conservative, add fixture-based regression tests, monitor skip rates.
2. Risk: source layout changes break profile rules.
   Mitigation: keep rules composable, add fallbacks, maintain profile versioning.
3. Risk: false positive quality skips.
   Mitigation: reason-coded logs + threshold tuning with sampled pages.

## 10. Follow-up (Post-v1)

1. Add profile/config storage in DB and admin editor workflow.
2. Add profile support for other noisy sources (community domains first).
3. Add offline quality benchmark set for parser cleanup outputs.
