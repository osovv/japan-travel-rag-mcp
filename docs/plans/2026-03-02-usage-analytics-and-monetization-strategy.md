# Usage Analytics & Monetization Strategy Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build detailed per-tool cost analytics, admin dashboard, and donate link — deferring actual billing to when real usage data informs pricing decisions.

**Architecture:** Extend existing `usage_counters` with cost attribution and time-series data. Add admin analytics routes to portal. Keep existing fire-and-forget tracking pattern. No payment gateway integration yet.

**Tech Stack:** Bun, PostgreSQL (Drizzle ORM), Bun.serve() HTML routes, existing portal auth.

---

## 0. Context

### Previous plan (archived)

`docs/plans/archive/2026-03-01-billing-cloudpayments-plan.md` — CloudPayments billing integration.
Archived because premature: no user base yet, no real usage data to inform pricing.

### Strategic decision

Instead of building billing first, we:
1. **Launch free** with unlimited usage for 1-2 months
2. **Track everything** — per-tool costs, user segments, usage patterns
3. **Decide pricing** based on real data
4. **Add billing later** when user base exists (CloudPayments plan still valid for Phase 2)

### Benefits of free-first approach
- Removes legal concerns about commercial use of external sources
- Lower barrier to entry — faster user acquisition
- Project serves as portfolio/showcase ("I can build this for you")
- Real data > guesses for pricing decisions
- Actual infra costs are ~tens of dollars/month (excluding VPS shared with other projects)

### Related documents
- `docs/research/payment-providers.md` — Provider research (still valid for future)
- `docs/plans/archive/2026-03-01-billing-cloudpayments-plan.md` — Billing plan (deferred)

---

## 1. Tool Cost Model

### Cost tiers (virtual, for analytics only)

| Tool | Tier | Virtual Cost | Rationale |
|------|------|-------------|-----------|
| `list_sources` | free | 0 | Static data, proxied API call, trivial |
| `get_site_sources` | free | 0 | Static frozen registry, local memory |
| `get_message_context` | low | 1 | Upstream DB query, no embeddings |
| `get_page_chunk` | low | 1 | Local DB query, single row fetch |
| `get_related_messages` | medium | 2 | Vector similarity search in upstream 25GB DB |
| `search_messages` | medium | 2 | Vector search + embeddings in upstream 25GB DB |
| `search_sites` | high | 3 | Vector search + spider.cloud API + local embeddings |

Virtual costs are unitless weights for relative comparison. They will be calibrated against real infra costs after data collection.

### User segments (for analytics tagging, not enforcement)

| Segment | Pattern | Expected behavior |
|---------|---------|-------------------|
| Individual traveler | 2-3 months active/year, trip planning + during trip (14-30 days) | Burst usage, seasonal |
| Guide / organizer | Year-round, frequent queries | Steady, higher volume |
| Agency | Year-round, high volume, multiple clients | Highest volume |

Segment assignment: manual initially (admin tag), auto-detection later based on usage patterns.

---

## 2. Scope

### In scope (this plan)
1. Extend `usage_counters` schema with cost tracking and metadata
2. Define tool cost registry in code
3. Enhanced usage tracker with cost attribution
4. Admin analytics dashboard (owner-only portal page)
5. Donate link on portal
6. Per-user usage detail page in portal

### Out of scope
1. Payment gateway integration (deferred — see archived plan)
2. Usage limits / enforcement (no limits during free period)
3. Credit system / balance management
4. Subscription or top-up flows
5. User segment auto-detection

---

## 3. Target Design

### 3.1 Schema changes

Add new table `usage_events` for time-series tracking (keep `usage_counters` as fast aggregate):

```sql
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,            -- nanoid
  user_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  virtual_cost INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,            -- tool execution time
  metadata JSONB,                 -- tool-specific: query length, result count, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_events_user ON usage_events(user_id);
CREATE INDEX idx_usage_events_tool ON usage_events(tool_name);
CREATE INDEX idx_usage_events_created ON usage_events(created_at);
CREATE INDEX idx_usage_events_user_created ON usage_events(user_id, created_at);
```

Add `user_profiles` table for segment tagging:

```sql
CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY,
  segment TEXT NOT NULL DEFAULT 'individual',  -- 'individual' | 'guide' | 'agency'
  display_name TEXT,
  notes TEXT,                                   -- admin notes
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.2 Tool cost registry

```typescript
// src/usage/tool-costs.ts

export type ToolCostTier = "free" | "low" | "medium" | "high";

export type ToolCostEntry = {
  tier: ToolCostTier;
  virtualCost: number;
};

