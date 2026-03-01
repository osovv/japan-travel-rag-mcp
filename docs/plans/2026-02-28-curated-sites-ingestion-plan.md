# Curated Sites Ingestion and Search Implementation Plan

Date: 2026-02-28
Project: `japan-travel-rag-mcp`
Status: Draft implementation plan

## 1. Goal

Build production-ready curated site search for Japan travel with this user-facing behavior:
1. `get_site_sources` returns registry metadata.
2. `search_sites(query)` returns relevant snippets with original links.
3. `get_page_chunk(chunk_id)` returns a bounded evidence excerpt for a selected hit.
4. `spider.cloud` API is used only for crawling/fetching raw page data for ingestion.

## 1.1 Locked decisions (v1)

1. Embedding model for curated sites is fixed to `voyage-4`.
2. `voyage-4` is used for both document indexing and query embeddings in v1.
3. Chunking strategy for v1 is a simple deterministic pipeline (structural split + token cap split).
4. V1 chunking params are fixed: `target_tokens=450`, `max_tokens=650`, `overlap_tokens=80`.
5. Token counting for chunking is fixed to npm `tiktoken` (no chars-based approximation in v1).
6. LLM-based chunking/enrichment is out of scope for v1.
7. Formal recall/eval pipeline is out of scope for v1; quality is validated by manual smoke-check queries.
8. Pipeline must remain versioned to support future full reindex with a different strategy.
9. `site_sources` table is the single source of truth for both ingestion and `get_site_sources` tool output.
10. `SITE_SOURCES_RESPONSE` constant is bootstrap-only seed data (initialization/tests), not runtime source of truth.
11. `spider.cloud` endpoint policy for v1:
   - scheduled ingestion uses `crawl` only,
   - targeted single-URL recrawl also uses `crawl` (seed URL + strict limit),
   - no public/manual refresh tool in v1.
12. Voyage and Spider requests are proxied through a unified proxy base URL with shared proxy secret.
13. `M-CONFIG` must include required env vars for embeddings and crawl proxying:
   - `VOYAGE_API_KEY`
   - `SPIDER_API_KEY`
   - `PROXY_BASE_URL`
   - `PROXY_SECRET`
14. New curated-sites tools (`get_site_sources`, `search_sites`, `get_page_chunk`) are local MCP tools and must not be added to proxied upstream allowlist (`PROXIED_TOOL_NAMES`).
15. `unified_search` tool is intentionally out of scope; product keeps two explicit tools: `search_messages` and `search_sites`.
16. Runtime split uses separate process entrypoints (HTTP/API and Worker), not role-switching via single `APP_ROLE` toggle.

## 1.2 Future Reindex Strategy (accepted now)

1. Full reindex is an expected operation, not an exceptional one.
2. New retrieval/chunking/embedding approaches are introduced via version bump (no in-place mutation assumptions).
3. Old index version can run in parallel during cutover, then be decommissioned.
4. Search reads only active `index_version` to avoid mixed ranking between old/new index generations.

## 2. Current Baseline

Already implemented:
1. `get_site_sources` tool seed and contract in `src/tools/site-sources.ts`.
2. Existing MCP tool architecture, validation flow, and proxy patterns in `src/tools/*`.
3. PostgreSQL-backed stack and existing RAG components for Telegram side.

Not implemented yet:
1. Curated site ingestion pipeline with external crawl provider integration.
2. Site-specific chunk and embedding index.
3. `search_sites` and `get_page_chunk` MCP tools.
4. DB-backed `get_site_sources` read path.
5. Voyage proxy client + config path in this repository.

## 3. Scope

In scope:
1. Curated-domain ingestion only (whitelist-driven).
2. Hybrid retrieval for websites (vector + full-text ranking).
3. MCP tools for search and chunk evidence retrieval.
4. `spider.cloud` API integration for crawl/fetch only, routed through Spider proxy.
5. Operational guardrails: rate limiting, robots respect, bounded output.

Out of scope for this phase:
1. Open-web crawling beyond curated whitelist.
2. Public full-page raw HTML/text API.
3. Multi-tenant billing and per-customer source upload.
4. Building our own low-level crawler engine from scratch.
5. Unified cross-domain search tool that merges Telegram + curated sites into one endpoint.

## 4. Target Architecture

### 4.1 Data flow

