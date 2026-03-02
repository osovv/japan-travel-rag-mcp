# Multi-Tenant Country Architecture Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform single-destination Japan MCP server into a multi-country platform. One MCP endpoint `/mcp`, tools accept `country_code` parameter. User connects once, queries any destination.

**Architecture:** Single FastMCP instance at `/mcp`. Each tool gets a `country_code` enum parameter. Services filter data by `country_code`. New `country_settings` table for per-country runtime config (tg_chat_ids, status). `country_code` column added to `site_sources` and `usage_counters`.

**Tech Stack:** Bun, Hono, FastMCP, PostgreSQL (Drizzle ORM), existing OAuth/Logto.

---

## 0. Context

### Locked architectural decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| MCP endpoint | Single `/mcp`, `country_code` as tool parameter | One connector for user, zero re-auth friction |
| Portal | Unified `/portal` | One account, all destinations |
| TG upstream | One tg-chat-rag, chat_ids filtered per-country | Simpler infra |
| Database | Shared DB + `country_code` columns | One migration, simple JOINs |
| Auth | Global (one Logto account) | One API key, shared credits |
| Country config | `country_settings` table (code, status, JSONB settings) | Runtime control via status lifecycle, extensible |
| Country codes | ISO 3166-1 alpha-2 (jp, cn, it, es, kr) | Standard |
| Display names | i18n keys, not in DB | Separation of concerns |

### Key insight: why tool parameter, not per-URL

Per-URL (`/ja/mcp`, `/it/mcp`):
- User adds N connectors to Claude/Cursor
- N OAuth flows
- N FastMCP instances on server
- Complex routing

Tool parameter (`country_code`):
- User adds ONE connector
- ONE OAuth flow
- ONE FastMCP instance
- AI naturally picks correct `country_code` from user's query
- Adding a country = insert rows in DB, no code changes

### What changes

| Component | File | Current | After |
|-----------|------|---------|-------|
| Tool schemas | `src/tools/contracts.ts` | No country param | `country_code` enum on each tool |
| Site sources | `src/tools/site-sources.ts` | Frozen `SITE_SOURCES_RESPONSE` | DB query filtered by `country_code` |
| Proxy service | `src/tools/proxy-service.ts` | `config.tgChatRag.chatIds` global | Lookup chat_ids from `country_settings` |
| Search repo | `src/sites/search/repository.ts` | No country filter | `WHERE ss.country_code = ?` |
| Usage tracker | `src/usage/tracker.ts` | `(userId, toolName)` PK | `(userId, toolName, countryCode)` PK |
| DB schema | `src/db/schema.ts` | No country concept | `country_settings` table + `country_code` columns |
| Tool descriptions | `src/runtime/fastmcp-runtime.ts:1155,1186` | "Japan travel" hardcoded | Generic: "travel site pages" |
| Server name | `src/runtime/fastmcp-runtime.ts:49` | `"japan-travel-rag-mcp"` | `"travelmind-mcp"` |
| Portal branding | `src/portal/ui-routes.tsx` ~15 places | "TravelMind" / "TravelMind" | Platform brand + destination list |

### What stays unchanged

- OAuth flow (Logto)
- API key auth (`api_keys` table)
- Usage tracking pattern (fire-and-forget)
- Admin routes structure
- Embedding pipeline (Voyage proxy)
- Crawl pipeline (Spider)
- MCP endpoint path (`/mcp`)
- FastMCP instance count (one)

### Related documents

- `docs/product/region-pack-format.md` — Earlier region pack spec (superseded by this plan)
- `docs/product/pricing-and-monetization-strategy-2026-03-02.md` — Pricing strategy
- `docs/plans/archive/2026-03-01-billing-cloudpayments-plan.md` — Deferred billing plan

---

## 1. Target Design

### 1.1 Tool UX after change

```
User: "Find info about ramen in Tokyo"
AI  → search_messages({ query: "ramen Tokyo", country_code: "jp" })

User: "What about pasta in Rome?"
AI  → search_messages({ query: "pasta Rome", country_code: "it" })

User: "Show me sources for Japan"
AI  → get_site_sources({ country_code: "jp" })
```

One MCP connection. AI infers `country_code` from context.

### 1.2 country_settings table