export const TOOL_COSTS: Record<string, ToolCostEntry> = {
  list_sources:        { tier: "free",   virtualCost: 0 },
  get_site_sources:    { tier: "free",   virtualCost: 0 },
  get_message_context: { tier: "low",    virtualCost: 1 },
  get_page_chunk:      { tier: "low",    virtualCost: 1 },
  get_related_messages:{ tier: "medium", virtualCost: 2 },
  search_messages:     { tier: "medium", virtualCost: 2 },
  search_sites:        { tier: "high",   virtualCost: 3 },
};

export function getToolCost(toolName: string): ToolCostEntry {
  return TOOL_COSTS[toolName] ?? { tier: "free", virtualCost: 0 };
}
```

### 3.3 Enhanced usage tracker

Extend `UsageTracker` to:
1. Write to `usage_events` (time-series) alongside `usage_counters` (aggregate)
2. Include `virtualCost` and `durationMs` in event
3. Add `getAdminStats()` for dashboard queries

```typescript
// Extended type
export type UsageEvent = {
  userId: string;
  toolName: string;
  virtualCost: number;
  durationMs: number | null;
  metadata: Record<string, unknown> | null;
};

// Extended tracker interface
export type UsageTracker = {
  recordToolCall(userId: string, toolName: string): void;
  recordToolEvent(event: UsageEvent): void;
  getUserStats(userId: string): Promise<UserUsageStats>;
  getAdminStats(opts: { days: number }): Promise<AdminUsageStats>;
};
```

### 3.4 Portal routes

| Route | Method | Access | Purpose |
|-------|--------|--------|---------|
| `GET /portal/home` | GET | user | Existing — enhance with cost breakdown |
| `GET /portal/admin/analytics` | GET | admin | Analytics dashboard |
| `GET /portal/admin/analytics/user/:userId` | GET | admin | Per-user detail |

Admin access: check against `ROOT_AUTH_TOKEN` or specific Logto role (simplest: compare `session.sub` against env var `ADMIN_USER_IDS`).

### 3.5 Admin dashboard content

1. **Summary cards:** Total users, total calls, total virtual cost, active users (last 7d)
2. **Per-tool breakdown:** Table with tool name, call count, total virtual cost, avg calls/user
3. **Top users:** Table with user ID, segment, total calls, total virtual cost, last active
4. **Time series:** Calls per day (last 30 days) — simple HTML table, no charts library
5. **Cost estimation:** Map virtual costs to approximate real costs (configurable multiplier)

### 3.6 Donate link

Add to portal home page and landing page:
- Simple link to donation platform (e.g., Boosty, Buy Me a Coffee, or direct card link)
- Env var: `DONATE_URL` (optional, if set — show link)

### 3.7 Config extension

New env vars:

```
ADMIN_USER_IDS=sub_abc123,sub_def456    # comma-separated Logto sub claims
DONATE_URL=https://boosty.to/yourpage   # optional
```

---

## 4. Implementation Tasks

### Task 1: Tool cost registry

**Files:**
- Create: `src/usage/tool-costs.ts`
- Test: `src/usage/__tests__/tool-costs.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, test, expect } from "bun:test";
import { getToolCost, TOOL_COSTS } from "../tool-costs";