1. Scheduler picks active source domains.
2. Ingestion worker runs scheduled Spider-proxied `crawl` jobs with per-source `depth/limit` caps.
3. Internal targeted recrawl jobs reuse Spider-proxied `crawl` with a seed URL and strict page cap.
4. Parser extracts canonical URL, title, clean text from fetched payloads.
5. Chunker splits content into stable chunks.
6. Embedding worker writes vectors to local index tables.
7. Search service executes hybrid query and returns ranked chunk hits from local DB.

### 4.7 Runtime Topology (separate entrypoints)

1. HTTP/API runtime is a dedicated entrypoint process (serves UI + MCP local/proxied tools).
2. Worker runtime is a dedicated entrypoint process (crawl, parse, chunk, embed, index jobs).
3. Deployment model follows wren-chat-style split processes:
   - default container command runs API entrypoint,
   - worker service overrides command to worker entrypoint.
4. No single binary `APP_ROLE` switch is required for v1 architecture.

### 4.2 Storage model (proposed tables)

1. `site_sources`
   - `source_id`, `name`, `domain`, `tier`, `language`, `status`, `crawl_interval_minutes`, `max_pages`.
2. `site_pages`
   - `page_id`, `source_id`, `url`, `canonical_url`, `title`, `text_hash`, `http_status`, `fetched_at`, `last_modified`, `etag`.
3. `site_chunks`
   - `chunk_id`, `page_id`, `chunk_index`, `chunk_text`, `char_count`, `token_estimate`, `content_hash`, `chunking_version`, `index_version`, `start_offset`, `end_offset`.
4. `site_chunk_embeddings`
   - `chunk_id` (FK -> `site_chunks.chunk_id` with cascade delete), `embedding vector(1024)`, `embedding_model`, `embedding_version`, `index_version`, `embedded_at`.
5. `site_crawl_jobs` (required)
   - `crawl_job_id`, `source_id`, `provider`, `provider_job_id`, `status`, `started_at`, `finished_at`, `pages_fetched`, `error`.
6. PostgreSQL extension prerequisite:
   - `CREATE EXTENSION IF NOT EXISTS vector;` (pgvector)

### 4.3 Retrieval model

1. Vector retrieval over `site_chunk_embeddings`.
2. FTS retrieval over `site_chunks.chunk_text` using PostgreSQL `simple` text search config in v1 (single config for all sources).
3. Weighted merge + rerank.
4. Retrieval always filters by active `index_version`.
5. Output always includes `original_page_url` and `source_id`.
6. Retrieval does not query `spider.cloud` directly at runtime for user requests.
7. Embeddings in this phase are generated with `voyage-4`.

### 4.4 Chunking v1 Spec (simple and deterministic)

1. Primary split: by document structure (headers/paragraph/list blocks).
2. Secondary split: token-based split only when a block exceeds `max_tokens`.
3. Parameters:
   - `target_tokens=450`
   - `max_tokens=650`
   - `overlap_tokens=80` (only for forced split)
4. Tiny fragments (<120 tokens) are merged with adjacent block when possible.
5. Token counting/limits are computed with npm `tiktoken` for deterministic chunk boundaries aligned with embedding budget control.
6. Output excerpt for `get_page_chunk` remains bounded; no full-page dump.

### 4.5 Voyage Proxy Embedding Flow (wren-chat aligned)

1. All Voyage embedding requests go to `${PROXY_BASE_URL}/api.voyageai.com/v1/embeddings` (no direct public Voyage endpoint in app code).
2. Required headers:
   - `Authorization: Bearer ${VOYAGE_API_KEY}`
   - `X-Proxy-Key: ${PROXY_SECRET}`
   - `Content-Type: application/json`
3. Request payload:
   - `model: "voyage-4"` (v1 locked)
   - `input_type: "document"` for indexing batches
   - `input_type: "query"` for online query embeddings
4. Query embeddings are single-request path; ingestion uses batch path.
5. V1 should add explicit request timeout in client config (unlike current wren-chat behavior where timeout is implicit).

### 4.6 Spider Proxy Crawl Flow

1. All Spider requests go through `${PROXY_BASE_URL}/api.spider.cloud/*` (no direct `spider.cloud` calls in app runtime path).
2. Required headers for Spider calls via unified proxy:
   - `Authorization: Bearer ${SPIDER_API_KEY}`
   - `X-Proxy-Key: ${PROXY_SECRET}`
   - `Content-Type: application/json`
