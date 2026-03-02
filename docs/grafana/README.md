# Grafana Dashboards

Pre-built Grafana dashboards for monitoring the TravelMind MCP system. All dashboards query PostgreSQL directly.

## Prerequisites

- Grafana v10+
- PostgreSQL datasource configured in Grafana

## Import Instructions

1. Go to **Dashboards > Import** in Grafana
2. Upload or paste one of the JSON files below
3. Select your PostgreSQL datasource when prompted
4. Click **Import**

## Dashboards

| File | Description |
|------|-------------|
| `system-overview.json` | High-level health: source counts, page/chunk/embedding totals, crawl activity, index freshness |
| `content-pipeline.json` | Crawl & indexing pipeline: job statuses, page ingestion, chunk distribution, embedding coverage |
| `api-keys-usage.json` | API key lifecycle and tool usage: key states, usage leaderboard, per-user activity |

## Datasource Variable

All dashboards use `${DS_POSTGRESQL}` as the datasource UID. Grafana will prompt you to bind this to your PostgreSQL datasource on import.

## Default Settings

- **Time range:** Last 7 days
- **Refresh interval:** 5 minutes