```sql
CREATE TABLE country_settings (
  country_code TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Status values:

| Status | Tool calls | Shown in UI | Use case |
|--------|-----------|-------------|----------|
| `draft` | No | No | Initial setup, adding sources |
| `active` | Yes | Yes | Live, serving data |
| `coming_soon` | No | Yes (teaser) | Announced but not ready |
| `maintenance` | No | Yes (notice) | Temporarily down for data update |

Example rows:

```json
-- jp row
{ "country_code": "jp", "status": "active",      "settings": { "tg_chat_ids": ["chat-123", "chat-456"] } }
-- it row
{ "country_code": "it", "status": "coming_soon",  "settings": { "tg_chat_ids": ["chat-789"] } }
```

`settings` JSONB holds `tg_chat_ids` and any future per-country config. `status` replaces a boolean `active` flag — avoids "programming on flags" antipattern (see: Мокевнин on flag-based programming).

### 1.3 country_code on existing tables

```sql
ALTER TABLE site_sources ADD COLUMN country_code TEXT
  NOT NULL DEFAULT 'jp' REFERENCES country_settings(country_code);

-- usage_counters: extend composite PK
-- Old PK: (user_id, tool_name)
-- New PK: (user_id, tool_name, country_code)
ALTER TABLE usage_counters ADD COLUMN country_code TEXT NOT NULL DEFAULT 'jp';
```

### 1.4 Tool schema changes

Each tool that touches country-specific data gets `country_code` parameter:

| Tool | Gets `country_code`? | Why |
|------|---------------------|-----|
| `search_messages` | Yes | Filters tg chat_ids by country |
| `get_message_context` | No | Uses message_uid, already scoped |
| `get_related_messages` | No | Uses message_uid, already scoped |
| `list_sources` | Yes | Returns sources for specific country |
| `get_site_sources` | Yes | Returns curated site registry per country |
| `search_sites` | Yes | Filters site_sources by country |
| `get_page_chunk` | No | Uses chunk_id, already scoped |

`country_code` is required on tools that need it. Enum is built dynamically from countries with `status = 'active'` in `country_settings`.

### 1.5 Config changes

**Remove from AppConfig:**
```
TG_CHAT_RAG_CHAT_IDS  -- moves to country_settings.settings.tg_chat_ids
```

**Keep in AppConfig (shared):**
```
TG_CHAT_RAG_BASE_URL
TG_CHAT_RAG_BEARER_TOKEN
TG_CHAT_RAG_TIMEOUT_MS
```

### 1.6 Code layout

```
src/
├── countries/
│   ├── index.ts                        # Public exports
│   ├── country-settings.ts             # DB repository: get, list by status, upsert
│   ├── country-cache.ts                # In-memory cache of active countries (status='active', refreshed on startup)
│   └── __tests__/
│       ├── country-settings.test.ts
│       └── country-cache.test.ts
├── tools/
│   ├── contracts.ts                    # MODIFIED: add country_code to schemas
│   ├── site-sources.ts                 # MODIFIED: query by country_code
│   └── proxy-service.ts               # MODIFIED: accept chatIds param
├── sites/search/
│   └── repository.ts                   # MODIFIED: filter by country_code
├── usage/
│   └── tracker.ts                      # MODIFIED: country_code in PK
├── runtime/
│   └── fastmcp-runtime.ts             # MODIFIED: generic descriptions, pass country context
├── server/
│   └── index.ts                        # MODIFIED: load country settings at startup
├── portal/
│   └── ui-routes.tsx                   # MODIFIED: platform branding, destination list
└── db/
    └── schema.ts                       # MODIFIED: country_settings table, country_code columns
```

---

## 2. Implementation Tasks

### Task 1: country_settings table and repository

**Files:**
- Modify: `src/db/schema.ts` (add `countrySettingsTable`)
- Create: `src/countries/country-settings.ts`
- Test: `src/countries/__tests__/country-settings.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { getCountrySettings, getCountriesByStatus, upsertCountrySettings } from "../country-settings";