3. Scheduled ingestion uses proxied `crawl` endpoint with per-source `depth`/`limit` caps.
4. Internal targeted recrawl uses the same proxied `crawl` endpoint with seed URL + strict `limit=1` style cap.
5. V1 should include explicit request timeout and retry/backoff policy in Spider client.

## 5. Tool Contracts

All tools in this section are local MCP tools (server-owned execution), not proxied upstream tools.

### 5.1 `search_sites`

Input:
1. `query: string` (required)
2. `top_k: number` (default 10, max 30)
3. `source_ids: string[]` (optional allow-subset)

Output item:
1. `result_id`
2. `source_id`
3. `tier`
4. `domain`
5. `original_page_url`
6. `title`
7. `snippet`
8. `chunk_id`
9. `score`

### 5.2 `get_page_chunk`

Input:
1. `chunk_id: string` (required)
2. `include_neighbors: boolean` (default false)

Output:
1. `chunk_id`
2. `source_id`
3. `original_page_url`
4. `title`
5. `chunk_excerpt` (bounded)
6. `neighbor_excerpt_before` (optional)
7. `neighbor_excerpt_after` (optional)

## 6. Operational Guardrails

1. Source allowlist only from `get_site_sources` registry.
2. Spider-proxied calls must keep robots-respect mode enabled.
3. Bounded excerpt output from `get_page_chunk`.
4. No public full-page raw content tool in this phase.
5. Domain-level pause switch (`status=paused`) without redeploy.
6. Takedown hook by URL/source/chunk.
7. Crawl budget controls per source (`max_pages`, interval, depth/limit caps).
8. Scheduled ingestion must use `crawl` only in v1.
9. No direct outbound calls to `spider.cloud` from app modules; only proxy URL is allowed.
10. V1 scheduling cadence is fixed:
   - scheduler tick every 5 minutes,
   - Tier 0 (`wrenjapan.com`) re-crawl interval: 720 minutes (12h),
   - Tier 1 guide domains re-crawl interval: 4320 minutes (72h),
   - Tier 2 community/tool domains re-crawl interval: 1440 minutes (24h),
   - discovery pass for new URLs: every 7 days,
   - full reindex: event-driven (pipeline/version changes) with optional 30-day safety run.
11. No public/manual per-URL refresh path in v1; internal targeted recrawl is worker-only and must reuse `crawl`.

## 7. Implementation Phases

### Phase 0A: Contracts, config, and schema prep

Deliverables:
1. Add local tool schemas/handlers for `search_sites` and `get_page_chunk` in local tool registration path (separate from proxied upstream tool allowlist).
2. Extend `M-CONFIG` with required embedding/proxy env vars:
   - `VOYAGE_API_KEY`
   - `SPIDER_API_KEY`
   - `PROXY_BASE_URL`
   - `PROXY_SECRET`
3. Add database migration files for site tables.
4. Add seed migration/initializer to populate `site_sources` from `SITE_SOURCES_RESPONSE`.
5. Switch `get_site_sources` local tool to read from `site_sources` table.
6. Add config tests for new env validation and required-field failures.

Exit criteria:
1. Contracts compile and tests for validation pass.
2. Migrations apply cleanly in local dev.
3. `get_site_sources` response reflects DB updates without redeploy.
4. App boot fails fast with deterministic config error when any required Voyage/Spider proxy env is missing.

### Phase 0B: Runtime split wiring

Deliverables:
1. Define separate runtime entrypoint files and startup wiring (API entrypoint + worker entrypoint).
2. Ensure scheduling/ingestion code paths are worker-only.

Exit criteria:
1. API runtime starts without worker loops.
2. Worker runtime starts crawl/index jobs without exposing API routes.

### Phase 1: Ingestion pipeline MVP

Deliverables:
1. `src/integrations/spider-cloud-client.ts` for typed API client and retries.
2. `src/sites/ingestion/*` orchestrator that pulls active sources and triggers provider `crawl` jobs.
3. Internal targeted recrawl path that reuses provider `crawl` (seed URL + strict page cap), worker-only.
4. `src/sites/parser/*` for canonical URL and text extraction.
5. `src/sites/chunking/*` for deterministic chunking.
6. Upsert flow into `site_pages` and `site_chunks`.
7. `src/integrations/voyage-proxy-client.ts` for query/document embedding calls via proxy headers.