describe("tool-costs", () => {
  test("all known tools have cost entries", () => {
    const knownTools = [
      "list_sources", "get_site_sources", "get_message_context",
      "get_page_chunk", "get_related_messages", "search_messages", "search_sites",
    ];
    for (const tool of knownTools) {
      expect(TOOL_COSTS[tool]).toBeDefined();
    }
  });

  test("free tools have virtualCost 0", () => {
    expect(getToolCost("list_sources").virtualCost).toBe(0);
    expect(getToolCost("get_site_sources").virtualCost).toBe(0);
  });

  test("search_sites is highest cost", () => {
    expect(getToolCost("search_sites").virtualCost).toBeGreaterThan(
      getToolCost("search_messages").virtualCost,
    );
  });

  test("unknown tool returns free tier", () => {
    expect(getToolCost("nonexistent_tool")).toEqual({ tier: "free", virtualCost: 0 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/usage/__tests__/tool-costs.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/usage/tool-costs.ts` with the code from section 3.2.

**Step 4: Run test to verify it passes**

Run: `bun test src/usage/__tests__/tool-costs.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/usage/tool-costs.ts src/usage/__tests__/tool-costs.test.ts
git commit -m "feat(usage): add tool cost registry with tier-based virtual costs"
```

---

### Task 2: Database schema — usage_events table

**Files:**
- Modify: `src/db/schema.ts` (add `usageEventsTable`)
- Modify: `src/usage/tracker.ts` (add bootstrap for new table)
- Test: `src/usage/__tests__/tracker.test.ts` (extend existing tests)

**Step 1: Write the failing test**

```typescript
// Add to existing tracker tests
test("recordToolEvent writes to usage_events", async () => {
  const tracker = createUsageTracker(db);
  await tracker.recordToolEvent({
    userId: "test-user",
    toolName: "search_messages",
    virtualCost: 2,
    durationMs: 150,
    metadata: { query: "tokyo hotels", resultCount: 10 },
  });

  const events = await db.select().from(usageEventsTable)
    .where(eq(usageEventsTable.userId, "test-user"));
  expect(events).toHaveLength(1);
  expect(events[0].toolName).toBe("search_messages");
  expect(events[0].virtualCost).toBe(2);
  expect(events[0].durationMs).toBe(150);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/usage/__tests__/tracker.test.ts`
Expected: FAIL — `usageEventsTable` not defined

**Step 3: Add schema definition**

Add to `src/db/schema.ts`:

```typescript
export const usageEventsTable = pgTable("usage_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  toolName: text("tool_name").notNull(),
  virtualCost: integer("virtual_cost").notNull().default(0),
  durationMs: integer("duration_ms"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Step 4: Add bootstrap SQL to tracker**

Add `CREATE TABLE IF NOT EXISTS usage_events ...` to the tracker bootstrap function alongside existing `usage_counters` bootstrap.

**Step 5: Implement `recordToolEvent`**

Add to tracker: insert into `usage_events` with nanoid for `id`, fire-and-forget pattern matching existing `recordToolCall`.

**Step 6: Run tests**

Run: `bun test src/usage/__tests__/tracker.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/db/schema.ts src/usage/tracker.ts src/usage/__tests__/tracker.test.ts
git commit -m "feat(usage): add usage_events table for time-series cost tracking"
```

---

### Task 3: Database schema — user_profiles table

**Files:**
- Modify: `src/db/schema.ts` (add `userProfilesTable`)
- Create: `src/usage/profiles.ts` (profile CRUD)
- Test: `src/usage/__tests__/profiles.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, test, expect } from "bun:test";

describe("user-profiles", () => {
  test("getOrCreateProfile returns default individual segment", async () => {
    const profile = await getOrCreateProfile(db, "test-user-1");
    expect(profile.segment).toBe("individual");
  });

  test("updateSegment changes user segment", async () => {
    await getOrCreateProfile(db, "test-user-2");
    await updateProfile(db, "test-user-2", { segment: "guide" });
    const profile = await getOrCreateProfile(db, "test-user-2");
    expect(profile.segment).toBe("guide");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/usage/__tests__/profiles.test.ts`
Expected: FAIL

**Step 3: Add schema + implementation**

Add `userProfilesTable` to schema.ts. Create `src/usage/profiles.ts` with `getOrCreateProfile`, `updateProfile` functions.

**Step 4: Run tests**

Run: `bun test src/usage/__tests__/profiles.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/schema.ts src/usage/profiles.ts src/usage/__tests__/profiles.test.ts
git commit -m "feat(usage): add user_profiles table with segment tagging"
```

---

### Task 4: Integrate cost tracking into tool execution

**Files:**
- Modify: `src/runtime/fastmcp-runtime.ts` (add timing + event recording)
- Modify: `src/usage/tracker.ts` (wire `recordToolEvent`)

**Step 1: Write the failing test**

Test that tool execution records both `usage_counters` (existing) and `usage_events` (new) with timing and cost data.

**Step 2: Implement timing wrapper**

In `fastmcp-runtime.ts`, wrap tool execution with `performance.now()` to capture `durationMs`. After execution, call `recordToolEvent` alongside existing `recordToolCall`.

```typescript
// In proxy tool handler (after line ~1078)
const startTime = performance.now();
const result = await executeToolCall(...);
const durationMs = Math.round(performance.now() - startTime);

const toolCost = getToolCost(toolName);
deps.usageTracker.recordToolEvent({
  userId,
  toolName,
  virtualCost: toolCost.virtualCost,
  durationMs,
  metadata: { /* tool-specific: query length, result count */ },
});
```

**Step 3: Run existing tests to verify no regressions**

Run: `bun test`
Expected: All existing tests PASS

**Step 4: Commit**

```bash
git add src/runtime/fastmcp-runtime.ts src/usage/tracker.ts
git commit -m "feat(usage): integrate per-tool cost tracking and timing into tool execution"
```

---

### Task 5: Admin analytics queries

**Files:**
- Create: `src/usage/analytics.ts`
- Test: `src/usage/__tests__/analytics.test.ts`

**Step 1: Write failing tests**

```typescript
describe("analytics", () => {
  test("getSummary returns totals", async () => {
    // Seed events, then query
    const summary = await getSummary(db, { days: 30 });
    expect(summary.totalUsers).toBeGreaterThanOrEqual(0);
    expect(summary.totalCalls).toBeGreaterThanOrEqual(0);
    expect(summary.totalVirtualCost).toBeGreaterThanOrEqual(0);
  });

  test("getPerToolBreakdown returns per-tool stats", async () => {
    const breakdown = await getPerToolBreakdown(db, { days: 30 });
    expect(Array.isArray(breakdown)).toBe(true);
  });

  test("getTopUsers returns ranked users", async () => {
    const topUsers = await getTopUsers(db, { days: 30, limit: 10 });
    expect(Array.isArray(topUsers)).toBe(true);
  });

  test("getDailyTimeSeries returns per-day counts", async () => {
    const series = await getDailyTimeSeries(db, { days: 30 });
    expect(Array.isArray(series)).toBe(true);
  });
});
```

**Step 2: Implement analytics queries**

All queries against `usage_events` table with date filtering.

**Step 3: Run tests**

Run: `bun test src/usage/__tests__/analytics.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/usage/analytics.ts src/usage/__tests__/analytics.test.ts
git commit -m "feat(usage): add admin analytics queries (summary, per-tool, top-users, time-series)"
```

---

### Task 6: Admin analytics portal page

**Files:**
- Modify: `src/portal/ui-routes.tsx` (add admin routes)
- Modify: `src/config/index.ts` (add `ADMIN_USER_IDS` env var)

**Step 1: Add config**

Add `adminUserIds: string[]` to `AppConfig`. Parse from `ADMIN_USER_IDS` env var (comma-separated, optional — defaults to empty).

**Step 2: Add admin guard**

```typescript
function isAdmin(sessionSub: string, config: AppConfig): boolean {
  return config.adminUserIds.includes(sessionSub);
}
```

**Step 3: Build admin dashboard route**

`GET /portal/admin/analytics` — HTML page with:
- Summary cards (total users, calls, virtual cost, active users 7d)
- Per-tool breakdown table
- Top users table
- Daily calls table (last 30 days)

Plain HTML tables, same styling as existing portal. No JS charts.

**Step 4: Build per-user detail route**

`GET /portal/admin/analytics/user/:userId` — HTML page with:
- User profile (segment, notes)
- Per-tool breakdown for this user
- Recent events list (last 100)

**Step 5: Test manually**

Start server, navigate to admin pages, verify data renders.

**Step 6: Commit**

```bash
git add src/portal/ui-routes.tsx src/config/index.ts
git commit -m "feat(portal): add admin analytics dashboard with per-tool and per-user breakdowns"
```

---

### Task 7: Enhance portal home with cost info + donate link

**Files:**
- Modify: `src/portal/ui-routes.tsx` (enhance `/portal/home`)
- Modify: `src/config/index.ts` (add `DONATE_URL` env var)

**Step 1: Add `DONATE_URL` to config**

Optional env var. If set, show donate link.

**Step 2: Enhance usage stats on portal home**

Current: table with Tool Name | Calls.
New: table with Tool Name | Calls | Cost Tier (free/low/medium/high).

**Step 3: Add donate section**

Below usage stats, if `DONATE_URL` is configured:

```html
<div class="donate-section">
  <p>This service is free during beta. If you find it useful, consider supporting development:</p>
  <a href="${donateUrl}" target="_blank" rel="noopener">Support the project</a>
</div>
```

**Step 4: Test manually**

Verify portal home shows enhanced stats and donate link.

**Step 5: Commit**

```bash
git add src/portal/ui-routes.tsx src/config/index.ts
git commit -m "feat(portal): add cost tier display and donate link to portal home"
```

---

## 5. Future Phases (not in this plan)

### Phase 2: Pricing decision (after 1-2 months of data)
- Analyze real usage patterns and costs
- Map virtual costs to actual RUB amounts
- Decide on pricing tiers per segment
- Design credit packages

### Phase 3: Billing integration (when ready)
- Revive CloudPayments plan from archive
- Implement top-up flow with real pricing based on data
- Add usage limits (soft/hard)
- Credit balance management

---

## 6. Success Criteria

1. Every tool call records a `usage_event` with virtual cost and duration
2. Admin can view dashboard with per-tool and per-user breakdowns
3. Admin can tag users with segments
4. Portal home shows cost tier per tool
5. Donate link visible when configured
6. No performance regression from tracking (fire-and-forget pattern)
7. After 1-2 months: enough data to make informed pricing decisions