describe("country-settings", () => {
  test("getCountrySettings returns null for unknown country", async () => {
    const settings = await getCountrySettings(db, "zz");
    expect(settings).toBeNull();
  });

  test("upsertCountrySettings creates new country", async () => {
    await upsertCountrySettings(db, {
      countryCode: "jp",
      status: "active",
      settings: { tg_chat_ids: ["chat-123", "chat-456"] },
    });
    const result = await getCountrySettings(db, "jp");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("active");
    expect(result!.settings.tg_chat_ids).toEqual(["chat-123", "chat-456"]);
  });

  test("getCountriesByStatus returns only matching status", async () => {
    await upsertCountrySettings(db, { countryCode: "jp", status: "active", settings: {} });
    await upsertCountrySettings(db, { countryCode: "it", status: "coming_soon", settings: {} });
    await upsertCountrySettings(db, { countryCode: "cn", status: "draft", settings: {} });
    const active = await getCountriesByStatus(db, "active");
    expect(active.length).toBe(1);
    expect(active[0].countryCode).toBe("jp");
  });
});
```

**Step 2: Run test — expect FAIL**

Run: `bun test src/countries/__tests__/country-settings.test.ts`

**Step 3: Add schema**

```typescript
export const countrySettingsTable = pgTable("country_settings", {
  countryCode: text("country_code").primaryKey(),
  status: text("status").notNull().default("draft"),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Step 4: Implement repository**

```typescript
// src/countries/country-settings.ts

export type CountryStatus = "draft" | "active" | "coming_soon" | "maintenance";

export type CountrySettings = {
  countryCode: string;
  status: CountryStatus;
  settings: Record<string, unknown>;
};

export async function getCountrySettings(db: DbClient, countryCode: string): Promise<CountrySettings | null> { ... }
export async function getCountriesByStatus(db: DbClient, status: CountryStatus): Promise<CountrySettings[]> { ... }
export async function upsertCountrySettings(db: DbClient, data: CountrySettings): Promise<void> { ... }
```

**Step 5: Run test — expect PASS**

**Step 6: Commit**

```bash
git add src/db/schema.ts src/countries/country-settings.ts src/countries/__tests__/country-settings.test.ts
git commit -m "feat(countries): add country_settings table and repository"
```

---

### Task 2: Add country_code to site_sources + search filtering

**Files:**
- Modify: `src/db/schema.ts` (add column to `siteSourcesTable`)
- Modify: `src/sites/search/repository.ts` (filter by `country_code`)
- Test: extend existing search tests

**Step 1: Write the failing test**

```typescript
test("searchHybrid filters by country_code", async () => {
  // Seed: source_a (country=jp), source_b (country=it)
  const results = await repository.searchHybrid({
    query_embedding: [...],
    query_text: "tokyo",
    index_version: "v1",
    top_k: 10,
    country_code: "jp",
  });
  for (const r of results) {
    expect(r.source_id).not.toBe("source_b");
  }
});
```

**Step 2: Run test — expect FAIL**

**Step 3: Add column**

```typescript
// In siteSourcesTable
countryCode: text("country_code").notNull().default("jp")
  .references(() => countrySettingsTable.countryCode),
```

**Step 4: Add filter to searchHybrid**

Add `country_code` to `HybridSearchParams`. When present, add `WHERE ss.country_code = ${params.country_code}`.

**Step 5: Run all tests — expect PASS**

Run: `bun test`

**Step 6: Commit**

```bash
git add src/db/schema.ts src/sites/search/repository.ts src/sites/search/__tests__/
git commit -m "feat(countries): add country_code to site_sources with search filtering"
```

---

### Task 3: Add country_code to usage_counters

**Files:**
- Modify: `src/db/schema.ts` (add column)
- Modify: `src/usage/tracker.ts` (accept `countryCode`)
- Test: `src/usage/__tests__/tracker.test.ts`

**Step 1: Write the failing test**

```typescript
test("recordToolCall stores country_code", async () => {
  tracker.recordToolCall("user-1", "search_sites", "jp");
  // Verify stored with country_code = "jp"
});

test("getUserStats can filter by country_code", async () => {
  tracker.recordToolCall("user-1", "search_sites", "jp");
  tracker.recordToolCall("user-1", "search_sites", "it");
  const stats = await tracker.getUserStats("user-1", { countryCode: "jp" });
  expect(stats.total).toBe(1);
});
```

**Step 2: Run test — expect FAIL**

**Step 3: Update schema and tracker**

New composite PK: `(userId, toolName, countryCode)`. Update `recordToolCall(userId, toolName, countryCode)`.

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add src/db/schema.ts src/usage/tracker.ts src/usage/__tests__/tracker.test.ts
git commit -m "feat(countries): add country_code to usage_counters"
```

---

### Task 4: country_code parameter in tool schemas

**Files:**
- Modify: `src/tools/contracts.ts` (add `country_code` to relevant schemas)
- Test: `src/tools/__tests__/contracts.test.ts`

**Step 1: Write the failing test**

```typescript
test("search_messages schema includes country_code enum", () => {
  const schema = TOOL_INPUT_JSON_SCHEMAS.search_messages;
  expect(schema.properties.country_code).toBeDefined();
  expect(schema.properties.country_code.enum).toContain("jp");
  expect(schema.required).toContain("country_code");
});

test("get_page_chunk schema does NOT include country_code", () => {
  const schema = TOOL_INPUT_JSON_SCHEMAS.get_page_chunk;
  expect(schema.properties.country_code).toBeUndefined();
});
```

**Step 2: Implement**

Add `country_code` to schemas for: `search_messages`, `list_sources`, `get_site_sources`, `search_sites`.

The enum values are loaded at startup from `getActiveCountries()` and injected into schemas.

```typescript
export function buildToolSchemas(activeCountryCodes: string[]): ToolSchemas {
  const countryCodeSchema = {
    type: "string" as const,
    enum: activeCountryCodes,
    description: "ISO 3166-1 alpha-2 country code for the destination (e.g. 'jp', 'it', 'cn')",
  };

  return {
    search_messages: {
      ...BASE_SEARCH_MESSAGES_SCHEMA,
      properties: {
        ...BASE_SEARCH_MESSAGES_SCHEMA.properties,
        country_code: countryCodeSchema,
      },
      required: [...BASE_SEARCH_MESSAGES_SCHEMA.required, "country_code"],
    },
    // ... same for list_sources, get_site_sources, search_sites
  };
}
```

**Step 3: Run tests — expect PASS**

**Step 4: Commit**

```bash
git add src/tools/contracts.ts src/tools/__tests__/contracts.test.ts
git commit -m "feat(countries): add country_code parameter to tool schemas"
```

---

### Task 5: Region-aware proxy service (per-country chat_ids)

**Files:**
- Modify: `src/tools/proxy-service.ts` (accept `chatIds` param)
- Test: `src/tools/__tests__/proxy-service.test.ts`

**Step 1: Write the failing test**

```typescript
test("executeTool injects country-specific chat_ids into search_messages", async () => {
  const result = await executeTool(
    config, logger, client,
    "search_messages",
    { query: "ramen", country_code: "jp" },
    { chatIds: ["chat-jp-1", "chat-jp-2"] },
  );
  // Verify upstream payload has chat_ids = ["chat-jp-1", "chat-jp-2"]
});
```

**Step 2: Implement**

Add `CountryContext` to `executeTool`:

```typescript
type CountryContext = { chatIds: string[] };

export async function executeTool(
  config: AppConfig,
  logger: Logger,
  client: TgChatRagClient,
  toolName: string,
  rawArgs: unknown,
  countryContext: CountryContext,
): Promise<McpToolResult> { ... }
```

In `buildUpstreamPayloadWithPolicy`, use `countryContext.chatIds` instead of `config.tgChatRag.chatIds`.

**Step 3: Run tests — expect PASS**

**Step 4: Commit**

```bash
git add src/tools/proxy-service.ts src/tools/__tests__/proxy-service.test.ts
git commit -m "feat(countries): proxy service accepts per-country chat_ids"
```

---

### Task 6: Region-aware site sources (replace frozen constant)

**Files:**
- Modify: `src/tools/site-sources.ts` (load from DB by country_code)
- Test: `src/tools/__tests__/site-sources.test.ts`

**Step 1: Write the failing test**

```typescript
test("getSiteSourcesForCountry returns sources filtered by country", async () => {
  // Seed: 3 sources for jp, 2 for it
  const response = await getSiteSourcesForCountry(db, "jp");
  expect(response.sources.length).toBe(3);
});

test("getSiteSourcesForCountry returns empty for country with no sources", async () => {
  const response = await getSiteSourcesForCountry(db, "kr");
  expect(response.sources.length).toBe(0);
});
```

**Step 2: Implement**

Replace frozen `SITE_SOURCES_RESPONSE` with function that queries `site_sources WHERE country_code = ?`. Same response shape for backwards compat.

**Step 3: Run tests — expect PASS**

**Step 4: Commit**

```bash
git add src/tools/site-sources.ts src/tools/__tests__/site-sources.test.ts
git commit -m "feat(countries): DB-backed per-country site sources"
```

---

### Task 7: Wire country_code through tool execution in FastMCP runtime

**Files:**
- Modify: `src/runtime/fastmcp-runtime.ts`
- Modify: `src/server/index.ts` (load countries at startup, pass to runtime)

This is the integration task — wiring everything together.

**Step 1: Load country settings at startup**

In `server/index.ts`, after DB bootstrap:
```typescript
const activeCountries = await getCountriesByStatus(db, "active");
const countryCache = buildCountryCache(activeCountries);
```

**Step 2: Build tool schemas with country enum**

```typescript
const activeCountryCodes = activeCountries.map(c => c.countryCode);
const toolSchemas = buildToolSchemas(activeCountryCodes);
```

**Step 3: Update tool execution handlers**

In `registerProxyTools` and `registerLocalTools`, extract `country_code` from tool args and resolve country context:

```typescript
// In search_messages handler:
execute: async (args, context) => {
  const countryCode = args.country_code;
  const country = countryCache.get(countryCode);
  if (!country) return errorResult("Unknown country_code");

  const chatIds = country.settings.tg_chat_ids ?? [];
  const result = await proxyService.executeTool(
    "search_messages", args, { chatIds }
  );

  const userId = extractUserIdFromSession(context.session);
  if (userId) tracker.recordToolCall(userId, "search_messages", countryCode);
  return result;
};
```

```typescript
// In search_sites handler:
execute: async (args, context) => {
  const result = await sitesSearchService.searchSites({
    query: args.query,
    top_k: args.top_k,
    source_ids: args.source_ids,
    country_code: args.country_code,  // NEW: passed to repository
  });
  // ...
};
```

**Step 4: Update tool descriptions — make generic**

```typescript
// Old:
"Search curated Japan travel site pages by semantic similarity."
// New:
"Search curated travel site pages by semantic similarity. Use country_code to specify destination."
```

**Step 5: Update server name**

```typescript
const FASTMCP_SERVER_NAME = "travelmind-mcp";
```

**Step 6: Run all tests**

Run: `bun test`

**Step 7: Commit**

```bash
git add src/runtime/fastmcp-runtime.ts src/server/index.ts
git commit -m "feat(countries): wire country_code through tool execution pipeline"
```

---

### Task 8: Seed Japan country + migrate existing data

**Files:**
- Create: `src/db/seeds/country-settings.ts`

**Step 1: Write seed**

```typescript
export async function seedJapanCountry(db: DbClient): Promise<void> {
  await db.insert(countrySettingsTable).values({
    countryCode: "jp",
    status: "active",
    settings: { tg_chat_ids: ["chat-id-1", "chat-id-2"] }, // from current TG_CHAT_RAG_CHAT_IDS
  }).onConflictDoNothing();
}
```

**Step 2: Run in bootstrap**

Add to server startup, after schema bootstrap.

**Step 3: Migrate existing site_sources**

All existing rows get `country_code = 'jp'` (via column default, already done).

**Step 4: Remove TG_CHAT_RAG_CHAT_IDS from env**

Update `loadConfig()` to make `chatIds` optional (backwards compat during migration).

**Step 5: Verify**

Start server, call `search_messages({ query: "ramen", country_code: "jp" })`, verify same results as before.

**Step 6: Commit**

```bash
git add src/db/seeds/country-settings.ts src/config/index.ts src/server/index.ts
git commit -m "feat(countries): seed Japan country, migrate data, deprecate TG_CHAT_RAG_CHAT_IDS env var"
```

---

### Task 9: Portal — platform branding

**Files:**
- Modify: `src/portal/ui-routes.tsx` (~15 locations)
- Modify: `src/config/index.ts` (add PLATFORM_NAME)

**Step 1: Add platform config**

New env vars:
```
PLATFORM_NAME=Travel RAG
```

**Step 2: Replace all "TravelMind" strings**

| Location (approx lines) | Current | New |
|--------------------------|---------|-----|
| 293, 460 | "TravelMind" heading | `${platformName}` |
| 319, 332, 387, 397 | Setup guide with "japan-travel-rag" | Generic with `/mcp` endpoint |
| 461 | "Your AI-powered travel companion for Japan..." | "Your AI-powered travel companion" |
| 557, 565, 602 | Sign-up/sign-in titles | `${platformName}` |
| 861, 941 | Nav brand | `${platformName}` |

**Step 3: Add destination list to portal home**

Show countries by status with source counts:
```html
<h2>Available Destinations</h2>
<ul>
  <li>Japan — 12 curated sites</li>
  <li>Italy — Coming soon</li>
</ul>
```

**Step 4: Update agent setup guide**

Show single MCP endpoint `/mcp` with note that `country_code` parameter selects destination.

**Step 5: Commit**

```bash
git add src/portal/ui-routes.tsx src/config/index.ts
git commit -m "feat(portal): platform branding and destination list"
```

---

## 3. Migration Strategy

### Deployment order

1. Deploy `country_settings` table (Task 1) — no breaking changes
2. Deploy `country_code` columns on existing tables (Tasks 2, 3) — defaults ensure backwards compat
3. Seed Japan country (Task 8)
4. Deploy tool schema changes + wiring (Tasks 4-7) — tools gain `country_code` param
5. Deploy portal changes (Task 9)
6. Remove deprecated `TG_CHAT_RAG_CHAT_IDS` env var

### Backwards compatibility

- Existing MCP endpoint `/mcp` unchanged
- Tools gain a new required `country_code` param — **breaking change for existing MCP clients**
- Mitigation: could make `country_code` optional with default `"jp"` for transition period

### Rollback plan

- `country_code` columns have default `'jp'` — safe to roll back code without DB migration
- If tool schema change breaks clients, revert to optional `country_code` with default

---

## 4. Testing Strategy

### Unit tests (per task)
- country_settings CRUD
- Search filtering by country_code
- Usage tracking with country_code
- Tool schema validation with country_code enum
- Proxy service with per-country chat_ids

### Integration tests
- Call `search_messages({ query: "...", country_code: "jp" })` — returns Japan results
- Call `search_sites({ query: "...", country_code: "jp" })` — filters by Japan sources
- Call `get_site_sources({ country_code: "jp" })` — returns Japan sources only
- Usage counter incremented with correct country_code

### Manual tests
- Connect Claude Desktop to `/mcp`
- Ask about Japan → AI sends `country_code: "jp"`
- Ask about Italy (no data yet) → AI sends `country_code: "it"`, gets empty/error
- Portal shows destination list

---

## 5. What This Unlocks

1. **Adding a new country = DB only:** insert `country_settings` row + add `site_sources` rows
2. **No code changes per country** — enum updates from DB at startup
3. **One MCP connection for all destinations** — frictionless UX
4. **Per-country analytics** — usage_counters grouped by country_code
5. **Per-country pricing** possible — credits cost different per country
6. **Dev2Dev** — one API integration, pass `country_code` to query any destination

---

## 6. Estimated Effort

| Task | Size | Risk |
|------|------|------|
| Task 1: country_settings table | S | Low |
| Task 2: country_code on site_sources | S | Low |
| Task 3: country_code on usage_counters | S | Low |
| Task 4: country_code in tool schemas | M | Low |
| Task 5: Per-country proxy service | S | Low |
| Task 6: DB-backed site sources | M | Low |
| **Task 7: Wire through FastMCP runtime** | **M** | **Low** |
| Task 8: Seed Japan + migrate | S | Low |
| Task 9: Portal branding | M | Low |

**No large/high-risk tasks.** Previous plan had Task 7 (region router) as L/Medium risk. That's gone.

**Critical path:** Task 1 → Tasks 2, 3 (parallel) → Tasks 4, 5, 6 (parallel) → Task 7 → Task 8 → Task 9
