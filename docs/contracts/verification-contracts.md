# MCP Tool Contracts v1 (Retrieval + Verification)

Date: 2026-02-21
Project: `japan-travel-rag-mcp`

## 1. Contract goals

1. Deterministic machine-readable responses.
2. Stable schemas for external agent orchestration.
3. Explicit provenance, confidence, and reason codes.
4. No truth/correctness scoring in retrieval output.

## 2. Common routing fields

All public tool requests include:
1. `workspace_id`
2. `region_pack_id`
3. `source_list_version`

## 3. `search_context`

### Request

```json
{
  "workspace_id": "ws_demo",
  "region_pack_id": "jp",
  "source_list_version": "2026-02-21",
  "query": "токио синдзюку сегодня",
  "time_window": {
    "from": "2026-02-20T00:00:00Z",
    "to": "2026-02-21T23:59:59Z"
  },
  "source_filters": ["telegram", "reddit", "tabelog", "web"],
  "lang_pref": ["ru", "en", "ja"],
  "require_outbound_links": false,
  "top_k": 20
}
```

### Response

```json
{
  "workspace_id": "ws_demo",
  "region_pack_id": "jp",
  "source_list_version": "2026-02-21",
  "query_id": "uuid",
  "evidence": [
    {
      "evidence_id": "uuid",
      "source_type": "telegram",
      "source_id": "channel:example",
      "source_item_id": "msg:12345",
      "url": "https://...",
      "published_at": "2026-02-21T10:31:00Z",
      "ingested_at": "2026-02-21T10:35:00Z",
      "lang": "ru",
      "snippet": "...",
      "context": {
        "before": "...",
        "after": "..."
      },
      "outbound_links": ["https://tabelog.com/..."],
      "match_signals": {
        "lexical_match": 0.74,
        "vector_match": 0.88,
        "rerank_position": 3
      },
      "dedup_group": "hash-group"
    }
  ]
}
```

### Rules

1. Evidence only; no planner narrative in this tool.
2. Every evidence item must include source and timestamp fields.
3. Do not return final truth/correctness score in v1.

## 4. `validate_google_map_link`

### Request

```json
{
  "workspace_id": "ws_demo",
  "region_pack_id": "jp",
  "source_list_version": "2026-02-21",
  "url": "https://maps.google.com/...",
  "expected": {
    "name": "Ichiran Shinjuku",
    "location": {
      "lat": 35.6938,
      "lon": 139.7034,
      "radius_m": 350
    },
    "category": "ramen"
  }
}
```

### Response

```json
{
  "workspace_id": "ws_demo",
  "region_pack_id": "jp",
  "source_list_version": "2026-02-21",
  "verdict": "partial",
  "confidence": 0.81,
  "reasons": ["name_mismatch"],
  "matched_place": {
    "canonical_place_id": "poi_123",
    "display_name": "Ichiran Shinjuku Main",
    "location": {
      "lat": 35.694,
      "lon": 139.703
    },
    "external_ids": {
      "google_place_id": "..."
    }
  },
  "evidence": [
    {
      "provider": "google_maps",
      "url": "https://maps.google.com/...",
      "fetched_at": "2026-02-21T11:01:00Z"
    }
  ],
  "contract_version": "v1",
  "policy_version": "2026-02-21"
}
```

## 5. `verify_tabelog`

### Request

```json
{
  "workspace_id": "ws_demo",
  "region_pack_id": "jp",
  "source_list_version": "2026-02-21",
  "tabelog_url": "https://tabelog.com/...",
  "expected": {
    "name": "...",
    "area": "Shinjuku",
    "category": "ramen"
  }
}
```

### Response shape

Same verdict contract as `validate_google_map_link`, with Tabelog-specific evidence and normalized entity fields.

## 6. Verification enums

Verdict:
1. `match`
2. `partial`
3. `mismatch`
4. `inconclusive`

Reason codes:
1. `name_mismatch`
2. `location_mismatch`
3. `category_mismatch`
4. `insufficient_data`
5. `source_unreachable`

## 7. Unknown POI behavior

1. Missing local canonical entry must not produce immediate mismatch.
2. Resolver attempts provider lookup and may create `provisional_place`.
3. If confidence is too low, return `inconclusive` + `insufficient_data`.
4. Optionally enqueue enrichment/HITL review case.

## 8. HITL routing policy

1. `confidence >= 0.92` -> auto-approve.
2. `0.75 <= confidence < 0.92` -> review queue.
3. `confidence < 0.75` -> inconclusive + enrichment.

Reviewer actions:
1. `approve`
2. `merge`
3. `split`
4. `reject`

## 9. Determinism requirements

1. Same input + same data snapshot -> same verdict and reasons.
2. Thresholds and rules are policy-versioned.
3. Responses include `contract_version` and `policy_version`.
