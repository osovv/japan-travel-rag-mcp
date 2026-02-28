# get_site_sources Tool Guide (Lean Draft)

Date: 2026-02-28
Project: `japan-travel-rag-mcp`
Status: Working draft

## 1. Purpose

`get_site_sources` returns only a curated registry of sources for the caller agent.

Tool goal:
1. Give the agent a trusted list of domains.
2. Give tier descriptions and language hints.
3. Keep output metadata-only.

## 2. Output Contract

Tool returns exactly:
1. `description_and_tiers`
2. `sources`

```json
{
  "description_and_tiers": {
    "description": "string",
    "tiers": [
      {
        "tier": 0,
        "name": "string",
        "focus": "string"
      }
    ]
  },
  "sources": [
    {
      "source_id": "string",
      "name": "string",
      "domain": "string",
      "tier": 0,
      "language": "ru|en|ja|en/ja",
      "focus": "string",
      "status": "active|paused"
    }
  ]
}
```

## 3. Seed Data for description_and_tiers

```json
{
  "description_and_tiers": {
    "description": "Curated sources for practical Japan travel research. Prioritize actionable logistics over generic listicles.",
    "tiers": [
      {
        "tier": 0,
        "name": "WrenJapan First",
        "focus": "RU practical essentials: visa, money, accommodation, transport, budgets"
      },
      {
        "tier": 1,
        "name": "Authoritative Guides",
        "focus": "City/district planning, itineraries, practical guidance"
      },
      {
        "tier": 2,
        "name": "Community and Transit Tools",
        "focus": "Real traveler edge-cases and route/fare tools"
      }
    ]
  }
}
```

## 4. Seed Data for sources

```json
{
  "sources": [
    {
      "source_id": "wrenjapan",
      "name": "WrenJapan (Константин Говорун)",
      "domain": "wrenjapan.com",
      "tier": 0,
      "language": "ru",
      "focus": "Visa, money, stay, flights, transport, trip budgets",
      "status": "active"
    },
    {
      "source_id": "insidekyoto",
      "name": "InsideKyoto",
      "domain": "insidekyoto.com",
      "tier": 1,
      "language": "en",
      "focus": "Kyoto districts, itineraries, where to stay",
      "status": "active"
    },
    {
      "source_id": "trulytokyo",
      "name": "TrulyTokyo",
      "domain": "trulytokyo.com",
      "tier": 1,
      "language": "en",
      "focus": "Tokyo districts, food, accommodation, routes",
      "status": "active"
    },
    {
      "source_id": "kansai_odyssey",
      "name": "Kansai Odyssey",
      "domain": "kansai-odyssey.com",
      "tier": 1,
      "language": "en",
      "focus": "Off-the-beaten-path Kansai",
      "status": "active"
    },
    {
      "source_id": "invisible_tourist",
      "name": "The Invisible Tourist",
      "domain": "theinvisibletourist.com",
      "tier": 1,
      "language": "en",
      "focus": "Anti-overtourism, less crowded routes",
      "status": "active"
    },
    {
      "source_id": "japan_unravelled",
      "name": "Japan Unravelled",
      "domain": "japanunravelled.substack.com",
      "tier": 1,
      "language": "en",
      "focus": "Beginner mistakes, monthly practical insights",
      "status": "active"
    },
    {
      "source_id": "japan_guide",
      "name": "Japan-Guide",
      "domain": "japan-guide.com",
      "tier": 1,
      "language": "en",
      "focus": "Reference skeleton: regions, transport, key places",
      "status": "active"
    },
    {
      "source_id": "reddit_japantravel",
      "name": "r/JapanTravel",
      "domain": "reddit.com/r/JapanTravel",
      "tier": 2,
      "language": "en",
      "focus": "FAQ, trip reports, edge cases",
      "status": "active"
    },
    {
      "source_id": "navitime",
      "name": "NAVITIME",
      "domain": "japantravel.navitime.com",
      "tier": 2,
      "language": "en",
      "focus": "Route planning and pass support",
      "status": "active"
    },
    {
      "source_id": "jorudan",
      "name": "Jorudan",
      "domain": "world.jorudan.co.jp",
      "tier": 2,
      "language": "en",
      "focus": "Route, fare, and time calculator",
      "status": "active"
    },
    {
      "source_id": "jreast",
      "name": "JR East",
      "domain": "jreast.co.jp",
      "tier": 2,
      "language": "en/ja",
      "focus": "Official railway status and base info",
      "status": "active"
    },
    {
      "source_id": "smart_ex",
      "name": "SmartEX",
      "domain": "smart-ex.jp",
      "tier": 2,
      "language": "en/ja",
      "focus": "Shinkansen online reservations",
      "status": "active"
    }
  ]
}
```

## 5. Notes

1. Search orchestration is fully delegated to the caller AI agent.
2. This tool is a registry only and should not return page content.