Exit criteria:
1. At least 3 domains ingest successfully end-to-end.
2. Re-crawl updates existing rows by hash, no duplicate chunk explosion.
3. Provider failures are mapped to deterministic local ingestion errors.
4. Embedding requests are observable and route only through configured proxy URL.
5. Spider crawl requests are observable and route only through configured unified proxy base URL.
6. Targeted single-URL recrawl succeeds through the same crawl path without introducing a separate scrape/manual API.

### Phase 2: Embeddings and hybrid search

Deliverables:
1. Embedding job for new/changed chunks.
2. SQL search path for vector + FTS merge.
3. Deterministic ranking fields in response.

Exit criteria:
1. Search returns relevant hits on seeded queries.
2. P95 query latency target met (initial target: < 800ms local).

### Phase 3: MCP tools

Deliverables:
1. Register `search_sites` tool in server runtime.
2. Register `get_page_chunk` tool with excerpt caps.
3. Add tests for happy path, empty results, invalid chunk_id.

Exit criteria:
1. MCP calls return schema-valid responses.
2. Output always has URL attribution and source_id.

### Phase 4: Ops hardening

Deliverables:
1. Provider request budget limiter and retry/backoff policy.
2. Metrics for crawl health, index freshness, search latency.
3. Pause/resume source controls.
4. Takedown CLI/admin command for delete-by-url/source.
5. Provider health fallback behavior (skip source on outage, continue others).
6. Add jitter policy to fixed cadence to avoid synchronized recrawls.

Exit criteria:
1. Recovery from transient fetch failures proven.
2. Source pause works without code changes.

## 8. Testing Plan

1. Unit tests:
   - contracts for new tools,
   - parser/chunker deterministic behavior,
   - ranking merge logic.
2. Integration tests:
   - crawl -> chunk -> embed -> search full flow on fixture pages.
3. Smoke tests:
   - run 15-20 real queries from travel scenarios,
   - verify attribution and snippet quality manually.
4. No formal offline retrieval benchmark pipeline in v1.

## 9. Acceptance Criteria (Product)

1. Agent can discover trusted domains via `get_site_sources`.
2. Agent can answer practical travel questions with `search_sites` results and source links.
3. `get_page_chunk` helps grounding without exposing full-page dumps.
4. Content freshness visible through `fetched_at` metadata.

## 10. Risks and Mitigations

1. Parser quality varies across domains.
   - Mitigation: per-domain parser adapters and fallback extractors.
2. Provider instability or API quota exhaustion.
   - Mitigation: backoff, job retries, per-source budget caps, and stale-index fallback.
3. Retrieval noise for broad queries.
   - Mitigation: source/tier weighting and rerank tuning.
4. Index bloat.
   - Mitigation: hash-based dedup and re-crawl diffing.
5. Vendor cost drift.
   - Mitigation: crawl schedule caps, per-source page limits, and cost telemetry per crawl job.

## 11. Suggested File Touchpoints

1. `src/config/index.ts`
2. `src/config/index.test.ts`
3. `src/tools/contracts.ts`
4. `src/tools/contracts.test.ts`
5. `src/server/*` (tool registration path)
6. `src/integrations/spider-cloud-client.ts` (new)
7. `src/integrations/voyage-proxy-client.ts` (new)
8. `src/integrations/spider-proxy-client.ts` (new, if split from spider-cloud-client responsibilities)
9. `src/sites/ingestion/*` (new)
10. `src/sites/parser/*` (new)
11. `src/sites/chunking/*` (new)
12. `src/sites/search/*` (new)
13. `src/db/migrations/*`
14. `docs/product/get-site-sources-tool-guide-2026-02-28.md`
15. `src/api-main.ts` (new, dedicated HTTP/API entrypoint)
16. `src/worker-main.ts` (new, dedicated worker entrypoint)

## 12. First Sprint Cut (1 week)

1. Day 1: DB schema + contracts.
2. Day 2: spider client + ingestion orchestrator MVP.
3. Day 3: chunking + upsert.
4. Day 4: embedding + hybrid search.
5. Day 5: expose `search_sites` and basic tests.
6. Day 6: expose `get_page_chunk` with caps.
7. Day 7: smoke run, fix top regressions, ship beta.
