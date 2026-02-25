# Region Pack Format and Versioning

Date: 2026-02-21
Project: `japan-travel-rag-mcp`

## 1. Purpose

`region_pack` defines curated source scope and retrieval settings for a geography/domain.

Examples:
1. `jp` (Japan travel)
2. `it` (Italy travel)

## 2. Core identity

1. `workspace_id`: who owns or uses the configuration.
2. `region_pack_id`: what curated geography/domain pack is used.
3. `source_list_version`: immutable snapshot identifier for source list and policies.

## 3. Minimal pack structure

```json
{
  "region_pack_id": "jp",
  "display_name": "Japan Travel",
  "default_languages": ["ru", "en", "ja"],
  "source_list_version": "2026-02-21",
  "sources": [
    {
      "source_id": "tg:jp-chat-1",
      "source_type": "telegram",
      "enabled": true,
      "priority_weight": 1.0,
      "trust_prior": 0.8,
      "connector_config": {}
    }
  ],
  "policy": {
    "public_only": true,
    "snippet_limits": {},
    "retention": {}
  }
}
```

## 4. Versioning rules

1. `source_list_version` is immutable after release.
2. Any source add/remove/weight/policy change creates a new version.
3. Retrieval and verification requests include version explicitly for reproducibility.
4. Ingest lineage stores version for every indexed chunk.

## 5. Migration strategy

1. Roll out new versions as `canary` for selected workflows.
2. Run smoke validation against old/new versions.
3. Promote new version to default only if guardrails pass.

## 6. Backfill interaction

1. Backfill jobs are version-aware.
2. Reindex operations should write lineage with target `source_list_version`.
3. Old versions remain queryable for audit/replay when needed.
